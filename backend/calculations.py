"""Parity math, executable quantity, liquidity score, and charge estimates.

Execution prices are never LTP:
  Strategy A  BUY stock + SELL CE + BUY PE   → CE bid, PE ask
  Strategy B  SELL stock + BUY CE + SELL PE  → CE ask, PE bid
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from . import config

STRATEGY_A = "A"
STRATEGY_B = "B"

STRATEGY_LABELS = {
    STRATEGY_A: "Buy Stock + Sell CE + Buy PE",
    STRATEGY_B: "Sell Stock + Buy CE + Sell PE",
}


def _mid(bid: float, ask: float) -> float:
    if bid > 0 and ask > 0:
        return (bid + ask) / 2
    return max(bid, ask, 0.0)


def spread_pct(bid: float, ask: float) -> float:
    mid = _mid(bid, ask)
    if mid <= 0 or ask <= 0 or bid <= 0:
        return 1.0
    return max(ask - bid, 0.0) / mid


def days_to_expiry(expiry: str, today: date | None = None) -> int:
    today = today or date.today()
    if isinstance(expiry, datetime):
        exp = expiry.date()
    elif isinstance(expiry, date):
        exp = expiry
    else:
        exp = date.fromisoformat(str(expiry)[:10])
    return (exp - today).days


def profit_per_share(strategy: str, spot: float, strike: float, ce: dict, pe: dict) -> float:
    if strategy == STRATEGY_A:
        return strike - spot + ce["bid"] - pe["ask"]
    return spot - strike - ce["ask"] + pe["bid"]


def capital_per_share(strategy: str, spot: float, strike: float, ce: dict, pe: dict) -> float:
    if strategy == STRATEGY_A:
        return spot - ce["bid"] + pe["ask"]
    return strike + ce["ask"] - pe["bid"]


def executable_quantity(strategy: str, lot_size: int, ce: dict, pe: dict) -> int:
    if strategy == STRATEGY_A:
        return int(min(lot_size, ce.get("bid_qty", 0), pe.get("ask_qty", 0)))
    return int(min(lot_size, ce.get("ask_qty", 0), pe.get("bid_qty", 0)))


def full_lot_available(strategy: str, lot_size: int, ce: dict, pe: dict) -> bool:
    if strategy == STRATEGY_A:
        return ce.get("bid_qty", 0) >= lot_size and pe.get("ask_qty", 0) >= lot_size
    return ce.get("ask_qty", 0) >= lot_size and pe.get("bid_qty", 0) >= lot_size


def liquidity_score(strategy: str, lot_size: int, ce: dict, pe: dict) -> str:
    exec_qty = executable_quantity(strategy, lot_size, ce, pe)
    full_lot = full_lot_available(strategy, lot_size, ce, pe)
    ce_spread = spread_pct(ce.get("bid", 0), ce.get("ask", 0))
    pe_spread = spread_pct(pe.get("bid", 0), pe.get("ask", 0))
    worst_spread = max(ce_spread, pe_spread)

    ce_vol = ce.get("volume", 0)
    pe_vol = pe.get("volume", 0)
    ce_oi = ce.get("oi", 0)
    pe_oi = pe.get("oi", 0)

    very_low_qty = exec_qty < lot_size * config.PARTIAL_LOW_FRACTION
    very_wide = worst_spread >= config.VERY_WIDE_SPREAD
    very_low_depth = (
        ce_vol < config.LOW_VOLUME
        or pe_vol < config.LOW_VOLUME
        or ce_oi < config.LOW_OI
        or pe_oi < config.LOW_OI
    )
    if very_low_qty or very_wide or very_low_depth:
        return "LOW"

    wide = worst_spread >= config.WIDE_SPREAD
    good_vol = ce_vol >= config.GOOD_VOLUME and pe_vol >= config.GOOD_VOLUME
    good_oi = ce_oi >= config.GOOD_OI and pe_oi >= config.GOOD_OI
    narrow = worst_spread <= config.NARROW_SPREAD

    if not full_lot:
        return "MEDIUM"
    if wide or not good_vol or not good_oi:
        return "MEDIUM"
    if narrow and good_vol and good_oi:
        return "HIGH"
    return "MEDIUM"


def estimate_charges(strategy: str, spot: float, ce_px: float, pe_px: float, qty: int) -> dict[str, float]:
    """Zerodha-like estimate for equity delivery + two option legs.

    These are estimates for the dashboard, not a contract note.
    """
    if qty <= 0:
        return _empty_charges()

    eq = _equity_leg(spot * qty, buy=(strategy == STRATEGY_A))
    ce = _option_leg(ce_px * qty, buy=(strategy == STRATEGY_B))
    pe = _option_leg(pe_px * qty, buy=(strategy == STRATEGY_A))

    brokerage = eq["brokerage"] + ce["brokerage"] + pe["brokerage"]
    stt = eq["stt"] + ce["stt"] + pe["stt"]
    exchange = eq["exchange"] + ce["exchange"] + pe["exchange"]
    gst = eq["gst"] + ce["gst"] + pe["gst"]
    stamp = eq["stamp"] + ce["stamp"] + pe["stamp"]
    sebi = eq["sebi"] + ce["sebi"] + pe["sebi"]
    other = eq["other"] + ce["other"] + pe["other"]
    total = brokerage + stt + exchange + gst + stamp + sebi + other

    return {
        "brokerage": round(brokerage, 2),
        "stt": round(stt, 2),
        "exchange": round(exchange, 2),
        "gst": round(gst, 2),
        "stamp": round(stamp, 2),
        "sebi": round(sebi, 2),
        "other": round(other, 2),
        "total": round(total, 2),
    }


def _empty_charges() -> dict[str, float]:
    return {
        "brokerage": 0.0,
        "stt": 0.0,
        "exchange": 0.0,
        "gst": 0.0,
        "stamp": 0.0,
        "sebi": 0.0,
        "other": 0.0,
        "total": 0.0,
    }


def _equity_leg(turnover: float, buy: bool) -> dict[str, float]:
    brokerage = 0.0
    stt = turnover * 0.001
    exchange = turnover * 0.0000297
    sebi = turnover * 0.000001
    stamp = turnover * 0.00015 if buy else 0.0
    other = turnover * 0.000001
    gst = 0.18 * (brokerage + exchange + sebi)
    return _leg(brokerage, stt, exchange, gst, stamp, sebi, other)


def _option_leg(turnover: float, buy: bool) -> dict[str, float]:
    brokerage = min(20.0, turnover * 0.0003)
    stt = turnover * 0.001 if not buy else 0.0
    exchange = turnover * 0.0003503
    sebi = turnover * 0.000001
    stamp = turnover * 0.00003 if buy else 0.0
    other = turnover * 0.000005
    gst = 0.18 * (brokerage + exchange + sebi)
    return _leg(brokerage, stt, exchange, gst, stamp, sebi, other)


def _leg(brokerage, stt, exchange, gst, stamp, sebi, other) -> dict[str, float]:
    return {
        "brokerage": brokerage,
        "stt": stt,
        "exchange": exchange,
        "gst": gst,
        "stamp": stamp,
        "sebi": sebi,
        "other": other,
    }


def _book_px(book: dict, side: str) -> tuple[float, bool]:
    live = float(book.get(side) or 0)
    ltp = float(book.get("ltp") or book.get("last_price") or 0)
    if live > 0:
        return live, False
    return ltp, ltp > 0


def build_opportunity(quote: dict[str, Any], strategy: str) -> dict[str, Any] | None:
    spot = float(quote["spot"])
    strike = float(quote["strike"])
    lot = int(quote["lot_size"])
    ce = quote["ce"]
    pe = quote["pe"]
    if spot <= 0:
        return None

    if strategy == STRATEGY_A:
        ce_px, ce_ltp = _book_px(ce, "bid")
        pe_px, pe_ltp = _book_px(pe, "ask")
    else:
        ce_px, ce_ltp = _book_px(ce, "ask")
        pe_px, pe_ltp = _book_px(pe, "bid")
    if ce_px <= 0 or pe_px <= 0:
        return None
    used_ltp = ce_ltp or pe_ltp

    if strategy == STRATEGY_A:
        pps = strike - spot + ce_px - pe_px
        cps = spot - ce_px + pe_px
    else:
        pps = spot - strike - ce_px + pe_px
        cps = strike + ce_px - pe_px
    if cps <= 0:
        return None

    exec_qty = executable_quantity(strategy, lot, ce, pe)
    qty = lot if used_ltp and exec_qty <= 0 else exec_qty
    full_lot = (not used_ltp) and full_lot_available(strategy, lot, ce, pe)
    liq = "LTP" if used_ltp else liquidity_score(strategy, lot, ce, pe)
    gross_return = pps / cps * 100
    capital = cps * qty
    gross_profit = pps * qty
    lot_profit = pps * lot
    charges = estimate_charges(strategy, spot, ce_px, pe_px, qty)
    net_profit = gross_profit - charges["total"]
    net_return = (net_profit / capital * 100) if capital else 0.0
    dte = days_to_expiry(quote["expiry"])

    if strategy == STRATEGY_A:
        effective = cps
        guaranteed = strike
    else:
        effective = spot - ce_px + pe_px
        guaranteed = strike

    return {
        "id": f"{quote['symbol']}-{quote['expiry']}-{int(strike)}-{strategy}",
        "symbol": quote["symbol"],
        "name": quote.get("name", quote["symbol"]),
        "expiry": quote["expiry"],
        "strike": strike,
        "spot": spot,
        "lot_size": lot,
        "strategy": strategy,
        "strategy_label": STRATEGY_LABELS[strategy],
        "ce_bid": ce.get("bid", 0),
        "ce_ask": ce.get("ask", 0),
        "ce_bid_qty": ce.get("bid_qty", 0),
        "ce_ask_qty": ce.get("ask_qty", 0),
        "ce_ltp": ce.get("ltp", 0),
        "ce_volume": ce.get("volume", 0),
        "ce_oi": ce.get("oi", 0),
        "pe_bid": pe.get("bid", 0),
        "pe_ask": pe.get("ask", 0),
        "pe_bid_qty": pe.get("bid_qty", 0),
        "pe_ask_qty": pe.get("ask_qty", 0),
        "pe_ltp": pe.get("ltp", 0),
        "pe_volume": pe.get("volume", 0),
        "pe_oi": pe.get("oi", 0),
        "ce_px": ce_px,
        "pe_px": pe_px,
        "profit_per_share": round(pps, 4),
        "capital_per_share": round(cps, 4),
        "gross_return": round(gross_return, 4),
        "net_return": round(net_return, 4),
        "capital": round(capital, 2),
        "gross_profit": round(gross_profit, 2),
        "lot_profit": round(lot_profit, 2),
        "net_profit": round(net_profit, 2),
        "charges": charges,
        "executable_qty": exec_qty,
        "full_lot": full_lot,
        "partial": exec_qty > 0 and not full_lot,
        "used_ltp": used_ltp,
        "liquidity": liq,
        "days_to_expiry": dte,
        "effective_cost": round(effective, 4),
        "guaranteed_value": guaranteed,
        "alert": (
            not used_ltp
            and net_return >= config.ALERT_NET_RETURN
            and full_lot
            and dte >= config.ALERT_MIN_EXPIRY_DAYS
        ),
    }


LIQUIDITY_RANK = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "LTP": 3}


def rank_opportunities(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        rows,
        key=lambda r: (LIQUIDITY_RANK.get(r["liquidity"], 9), -r["net_return"]),
    )
    for i, row in enumerate(ordered, start=1):
        row["rank"] = i
    return ordered
