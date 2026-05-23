"""Shared helpers for the lookup tools and the tick driver.

Single source of truth for: match metadata loading, match-minute ↔ UTC
conversion, market_id → token_id resolution. Everything else builds on these.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "matches"


@lru_cache(maxsize=8)
def load_meta(match_id: str) -> dict[str, Any]:
    return json.loads((DATA_DIR / match_id / "meta.json").read_text())


@lru_cache(maxsize=8)
def kickoff(match_id: str) -> datetime:
    return datetime.fromisoformat(load_meta(match_id)["kickoff_utc"])


def minute_to_ts(match_id: str, minute: float) -> datetime:
    return kickoff(match_id) + timedelta(minutes=minute)


def ts_to_minute(match_id: str, ts: datetime | str) -> float:
    if isinstance(ts, str):
        ts = datetime.fromisoformat(ts)
    return (ts - kickoff(match_id)).total_seconds() / 60.0


@lru_cache(maxsize=8)
def load_markets(match_id: str) -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / match_id / "markets.json").read_text())


@lru_cache(maxsize=8)
def market_index(match_id: str) -> dict[str, dict[str, Any]]:
    """market_id -> market record."""
    return {m["market_id"]: m for m in load_markets(match_id)}


def yes_token(match_id: str, market_id: str) -> str | None:
    """Return the token_id for the 'Yes' outcome of a market, else first token."""
    m = market_index(match_id).get(market_id)
    if not m:
        return None
    outcomes = m.get("outcomes") or []
    tokens = m.get("token_ids") or []
    if "Yes" in outcomes:
        return tokens[outcomes.index("Yes")]
    return tokens[0] if tokens else None


@lru_cache(maxsize=128)
def load_price_points(token_id: str, match_id: str) -> list[dict[str, Any]]:
    """All price points for a token, sorted by ts_utc ascending."""
    path = DATA_DIR / match_id / "prices" / f"{token_id}.json"
    if not path.exists():
        return []
    blob = json.loads(path.read_text())
    pts = blob.get("points") or []
    return sorted(pts, key=lambda p: p["ts_utc"])


def to_cents(price: float) -> int:
    """Polymarket prices are 0..1 floats; cents = int(round(p*100))."""
    return int(round(price * 100))
