"""Instrument master. Refreshed from Kite on startup / day change — never hard-coded tokens."""

from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from . import config


def load_instruments(path: Path | None = None) -> list[dict]:
    csv_path = path or config.INSTRUMENTS_PATH
    if not csv_path.exists():
        return []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def save_instruments(rows: list[dict], path: Path | None = None) -> Path:
    csv_path = path or config.INSTRUMENTS_PATH
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return csv_path
    fieldnames = list(rows[0].keys())
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return csv_path


def fno_equity_symbols(rows: list[dict]) -> list[str]:
    symbols = []
    seen = set()
    for row in rows:
        if row.get("segment") != "NFO-OPT":
            continue
        name = (row.get("name") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        symbols.append(name)
    return sorted(symbols)


def option_chain(rows: list[dict], name: str, expiry: str | None = None) -> list[dict]:
    chain = [
        row
        for row in rows
        if row.get("name") == name
        and row.get("segment") == "NFO-OPT"
        and row.get("instrument_type") in {"CE", "PE"}
    ]
    if expiry:
        chain = [row for row in chain if row.get("expiry") == expiry]
    return chain


def upcoming_expiries(rows: list[dict], today: date | None = None) -> list[str]:
    today = today or date.today()
    found = set()
    for row in rows:
        if row.get("segment") != "NFO-OPT":
            continue
        exp = row.get("expiry") or ""
        if not exp:
            continue
        try:
            if date.fromisoformat(exp) >= today:
                found.add(exp)
        except ValueError:
            continue
    return sorted(found)
