"""events_commentary_lookup — pull events/commentary for a window.

Mirror of market_state_lookup for the non-numeric side. key_events.json
encodes clock as seconds (0..5400 for 0'..90'); we convert to minutes.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Literal

from .match_helpers import DATA_DIR

Kind = Literal["events", "commentary", "both"]
MAX_LINES = 40


@lru_cache(maxsize=8)
def _load_key_events(match_id: str) -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / match_id / "key_events.json").read_text())


@lru_cache(maxsize=8)
def _load_commentary(match_id: str) -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / match_id / "commentary.json").read_text())


def _ke_minute(ev: dict[str, Any]) -> float:
    return float(ev.get("clock", {}).get("value", 0)) / 60.0


def events_commentary_lookup(
    match_id: str,
    start_minute: float,
    end_minute: float,
    kind: Kind = "both",
    key_events_only: bool = True,
) -> dict[str, Any]:
    """Return events and/or commentary for a match-minute window.

    Returns:
        {"events": [...], "commentary": ["80': Mbappé equalizes...", ...],
         "truncated": bool}
    """
    result: dict[str, Any] = {"truncated": False}

    if kind in ("events", "both"):
        if not key_events_only:
            return {"error": "full events.json is market metadata, not match events; use key_events_only=True"}
        evs = [
            {
                "minute": round(_ke_minute(e), 2),
                "type": e.get("type", {}).get("type"),
                "text": e.get("text"),
            }
            for e in _load_key_events(match_id)
            if start_minute <= _ke_minute(e) <= end_minute
        ]
        result["events"] = evs

    if kind in ("commentary", "both"):
        lines = [
            f"{c['minute']}': {c['text']}"
            for c in _load_commentary(match_id)
            if start_minute <= c.get("minute", 0) <= end_minute
        ]
        if len(lines) > MAX_LINES:
            lines = lines[-MAX_LINES:]
            result["truncated"] = True
        result["commentary"] = lines

    return result
