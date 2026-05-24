"""Match score and market feasibility helpers for tick payloads."""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from .events_commentary_lookup import _ke_minute, _load_key_events
from .match_helpers import load_markets, load_meta, market_index


def _team_side(team_name: str, home: str, away: str) -> str | None:
    name = (team_name or "").lower()
    if not name:
        return None
    if name in home.lower() or home.lower().startswith(name.split()[0]):
        return "home"
    if name in away.lower() or away.lower().startswith(name.split()[0]):
        return "away"
    return None


def score_at_minute(match_id: str, minute: float) -> dict[str, Any]:
    """Return home/away goals and a display string at a match minute."""
    meta = load_meta(match_id)
    home_name = meta["home"]
    away_name = meta["away"]
    home_goals = 0
    away_goals = 0

    for event in _load_key_events(match_id):
        if _ke_minute(event) > minute:
            continue
        if event.get("type", {}).get("type") != "goal":
            continue
        side = _team_side(event.get("team", {}).get("displayName", ""), home_name, away_name)
        if side == "home":
            home_goals += 1
        elif side == "away":
            away_goals += 1

    return {
        "home": home_goals,
        "away": away_goals,
        "display": f"{home_goals}-{away_goals}",
        "home_team": home_name,
        "away_team": away_name,
    }


def parse_exact_score(market: dict[str, Any]) -> tuple[int, int] | None:
    title = (market.get("metadata") or {}).get("group_item_title") or market.get("question") or ""
    match = re.search(r"(\d+)\s*[-–]\s*(\d+)", title)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def is_market_feasible(
    market: dict[str, Any],
    minute: float,
    score: dict[str, Any],
    close_c: int | None = None,
) -> bool:
    """Drop markets that are already dead for the remaining match."""
    market_type = market.get("sports_market_type") or ""
    home = int(score["home"])
    away = int(score["away"])

    if market_type == "soccer_halftime_result" and minute > 46:
        return False

    if market_type == "soccer_exact_score":
        parsed = parse_exact_score(market)
        if parsed is None:
            return True
        need_home, need_away = parsed
        if home > need_home or away > need_away:
            return False
        if close_c is not None and close_c <= 2:
            return False

    if market_type == "totals":
        title = ((market.get("metadata") or {}).get("group_item_title") or market.get("question") or "").lower()
        line_match = re.search(r"(\d+(?:\.\d+)?)", title)
        if line_match:
            line = float(line_match.group(1))
            total_goals = home + away
            if "under" in title or re.search(r"\bu\s", title):
                if total_goals > line:
                    return False
            elif total_goals >= line and close_c is not None and close_c >= 98:
                return False

    return True


def filter_feasible_movers(
    match_id: str,
    minute: float,
    movers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    score = score_at_minute(match_id, minute)
    index = market_index(match_id)
    kept: list[dict[str, Any]] = []
    for row in movers:
        market = index.get(row["market_id"])
        if not market:
            continue
        if is_market_feasible(market, minute, score, row.get("close_c")):
            kept.append(row)
    return kept
