"""agent_io_server — one process for the agent's HTTP needs.

  • GET  /market/{market_id}/window  → market_state_lookup
  • GET  /events_window              → events_commentary_lookup
  • Background task: every EDGECAST_TICK_GAME_MINUTES of match time, builds
    a tick payload from the window since the last interval + polymarket movers,
    POSTs it to the RocketRide webhook so test.pipe fires.

The agent uses tool_http_request (already wired in test.pipe) to hit the two
GET endpoints. Webhook URL is the RocketRide ingress, configured via env.

Run:
    EDGECAST_WEBHOOK_URL=http://localhost:8080/api/pipelines/test.pipe/webhook \\
    uvicorn scripts.agent_io_server:app --host 0.0.0.0 --port 8765
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query

from scripts.tools.events_commentary_lookup import events_commentary_lookup
from scripts.tools.market_state_lookup import market_state_lookup
from scripts.tools.match_helpers import (
    kickoff,
    load_markets,
    minute_to_ts,
    ts_to_minute,
    yes_token,
)

log = logging.getLogger("edgecast")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

MATCH_ID = os.environ.get("EDGECAST_MATCH_ID", "ars-man-2026-04-19")
TICK_GAME_MINUTES = float(os.environ.get("EDGECAST_TICK_GAME_MINUTES", "5"))
TICK_POLL_SECONDS = float(os.environ.get("EDGECAST_TICK_POLL_SECONDS", "1"))
WEBHOOK_URL = os.environ.get(
    "EDGECAST_WEBHOOK_URL",
    "http://localhost:8080/api/pipelines/test.pipe/webhook",
)
LOOKBACK_MIN = float(os.environ.get("EDGECAST_LOOKBACK_MIN", "5"))
TICK_ENABLED = os.environ.get("EDGECAST_TICK_ENABLED", "1") == "1"
TOP_MOVERS = int(os.environ.get("EDGECAST_TOP_MOVERS", "5"))

# Replay clock: wall-clock is meaningless for a match that happened in April.
# /replay/start anchors a match-minute to a real instant; tick loop and
# lookups all read through current_match_minute(). /replay/seek pins a fixed
# minute (useful for repeatable tests). Defaults to "no replay" → uses
# EDGECAST_FAKE_MINUTE if set, else falls back to real time.
_replay: dict[str, float | None] = {"anchor_minute": None, "anchor_real": None, "fixed_minute": None}
_fake = os.environ.get("EDGECAST_FAKE_MINUTE")
if _fake:
    _replay["fixed_minute"] = float(_fake)

# Cross-tick memory so the stateless agent can dedup. The webhook POST in
# tick_loop returns the agent's broadcast, which we capture into
# _broadcast_history and surface back on the next tick as `prior_broadcasts`.
# `_seen_event_ids` accumulates every key_event id we have ever shown the
# agent, so it can tell new events apart from repeats inside the 5-min window.
BROADCAST_HISTORY_MAX = int(os.environ.get("EDGECAST_BROADCAST_HISTORY", "10"))
_broadcast_history: deque[dict[str, Any]] = deque(maxlen=BROADCAST_HISTORY_MAX)
_seen_event_ids: set[str] = set()
_last_tick_bucket: int = -1


def game_tick_bucket(minute: float) -> int:
    """Bucket index for match-minute ticks. -1 until the first interval completes."""
    if minute < TICK_GAME_MINUTES:
        return -1
    return int(minute // TICK_GAME_MINUTES)


def _extract_broadcast(body: Any) -> str:
    """Pull the agent's broadcast text out of the RocketRide webhook response.
    Defensive — response shape can be a string, list, or {answers: ...} dict."""
    if body is None:
        return ""
    if isinstance(body, str):
        return body.strip()
    if isinstance(body, list):
        return " ".join(s for s in (_extract_broadcast(x) for x in body) if s).strip()
    if isinstance(body, dict):
        if "answers" in body:
            return _extract_broadcast(body["answers"])
        for k in ("text", "content", "output", "message"):
            if k in body:
                return _extract_broadcast(body[k])
    return ""


def current_match_minute() -> float:
    if _replay["fixed_minute"] is not None:
        return float(_replay["fixed_minute"])
    if _replay["anchor_minute"] is not None and _replay["anchor_real"] is not None:
        elapsed = datetime.now(timezone.utc).timestamp() - float(_replay["anchor_real"])
        # Default: 1 real second = 1 match-minute / 6 (i.e. 6s real = 1 match-min, per SPEC).
        speed = float(os.environ.get("EDGECAST_REPLAY_SPEED", "10"))
        return min(90.0, float(_replay["anchor_minute"]) + elapsed * (speed / 60.0))
    return 0.0


def compute_top_movers(now_minute: float, lookback: float, k: int) -> list[dict[str, Any]]:
    """For every market with in-window data, compute the cents delta over the
    last `lookback` minutes. Return top-k by abs(delta)."""
    start = now_minute - lookback
    rows: list[dict[str, Any]] = []
    for m in load_markets(MATCH_ID):
        if not yes_token(MATCH_ID, m["market_id"]):
            continue
        r = market_state_lookup(MATCH_ID, m["market_id"], start, now_minute, "delta")
        if "error" in r:
            continue
        rows.append(
            {
                "market_id": m["market_id"],
                "question": m["question"],
                "open_c": r["open_c"],
                "close_c": r["close_c"],
                "delta_c": r["delta_c"],
            }
        )
    rows.sort(key=lambda x: abs(x["delta_c"]), reverse=True)
    return rows[:k]


def build_tick_payload(now: datetime, lookback_min: float | None = None) -> dict[str, Any]:
    """The dict POSTed to the RocketRide webhook each tick.

    Window semantics: one game-time interval (default 5 match-minutes).
    """
    now_minute = current_match_minute()
    lookback = lookback_min if lookback_min is not None else max(LOOKBACK_MIN, TICK_GAME_MINUTES)
    since_minute = max(0.0, now_minute - lookback)

    ec = events_commentary_lookup(MATCH_ID, since_minute, now_minute, "both")
    movers = compute_top_movers(now_minute, lookback, TOP_MOVERS)

    window_events = ec.get("events", [])
    previously_seen_in_window = [
        e["id"] for e in window_events if e.get("id") and e["id"] in _seen_event_ids
    ]
    # Anything we have not handed to the agent before is fresh. Mark and forget
    # at payload-build time so dedup is decided once per tick, not per call.
    for e in window_events:
        if e.get("id"):
            _seen_event_ids.add(e["id"])

    return {
        "match_id": MATCH_ID,
        "tick_ts": now.isoformat(),
        "match_minute": round(now_minute, 2),
        "since_minute": round(since_minute, 2),
        "lookback_min": round(lookback, 2),
        "new_key_events": window_events,
        "new_commentary": ec.get("commentary", []),
        "polymarket_top_movers": movers,
        "previously_seen_key_event_ids": previously_seen_in_window,
        "prior_broadcasts": list(_broadcast_history),
        "hint": (
            "You are EdgeCast — game-intelligence copilot. Surface ONE "
            "OPPORTUNITY if game trends and market prices look misaligned "
            "(not a raw price ticker). Connect pitch read → markets at Xc → "
            "why it is interesting. Otherwise return empty string. Dedup "
            "against previously_seen_key_event_ids and prior_broadcasts."
        ),
    }


async def _fire_tick(client: httpx.AsyncClient) -> None:
    now = datetime.now(timezone.utc)
    payload = build_tick_payload(now)
    log.info(
        "tick → minute=%.1f movers=%d events=%d commentary=%d",
        payload["match_minute"],
        len(payload["polymarket_top_movers"]),
        len(payload["new_key_events"]),
        len(payload["new_commentary"]),
    )
    r = await client.post(WEBHOOK_URL, json=payload)
    log.info("webhook %s %s", r.status_code, r.text[:120] if r.text else "")
    if r.status_code < 300 and r.text:
        try:
            broadcast_text = _extract_broadcast(r.json())
        except (json.JSONDecodeError, ValueError):
            broadcast_text = r.text.strip()
        if broadcast_text:
            top = payload["polymarket_top_movers"]
            _broadcast_history.append({
                "tick_ts": payload["tick_ts"],
                "match_minute": payload["match_minute"],
                "text": broadcast_text,
                "top_market_id": top[0]["market_id"] if top else None,
            })
            log.info("broadcast captured (%d in history)", len(_broadcast_history))


async def tick_loop() -> None:
    global _last_tick_bucket
    async with httpx.AsyncClient(timeout=10) as client:
        while True:
            try:
                bucket = game_tick_bucket(current_match_minute())
                if bucket > _last_tick_bucket:
                    await _fire_tick(client)
                    _last_tick_bucket = bucket
            except httpx.RequestError as e:
                log.warning("tick post failed (will retry): %s", e)
            except Exception as e:
                log.exception("tick build/post crashed: %s", e)
            await asyncio.sleep(TICK_POLL_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task: asyncio.Task | None = None
    if TICK_ENABLED:
        task = asyncio.create_task(tick_loop())
        log.info(
            "tick loop started (every %.1f match-min → %s)",
            TICK_GAME_MINUTES,
            WEBHOOK_URL,
        )
    else:
        log.info("tick loop disabled (EDGECAST_TICK_ENABLED=0)")
    try:
        yield
    finally:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="EdgeCast Agent IO", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    if _replay["fixed_minute"] is not None:
        mode = "fixed"
    elif _replay["anchor_minute"] is not None:
        mode = "running"
    else:
        mode = "wall_clock"
    return {
        "ok": True,
        "match_id": MATCH_ID,
        "now_minute": round(current_match_minute(), 2),
        "mode": mode,
        "speed": float(os.environ.get("EDGECAST_REPLAY_SPEED", "10")),
        "kickoff": kickoff(MATCH_ID).isoformat(),
        "tick_enabled": TICK_ENABLED,
        "tick_game_minutes": TICK_GAME_MINUTES,
        "tick_poll_seconds": TICK_POLL_SECONDS,
    }


@app.get("/market/{market_id}/window")
def market_window(
    market_id: str,
    start_min: float = Query(...),
    end_min: float = Query(...),
    agg: str = Query("range"),
) -> dict[str, Any]:
    if agg not in ("raw", "delta", "range"):
        raise HTTPException(400, f"agg must be raw|delta|range, got {agg}")
    return market_state_lookup(MATCH_ID, market_id, start_min, end_min, agg)  # type: ignore[arg-type]


@app.get("/events_window")
def events_window(
    start_min: float = Query(...),
    end_min: float = Query(...),
    kind: str = Query("both"),
    key_only: bool = Query(True),
) -> dict[str, Any]:
    if kind not in ("events", "commentary", "both"):
        raise HTTPException(400, f"kind must be events|commentary|both, got {kind}")
    return events_commentary_lookup(MATCH_ID, start_min, end_min, kind, key_only)  # type: ignore[arg-type]


def _reset_memory() -> None:
    """Clear cross-tick memory so a fresh replay does not see stale dedup state."""
    global _last_tick_bucket
    _broadcast_history.clear()
    _seen_event_ids.clear()
    _last_tick_bucket = -1


@app.post("/replay/seek")
def replay_seek(minute: float = Query(...)) -> dict[str, Any]:
    """Pin the current match-minute. Useful for tests & demos."""
    global _last_tick_bucket
    _replay["fixed_minute"] = minute
    _replay["anchor_minute"] = None
    _replay["anchor_real"] = None
    if minute <= 0:
        _reset_memory()
    else:
        _last_tick_bucket = game_tick_bucket(minute)
    return {"now_minute": minute, "mode": "fixed"}


@app.post("/replay/start")
def replay_start(from_minute: float = Query(0.0)) -> dict[str, Any]:
    """Anchor `from_minute` to NOW; clock advances at EDGECAST_REPLAY_SPEED."""
    global _last_tick_bucket
    _replay["anchor_minute"] = from_minute
    _replay["anchor_real"] = datetime.now(timezone.utc).timestamp()
    _replay["fixed_minute"] = None
    _last_tick_bucket = game_tick_bucket(from_minute) - 1
    return {"anchored_minute": from_minute, "mode": "running"}


@app.get("/agent/memory")
def agent_memory() -> dict[str, Any]:
    """Inspect cross-tick memory — useful for debugging dedup behavior."""
    return {
        "broadcast_history": list(_broadcast_history),
        "seen_event_count": len(_seen_event_ids),
    }


@app.get("/markets")
def markets_list() -> dict[str, Any]:
    """For agent discovery: which market_ids exist and what they're about."""
    return {
        "markets": [
            {"market_id": m["market_id"], "question": m["question"], "type": m.get("sports_market_type")}
            for m in load_markets(MATCH_ID)
        ]
    }
