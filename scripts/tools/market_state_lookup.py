"""market_state_lookup — pull polymarket price history for a window.

Called by the EdgeCast agent via HTTP when the baseline tick payload isn't
enough — e.g. it wants the full curve of a specific market across 10 minutes
to decide if a move is a spike or a steady climb.

Returns prices as integer cents (0-100); the broadcast prompts speak in cents.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from .match_helpers import (
    load_price_points,
    minute_to_ts,
    to_cents,
    ts_to_minute,
    yes_token,
)

Aggregation = Literal["raw", "delta", "range"]


def market_state_lookup(
    match_id: str,
    market_id: str,
    start_minute: float,
    end_minute: float,
    aggregation: Aggregation = "range",
) -> dict[str, Any]:
    """Return price state for the 'Yes' outcome of `market_id` in a window.

    Args:
        match_id: e.g. "ars-man-2026-04-19"
        market_id: Polymarket market_id (string)
        start_minute / end_minute: inclusive match-minute bounds
        aggregation:
            "raw"   → all points: [{minute, price_c}, ...]
            "delta" → {open_c, close_c, delta_c}
            "range" → {open_c, close_c, high_c, low_c, n_points}
    """
    token = yes_token(match_id, market_id)
    if not token:
        return {"error": f"unknown market_id {market_id}"}

    points = load_price_points(token, match_id)
    if not points:
        return {"error": f"no price data for market_id {market_id}"}

    start_ts = minute_to_ts(match_id, start_minute)
    end_ts = minute_to_ts(match_id, end_minute)

    window = [
        {"minute": round(ts_to_minute(match_id, p["ts_utc"]), 2), "price_c": to_cents(p["price"])}
        for p in points
        if start_ts <= datetime.fromisoformat(p["ts_utc"]) <= end_ts
    ]

    if not window:
        return {
            "error": "no points in window",
            "market_id": market_id,
            "start_minute": start_minute,
            "end_minute": end_minute,
        }

    prices = [w["price_c"] for w in window]
    open_c, close_c = prices[0], prices[-1]

    if aggregation == "raw":
        return {"market_id": market_id, "points": window, "n_points": len(window)}
    if aggregation == "delta":
        return {"market_id": market_id, "open_c": open_c, "close_c": close_c, "delta_c": close_c - open_c}
    return {
        "market_id": market_id,
        "open_c": open_c,
        "close_c": close_c,
        "high_c": max(prices),
        "low_c": min(prices),
        "n_points": len(window),
    }
