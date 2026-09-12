import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    def load_dotenv(*_args, **_kwargs):
        return False

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


DUMMY_MODE = _bool("DUMMY_MODE", "true")

KITE_API_KEY = os.getenv("KITE_API_KEY", "").strip()
KITE_API_SECRET = os.getenv("KITE_API_SECRET", "").strip()
KITE_ACCESS_TOKEN = os.getenv("KITE_ACCESS_TOKEN", "").strip()

INSTRUMENTS_PATH = ROOT_DIR / "data" / "instruments.csv"

ALERT_NET_RETURN = float(os.getenv("ALERT_NET_RETURN", "1.0"))
ALERT_MIN_EXPIRY_DAYS = int(os.getenv("ALERT_MIN_EXPIRY_DAYS", "7"))

# Liquidity thresholds used by the scanner (not user-facing filters).
NARROW_SPREAD = 0.05
WIDE_SPREAD = 0.08
VERY_WIDE_SPREAD = 0.15
GOOD_VOLUME = 20_000
GOOD_OI = 100_000
LOW_VOLUME = 2_000
LOW_OI = 10_000
PARTIAL_LOW_FRACTION = 0.10
