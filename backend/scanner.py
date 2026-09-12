"""Two-stage scanner: discover the F&O universe, then compute parity on live (or dummy) quotes."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from . import config
from .calculations import STRATEGY_A, STRATEGY_B, build_opportunity, rank_opportunities

# Milestone names we must be able to reproduce before going live.
MILESTONE_SYMBOLS = ("KALYAN", "HINDZINC", "DIXON", "BSE")


def dummy_quotes() -> list[dict[str, Any]]:
    """Hand-built books so the dashboard can be judged before Kite is wired."""
    return [
        {
            "symbol": "POLYCAB",
            "name": "Polycab India",
            "expiry": "2026-09-29",
            "strike": 1250,
            "spot": 1230,
            "lot_size": 1000,
            "ce": {
                "bid": 42.50, "ask": 43.10, "bid_qty": 2800, "ask_qty": 1900,
                "ltp": 42.80, "volume": 89000, "oi": 1450000,
            },
            "pe": {
                "bid": 29.40, "ask": 30.00, "bid_qty": 2200, "ask_qty": 3100,
                "ltp": 29.70, "volume": 72000, "oi": 1280000,
            },
        },
        {
            "symbol": "BSE",
            "name": "BSE",
            "expiry": "2026-09-29",
            "strike": 2500,
            "spot": 2480,
            "lot_size": 375,
            "ce": {
                "bid": 45.00, "ask": 45.80, "bid_qty": 1200, "ask_qty": 800,
                "ltp": 45.40, "volume": 64000, "oi": 980000,
            },
            "pe": {
                "bid": 37.20, "ask": 38.00, "bid_qty": 900, "ask_qty": 1500,
                "ltp": 37.60, "volume": 51000, "oi": 870000,
            },
        },
        {
            "symbol": "INFY",
            "name": "Infosys",
            "expiry": "2026-09-29",
            "strike": 1500,
            "spot": 1520,
            "lot_size": 400,
            "ce": {
                "bid": 37.40, "ask": 38.00, "bid_qty": 4000, "ask_qty": 5600,
                "ltp": 37.70, "volume": 210000, "oi": 3200000,
            },
            "pe": {
                "bid": 28.00, "ask": 28.55, "bid_qty": 4800, "ask_qty": 3200,
                "ltp": 28.25, "volume": 188000, "oi": 2750000,
            },
        },
        {
            "symbol": "HINDZINC",
            "name": "Hindustan Zinc",
            "expiry": "2026-09-29",
            "strike": 570,
            "spot": 576.45,
            "lot_size": 1225,
            "ce": {
                "bid": 21.35, "ask": 23.80, "bid_qty": 4200, "ask_qty": 3100,
                "ltp": 22.40, "volume": 156000, "oi": 2100000,
            },
            "pe": {
                "bid": 10.20, "ask": 11.30, "bid_qty": 2800, "ask_qty": 3900,
                "ltp": 10.85, "volume": 134000, "oi": 1890000,
            },
        },
        {
            "symbol": "KALYAN",
            "name": "Kalyan Jewellers",
            "expiry": "2026-09-29",
            "strike": 610,
            "spot": 601,
            "lot_size": 1350,
            "ce": {
                "bid": 15.85, "ask": 16.25, "bid_qty": 500, "ask_qty": 2100,
                "ltp": 16.00, "volume": 184200, "oi": 2101500,
            },
            "pe": {
                "bid": 21.05, "ask": 21.45, "bid_qty": 800, "ask_qty": 1350,
                "ltp": 21.20, "volume": 156000, "oi": 1890000,
            },
        },
        {
            "symbol": "DIXON",
            "name": "Dixon Technologies",
            "expiry": "2026-09-29",
            "strike": 16600,
            "spot": 16500,
            "lot_size": 50,
            "ce": {
                "bid": 280.00, "ask": 284.00, "bid_qty": 200, "ask_qty": 150,
                "ltp": 282.00, "volume": 42000, "oi": 186000,
            },
            "pe": {
                "bid": 346.00, "ask": 350.00, "bid_qty": 180, "ask_qty": 220,
                "ltp": 348.00, "volume": 38000, "oi": 164000,
            },
        },
        {
            "symbol": "IREDA",
            "name": "Indian Renewable Energy Dev Agency",
            "expiry": "2026-09-29",
            "strike": 175,
            "spot": 172,
            "lot_size": 2875,
            "ce": {
                "bid": 6.80, "ask": 8.40, "bid_qty": 80, "ask_qty": 200,
                "ltp": 7.50, "volume": 1400, "oi": 8200,
            },
            "pe": {
                "bid": 4.10, "ask": 5.20, "bid_qty": 50, "ask_qty": 90,
                "ltp": 4.60, "volume": 1100, "oi": 6400,
            },
        },
        {
            "symbol": "RELIANCE",
            "name": "Reliance Industries",
            "expiry": "2026-10-27",
            "strike": 1400,
            "spot": 1385,
            "lot_size": 250,
            "ce": {
                "bid": 28.50, "ask": 28.90, "bid_qty": 6000, "ask_qty": 5400,
                "ltp": 28.70, "volume": 320000, "oi": 4500000,
            },
            "pe": {
                "bid": 36.10, "ask": 36.80, "bid_qty": 5100, "ask_qty": 5500,
                "ltp": 36.40, "volume": 280000, "oi": 3900000,
            },
        },
    ]


def scan_quotes(
    quotes: list[dict[str, Any]],
    strategies: tuple[str, ...] = (STRATEGY_A, STRATEGY_B),
    min_return: float = 0.0,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for quote in quotes:
        for strategy in strategies:
            opp = build_opportunity(quote, strategy)
            if opp and opp["gross_return"] >= min_return:
                rows.append(opp)
    return rank_opportunities(rows)


def scan_dummy(min_return: float = 0.0, strategies: tuple[str, ...] = (STRATEGY_A, STRATEGY_B)) -> dict[str, Any]:
    quotes = dummy_quotes()
    opportunities = scan_quotes(quotes, strategies=strategies, min_return=min_return)
    expiries = sorted({q["expiry"] for q in quotes})
    return {
        "mode": "dummy",
        "connected": False,
        "last_update": datetime.now().strftime("%H:%M:%S"),
        "stocks_scanned": 185,
        "expiries": expiries,
        "nearest_expiry": expiries[0] if expiries else None,
        "next_expiry": expiries[1] if len(expiries) > 1 else None,
        "opportunities": opportunities,
        "alerts": [row for row in opportunities if row["alert"]],
    }


def milestone_check() -> list[dict[str, Any]]:
    """Print-friendly proof that Kalyan / HINDZINC / Dixon / BSE match the manual sheet."""
    wanted = set(MILESTONE_SYMBOLS)
    rows = [
        row
        for row in scan_quotes(dummy_quotes())
        if row["symbol"] in wanted and row["strategy"] == STRATEGY_A
    ]
    return rows


if __name__ == "__main__":
    print("Milestone Strategy A (execution prices only — never LTP)\n")
    for row in milestone_check():
        print(
            f"{row['symbol']:10} strike {row['strike']:<8} "
            f"profit/sh {row['profit_per_share']:.2f}  "
            f"return {row['gross_return']:.2f}%  "
            f"lot profit {row['lot_profit']:.0f}  "
            f"exec qty {row['executable_qty']}  "
            f"{row['liquidity']}"
            f"{'  PARTIAL' if row['partial'] else ''}"
        )
    print("\nDummy mode:" if config.DUMMY_MODE else "\nLive mode:")
    snapshot = scan_dummy()
    print(f"{len(snapshot['opportunities'])} opportunities, {len(snapshot['alerts'])} alerts")
