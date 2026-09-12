"""Kite Connect wrapper. Login is manual — we never automate the Zerodha password page."""

from __future__ import annotations

from datetime import date
from typing import Any, Callable

from . import config
from . import instruments as instrument_store


class ZerodhaClient:
    def __init__(self) -> None:
        self.kite = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected and self.kite is not None

    def login_url(self) -> str:
        self._require_keys()
        kite = self._kite()
        return kite.login_url()

    def generate_session(self, request_token: str) -> str:
        self._require_keys()
        kite = self._kite()
        data = kite.generate_session(request_token, api_secret=config.KITE_API_SECRET)
        token = data["access_token"]
        kite.set_access_token(token)
        self._connected = True
        return token

    def connect_with_access_token(self, access_token: str | None = None) -> None:
        token = access_token or config.KITE_ACCESS_TOKEN
        if not token:
            raise RuntimeError("No Kite access token. Complete the login flow first.")
        kite = self._kite()
        kite.set_access_token(token)
        kite.profile()
        self._connected = True

    def refresh_instruments(self) -> list[dict]:
        kite = self._require_session()
        dump = kite.instruments()
        rows = []
        for item in dump:
            expiry = item.get("expiry")
            if isinstance(expiry, date):
                expiry = expiry.isoformat()
            elif expiry:
                expiry = str(expiry)[:10]
            else:
                expiry = ""
            rows.append(
                {
                    "instrument_token": item.get("instrument_token"),
                    "exchange_token": item.get("exchange_token"),
                    "tradingsymbol": item.get("tradingsymbol"),
                    "name": item.get("name"),
                    "last_price": item.get("last_price") or 0,
                    "expiry": expiry,
                    "strike": item.get("strike") or 0,
                    "tick_size": item.get("tick_size") or 0.05,
                    "lot_size": item.get("lot_size") or 1,
                    "instrument_type": item.get("instrument_type"),
                    "segment": item.get("segment"),
                    "exchange": item.get("exchange"),
                }
            )
        instrument_store.save_instruments(rows)
        return rows

    def quotes(self, tokens: list[int]) -> dict[int, dict[str, Any]]:
        kite = self._require_session()
        keyed = [f"{token}" for token in tokens]
        raw = kite.quote(keyed)
        out: dict[int, dict[str, Any]] = {}
        for key, q in raw.items():
            token = int(str(key).split(":")[-1]) if ":" in str(key) else int(key)
            depth = q.get("depth") or {}
            buy = (depth.get("buy") or [{}])[0]
            sell = (depth.get("sell") or [{}])[0]
            out[token] = {
                "last_price": q.get("last_price") or 0,
                "volume": q.get("volume") or 0,
                "oi": q.get("oi") or 0,
                "bid": buy.get("price") or 0,
                "bid_qty": buy.get("quantity") or 0,
                "ask": sell.get("price") or 0,
                "ask_qty": sell.get("quantity") or 0,
            }
        return out

    def start_ticker(self, tokens: list[int], on_ticks: Callable) -> Any:
        """Subscribe in full mode so we get bid/ask and quantity, not just LTP."""
        from kiteconnect import KiteTicker

        self._require_session()
        ticker = KiteTicker(config.KITE_API_KEY, config.KITE_ACCESS_TOKEN)

        def _on_connect(ws, response):  # noqa: ARG001
            ws.subscribe(tokens)
            ws.set_mode(ws.MODE_FULL, tokens)

        ticker.on_ticks = on_ticks
        ticker.on_connect = _on_connect
        return ticker

    def _kite(self):
        if self.kite is None:
            from kiteconnect import KiteConnect

            if not config.KITE_API_KEY:
                raise RuntimeError("KITE_API_KEY is missing.")
            self.kite = KiteConnect(api_key=config.KITE_API_KEY)
        return self.kite

    def _require_keys(self) -> None:
        if not config.KITE_API_KEY or not config.KITE_API_SECRET:
            raise RuntimeError("Set KITE_API_KEY and KITE_API_SECRET in .env")

    def _require_session(self):
        kite = self._kite()
        if not self._connected:
            if config.KITE_ACCESS_TOKEN:
                self.connect_with_access_token(config.KITE_ACCESS_TOKEN)
            else:
                raise RuntimeError("Zerodha session is not connected.")
        return kite
