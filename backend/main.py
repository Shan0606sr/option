from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .calculations import STRATEGY_A, STRATEGY_B
from .scanner import scan_dummy

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"

app = FastAPI(title="Option Parity Scanner", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _strategies(include_a: bool, include_b: bool) -> tuple[str, ...]:
    chosen = []
    if include_a:
        chosen.append(STRATEGY_A)
    if include_b:
        chosen.append(STRATEGY_B)
    return tuple(chosen) or (STRATEGY_A, STRATEGY_B)


@app.get("/api/status")
def status():
    snapshot = scan_dummy()
    return {
        "mode": "dummy" if config.DUMMY_MODE else "live",
        "connected": False if config.DUMMY_MODE else snapshot["connected"],
        "last_update": snapshot["last_update"],
        "stocks_scanned": snapshot["stocks_scanned"],
        "opportunities": len(snapshot["opportunities"]),
        "alerts": len(snapshot["alerts"]),
        "expiries": snapshot["expiries"],
        "nearest_expiry": snapshot["nearest_expiry"],
        "next_expiry": snapshot["next_expiry"],
        "message": "Dummy quotes — Zerodha is not connected yet.",
    }


@app.get("/api/scan")
def scan(
    min_return: float = Query(0.0),
    strategy_a: bool = Query(True),
    strategy_b: bool = Query(True),
):
    snapshot = scan_dummy(
        min_return=min_return,
        strategies=_strategies(strategy_a, strategy_b),
    )
    return snapshot


@app.get("/api/opportunity/{opp_id}")
def opportunity(opp_id: str):
    snapshot = scan_dummy()
    for row in snapshot["opportunities"]:
        if row["id"] == opp_id:
            return row
    return {"error": "not_found"}


if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")
