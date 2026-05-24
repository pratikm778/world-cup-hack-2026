"""Rich match context for agent tick and chat payloads."""
from __future__ import annotations

import re
from typing import Any

from .events_commentary_lookup import _ke_minute, _load_commentary, _load_key_events, events_commentary_lookup
from .match_state import score_at_minute

KEY_EVENT_TYPES = frozenset({
    "goal",
    "yellowcard",
    "redcard",
    "substitution",
    "penalty",
    "var",
    "halftime",
    "kickoff",
})

HIGHLIGHT_COMMENTARY = re.compile(
    r"\b(goal|red card|yellow card|substitut|penalt|var|halftime|offside|corner|shot)\b",
    re.I,
)


def _event_brief(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": event.get("id"),
        "minute": round(_ke_minute(event), 1),
        "type": event.get("type", {}).get("type"),
        "text": (event.get("text") or "")[:160],
    }


def build_match_context(
    match_id: str,
    minute: float,
    *,
    recent_minutes: float = 15.0,
    max_recent_commentary: int = 60,
    max_highlight_commentary: int = 40,
    max_key_events: int = 40,
) -> dict[str, Any]:
    """Summarise everything the agent should know up to `minute`."""
    score = score_at_minute(match_id, minute)
    goals: list[dict[str, Any]] = []
    cards: list[dict[str, Any]] = []
    substitutions: list[dict[str, Any]] = []
    other_key: list[dict[str, Any]] = []

    for event in _load_key_events(match_id):
        event_minute = _ke_minute(event)
        if event_minute > minute:
            continue
        brief = _event_brief(event)
        event_type = brief.get("type") or ""
        if event_type == "goal":
            goals.append(brief)
        elif event_type in ("yellowcard", "redcard"):
            cards.append(brief)
        elif event_type == "substitution":
            substitutions.append(brief)
        elif event_type in KEY_EVENT_TYPES:
            other_key.append(brief)

    recent_start = max(0.0, minute - recent_minutes)
    recent = events_commentary_lookup(match_id, recent_start, minute, "commentary")
    recent_lines = recent.get("commentary", [])
    if len(recent_lines) > max_recent_commentary:
        recent_lines = recent_lines[-max_recent_commentary:]

    highlight_lines: list[str] = []
    for row in _load_commentary(match_id):
        row_minute = float(row.get("minute", 0))
        if row_minute > minute:
            continue
        text = row.get("text") or ""
        event_type = (row.get("raw_event_type") or "").lower()
        if event_type in KEY_EVENT_TYPES or HIGHLIGHT_COMMENTARY.search(text):
            highlight_lines.append(f"{row_minute}': {text}")
    if len(highlight_lines) > max_highlight_commentary:
        highlight_lines = highlight_lines[-max_highlight_commentary:]

    key_events_all = [
        _event_brief(event)
        for event in _load_key_events(match_id)
        if _ke_minute(event) <= minute and (event.get("type", {}).get("type") in KEY_EVENT_TYPES)
    ]
    if len(key_events_all) > max_key_events:
        key_events_all = key_events_all[-max_key_events:]

    phase = "first_half" if minute <= 45 else "second_half" if minute < 90 else "full_time"

    return {
        "minute": round(minute, 2),
        "phase": phase,
        "score": score,
        "goals_timeline": goals,
        "cards": cards[-8:],
        "substitutions": substitutions[-10:],
        "key_events_all": key_events_all,
        "commentary_recent": recent_lines,
        "commentary_highlights": highlight_lines,
        "tools_note": (
            "Use GET /events_window and GET /market/{id}/window on localhost:8765 "
            "when you need a wider or raw history beyond this summary."
        ),
    }
