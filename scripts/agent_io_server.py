"""agent_io_server — one process for the agent's HTTP needs.

  • GET  /market/{market_id}/window  → market_state_lookup
  • GET  /events_window              → events_commentary_lookup
  • GET  /knowledge/search           → knowledge_lookup (historical KB)
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
import re
from collections import deque
from functools import lru_cache
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from scripts.tools.events_commentary_lookup import events_commentary_lookup
from scripts.tools.knowledge_lookup import knowledge_for_match, knowledge_search
from scripts.tools.match_context import build_match_context
from scripts.tools.match_state import filter_feasible_movers, score_at_minute
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
SESSION_ID = os.environ.get("EDGECAST_SESSION_ID", f"edgecast-{MATCH_ID}")
TICK_GAME_MINUTES = float(os.environ.get("EDGECAST_TICK_GAME_MINUTES", "5"))
TICK_POLL_SECONDS = float(os.environ.get("EDGECAST_TICK_POLL_SECONDS", "1"))
WEBHOOK_URL = os.environ.get(
    "EDGECAST_WEBHOOK_URL",
    "http://localhost:8080/api/pipelines/test.pipe/webhook",
)
LOOKBACK_MIN = float(os.environ.get("EDGECAST_LOOKBACK_MIN", "5"))
TICK_ENABLED = os.environ.get("EDGECAST_TICK_ENABLED", "1") == "1"
TOP_MOVERS = int(os.environ.get("EDGECAST_TOP_MOVERS", "5"))
CONTEXT_RECENT_MIN = float(os.environ.get("EDGECAST_CONTEXT_RECENT_MIN", "15"))
KNOWLEDGE_IN_PAYLOAD = int(os.environ.get("EDGECAST_KNOWLEDGE_IN_PAYLOAD", "3"))
CHAT_HISTORY_MAX = int(os.environ.get("EDGECAST_CHAT_HISTORY", "20"))
CHAT_IN_TICK_MAX = int(os.environ.get("EDGECAST_CHAT_IN_TICK", "6"))

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
_chat_history: deque[dict[str, Any]] = deque(maxlen=CHAT_HISTORY_MAX)
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
    return filter_feasible_movers(MATCH_ID, now_minute, rows[:k])


def _recent_chat_turns(limit: int = CHAT_IN_TICK_MAX) -> list[dict[str, Any]]:
    return list(_chat_history)[-limit:]


def build_tick_payload(now: datetime, lookback_min: float | None = None) -> dict[str, Any]:
    """The dict POSTed to the RocketRide webhook each tick.

    Window semantics: one game-time interval (default 5 match-minutes).
    """
    now_minute = current_match_minute()
    lookback = lookback_min if lookback_min is not None else max(LOOKBACK_MIN, TICK_GAME_MINUTES)
    since_minute = max(0.0, now_minute - lookback)

    match_score = score_at_minute(MATCH_ID, now_minute)
    match_context = build_match_context(
        MATCH_ID,
        now_minute,
        recent_minutes=CONTEXT_RECENT_MIN,
    )
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

    knowledge_context = knowledge_for_match(MATCH_ID, limit=KNOWLEDGE_IN_PAYLOAD)

    return {
        "mode": "tick",
        "session_id": SESSION_ID,
        "match_id": MATCH_ID,
        "tick_ts": now.isoformat(),
        "match_minute": round(now_minute, 2),
        "match_score": match_score,
        "match_context": match_context,
        "knowledge_context": knowledge_context,
        "since_minute": round(since_minute, 2),
        "lookback_min": round(lookback, 2),
        "new_key_events": window_events,
        "new_commentary": ec.get("commentary", []),
        "polymarket_top_movers": movers,
        "previously_seen_key_event_ids": previously_seen_in_window,
        "prior_broadcasts": list(_broadcast_history),
        "chat_history": _recent_chat_turns(),
        "hint": (
            "You are EdgeCast — game-intelligence copilot. Surface ONE "
            "OPPORTUNITY if game trends and market prices look misaligned "
            "(not a raw price ticker). Connect pitch read → markets at Xc → "
            "why it is interesting. match_context holds the full match story "
            "up to now (goals, cards, subs, highlight commentary). "
            "knowledge_context holds preloaded historical player/team/matchup "
            "notes — use GET /knowledge/search for deeper lookups. "
            "chat_history holds recent trader questions — factor them in if "
            "relevant. Use match_score to ignore dead markets. Otherwise "
            "return empty string. Dedup against previously_seen_key_event_ids "
            "and prior_broadcasts."
        ),
    }


def build_chat_payload(question: str, minute: float | None = None) -> dict[str, Any]:
    """Rich one-shot chat payload with full match context + conversation memory."""
    now = datetime.now(timezone.utc)
    now_minute = current_match_minute() if minute is None else float(minute)
    lookback = max(LOOKBACK_MIN, TICK_GAME_MINUTES)
    since_minute = max(0.0, now_minute - lookback)
    match_score = score_at_minute(MATCH_ID, now_minute)
    match_context = build_match_context(MATCH_ID, now_minute, recent_minutes=CONTEXT_RECENT_MIN)
    ec = events_commentary_lookup(MATCH_ID, since_minute, now_minute, "both")
    movers = compute_top_movers(now_minute, lookback, TOP_MOVERS)
    knowledge_context = knowledge_for_match(
        MATCH_ID,
        extra_query=question,
        limit=KNOWLEDGE_IN_PAYLOAD,
    )

    return {
        "mode": "chat",
        "session_id": SESSION_ID,
        "match_id": MATCH_ID,
        "tick_ts": now.isoformat(),
        "match_minute": round(now_minute, 2),
        "match_score": match_score,
        "match_context": match_context,
        "knowledge_context": knowledge_context,
        "question": question,
        "since_minute": round(since_minute, 2),
        "lookback_min": round(lookback, 2),
        "new_key_events": ec.get("events", []),
        "new_commentary": ec.get("commentary", []),
        "polymarket_top_movers": movers,
        "prior_broadcasts": list(_broadcast_history),
        "chat_history": list(_chat_history),
        "hint": (
            f'Trader question: "{question}". Answer in 3–5 sentences using '
            "match_context, knowledge_context, match_score, chat_history, and "
            "cent prices. Reference prior chat turns when the question is "
            "follow-up. Use GET /knowledge/search for player/team history or "
            "prior matchups; use other tools for live windows. Do not suggest orders."
        ),
    }


@lru_cache(maxsize=1)
def _load_agent_instructions() -> str:
    """Read agent instructions from test.pipe (same source as smoke script)."""
    pipe_path = Path(__file__).resolve().parents[1] / "test.pipe"
    raw = pipe_path.read_text(encoding="utf-8")
    cleaned = re.sub(r",(\s*[\]}])", r"\1", raw)
    pipe = json.loads(cleaned)
    for agent_id in ("agent_rocketride_1", "agent_deepagent_1"):
        agent = next((c for c in pipe["components"] if c["id"] == agent_id), None)
        if not agent:
            continue
        cfg = agent.get("config", {})
        instructions = cfg.get("instructions") or cfg.get("default", {}).get("instructions") or []
        if instructions:
            return "\n\n".join(instructions)
    return ""


async def _call_gmi_direct(payload: dict[str, Any]) -> str:
    """Fallback when RocketRide webhook is offline."""
    api_key = os.environ.get("GMI_API_KEY") or os.environ.get("ROCKETRIDE_GMI_API_KEY")
    if not api_key:
        log.warning("GMI fallback skipped — no API key")
        return ""
    instructions = _load_agent_instructions()
    if not instructions:
        log.warning("GMI fallback skipped — no agent instructions in test.pipe")
        return ""
    model = os.environ.get("GMI_MODEL", "google/gemini-3.5-flash")
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps(payload, indent=2)},
        ],
        "temperature": 0.2,
        "max_tokens": 400 if payload.get("mode") == "tick" else 2000,
    }
    async with httpx.AsyncClient(timeout=45) as gmi:
        r = await gmi.post(
            "https://api.gmi-serving.com/v1/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
        )
    if r.status_code >= 300:
        log.warning("GMI fallback HTTP %s: %s", r.status_code, r.text[:200])
        return ""
    try:
        return (r.json()["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, json.JSONDecodeError):
        return ""


async def _post_webhook(payload: dict[str, Any], client: httpx.AsyncClient) -> str:
    try:
        r = await client.post(WEBHOOK_URL, json=payload)
    except httpx.RequestError as e:
        log.warning("webhook request failed: %s", e)
        return ""
    log.info("webhook %s %s", r.status_code, r.text[:120] if r.text else "")
    if r.status_code >= 300 or not r.text:
        return ""
    try:
        return _extract_broadcast(r.json())
    except (json.JSONDecodeError, ValueError):
        return r.text.strip()


async def _resolve_agent_answer(payload: dict[str, Any], client: httpx.AsyncClient) -> str:
    answer = await _post_webhook(payload, client)
    if answer:
        return answer
    log.info("RocketRide unavailable — using direct GMI fallback")
    return await _call_gmi_direct(payload)


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
    r = await _resolve_agent_answer(payload, client)
    if r:
        broadcast_text = r
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
                    _last_tick_bucket = bucket
                    await _fire_tick(client)
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
        "session_id": SESSION_ID,
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


@app.get("/knowledge/search")
def knowledge_search_endpoint(
    q: str = Query(""),
    entity: str | None = Query(None),
    chunk_type: str | None = Query(None, alias="type"),
    match_id: str | None = Query(None),
    limit: int = Query(3, ge=1, le=10),
) -> dict[str, Any]:
    """Keyword search over historical KB chunks (players, teams, matchups)."""
    parsed_type = chunk_type if chunk_type in ("player", "team", "matchup", "commentary") else None
    return knowledge_search(
        q,
        match_id=match_id or MATCH_ID,
        entity=entity,
        chunk_type=parsed_type,  # type: ignore[arg-type]
        limit=limit,
    )


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
    _chat_history.clear()
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
        _last_tick_bucket = game_tick_bucket(minute) - 1
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
        "chat_history": list(_chat_history),
        "seen_event_count": len(_seen_event_ids),
        "broadcast_history_max": BROADCAST_HISTORY_MAX,
        "chat_history_max": CHAT_HISTORY_MAX,
    }


@app.post("/agent/chat")
async def agent_chat(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Chat with memory: stores Q&A in _chat_history and routes via RocketRide webhook."""
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")

    minute_raw = body.get("match_minute")
    minute = float(minute_raw) if minute_raw is not None else None
    payload = build_chat_payload(question, minute)
    question_minute = payload["match_minute"]

    async with httpx.AsyncClient(timeout=45) as client:
        answer = await _resolve_agent_answer(payload, client)

    if not answer:
        raise HTTPException(502, "Agent returned no answer (RocketRide + GMI fallback both failed)")

    _chat_history.append({
        "role": "user",
        "match_minute": question_minute,
        "text": question,
    })
    _chat_history.append({
        "role": "assistant",
        "match_minute": question_minute,
        "text": answer,
    })

    return {
        "answer": answer,
        "modelUsed": "gemini-3.5-flash (RocketRide or GMI direct)",
        "chat_turns": len(_chat_history),
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
