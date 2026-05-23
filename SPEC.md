# EdgeCast — Hackathon Spec (v4 — periodic agent, file-based stores, no vector corpus)

> A market-aware co-watcher for live sports prediction markets.
> Built for the **Google I/O Kickoff: Pre-World Cup Hack** — May 23, 2026.

---

## Status

- **Now:** ~4:30 PM PDT
- **Submission:** 5:00 PM PDT
- **Demo:** 5:10 PM (3 min + 2 min Q&A)
- **Repo:** [pratikm778/world-cup-hack-2026](https://github.com/pratikm778/world-cup-hack-2026)
- **API key:** `GMI_API_KEY` + `ROCKETRIDE_GMI_API_KEY` in `.env` (same value). `.env` is gitignored.
- **Architecture pivot since v3:** vector store + fact corpus deferred;
  agent reasons over a fresh-window tick payload plus two HTTP lookup
  tools backed by the on-disk match data. `tool_python` dropped (sandbox
  blocks filesystem). Source switched to `webhook` (periodic cron-driven).

### Team (collaborators on repo, push access)

| Member | GitHub | Track |
| --- | --- | --- |
| Pratik | `pratikm778` (owner) | **C** — RocketRide pipeline, prompts, agent IO server, lookup tools |
| Sajay | `sajayv98` | **A** — Frontend, three-pane UI, SSE consumption |
| Kaushik Sivakumar | `KaushikSiva` | **B** — FastAPI backend, replay engine, /api/chat, seed data, fallbacks |

---

## One-sentence pitch

> "Sports prediction markets move faster than human attention. EdgeCast watches every market, brings in the historical context a human would already know, and narrates what's moving — live, on GMI Cloud's GPUs, with Google's newest Gemini."

---

## Decisions (locked — do not relitigate)

| Decision | Value |
| --- | --- |
| **Data source** | Static JSON pulled once from ESPN + Polymarket (`scripts/providers/`), seeded under `data/matches/<id>/`. No live scraping during demo. |
| **Demo mode** | Live LLM calls, **periodic 60s cron tick** (not event-triggered), 5s timeout + per-tick fallback templates. |
| **Trigger model** | Periodic, not event-driven. External cron POSTs a fresh-window payload (last 5 min of events, commentary, top-5 polymarket movers) to the RocketRide webhook every `TICK_SECONDS`. Agent decides per tick whether to broadcast or stay silent. |
| **Brand** | Generic "sports prediction markets." Polymarket name appears nowhere. |
| **Agent** | `agent_deepagent` (not `agent_rocketride`). No memory port; cross-event recall handled via fresh-window payload + lookup tools. |
| **LLM (single)** | `llm_gmi_cloud` with **Custom profile** → `google/gemini-3.5-flash` via `https://api.gmi-serving.com/v1`. **Ticks GMI Cloud + Google requirements in one call.** |
| **Agent tools** | `tool_http_request` (whitelisted to `localhost:8765`, calls the agent IO server's lookup endpoints), `tool_exa_search` (player/team lookup). `tool_python` was evaluated and dropped — its sandbox has no filesystem/network access. |
| **Historical context** | **Deferred.** Vector store + `vectordb_postgres` + `facts.jsonl` cut from v1; agent reasons over the fresh-window payload + lookup tools only. Revisit if time allows. |
| **Lookup tools** | Two HTTP endpoints on a local FastAPI (`scripts/agent_io_server.py`): `GET /market/{id}/window` (polymarket price history, agg=raw/delta/range) and `GET /events_window` (key_events + commentary by minute window). Both read directly from `data/matches/<id>/`. |
| **Env var interpolation** | RocketRide only substitutes `${ROCKETRIDE_*}` vars in `.pipe` configs (per docs). GMI key lives twice in `.env`: `GMI_API_KEY` for application code, `ROCKETRIDE_GMI_API_KEY` for the pipeline file. |
| **Scaffold** | Copy `rocketride-workshops/workshops/coding-agent/solution/` as the starting skeleton. |
| **Name** | EdgeCast (placeholder — only swap once in the first 10 min, then stop). |

### Why single LLM (judging narrative)

> "Everything routes through GMI Cloud's OpenAI-compatible API serving Google's newest model — Gemini 3.5 Flash. One API call covers two of the three required vendors. RocketRide orchestrates the pipeline; GMI's H100s do the inference; Google's model does the reasoning. Three sponsors, one clean architecture, zero glue code between vendors."

---

## Architecture

```text
┌────────────────────────────────────────────────────────┐
│  Browser (Vite + React, 3 panes)                       │
│  ┌─────────────┬──────────────────┬────────────────┐   │
│  │ Chat feed   │ Minute clock +   │ Hot Markets    │   │
│  │ (40%)       │ commentary (35%) │ sidebar (25%)  │   │
│  └─────────────┴──────────────────┴────────────────┘   │
│         ▲                                              │
│         │ SSE: broadcast msgs                          │
└─────────┼──────────────────────────────────────────────┘
          ▼
┌─────────────────────────────────────────────────────────┐
│  agent_io_server.py — single Python process (port 8765) │
│                                                         │
│  Background tick loop  (every EDGECAST_TICK_SECONDS):   │
│   build_tick_payload(now, last_tick)                    │
│     • match_minute, since_minute, lookback_min          │
│     • new_key_events    (key_events.json windowed)      │
│     • new_commentary    (commentary.json windowed)      │
│     • polymarket_top_movers   (top-5 by abs delta_c)    │
│   POST → RocketRide webhook (test.pipe)                 │
│                                                         │
│  HTTP endpoints (called by agent via tool_http_request):│
│   GET  /market/{market_id}/window?start_min&end_min&agg │
│        → market_state_lookup (raw|delta|range)          │
│   GET  /events_window?start_min&end_min&kind&key_only   │
│        → events_commentary_lookup (both | events | …)   │
│   GET  /markets    → market_id ↔ question index         │
│   POST /replay/{seek,start}  → demo clock control       │
│   GET  /health                                          │
│                                                         │
│  Reads:  data/matches/<id>/{meta,key_events,commentary, │
│                              markets}.json              │
│          data/matches/<id>/prices/<token_id>.json       │
└──────────┬──────────────────────────────────────────────┘
           │ POST every TICK_SECONDS
           ▼
┌─────────────────────────────────────────────────────────┐
│  RocketRide pipeline (test.pipe)                        │
│                                                         │
│   webhook ─► agent_deepagent ─► response_answers        │
│                  │                                      │
│                  ├─► llm_gmi_cloud                      │
│                  │    profile: custom (Gemini 3.5 Flash)│
│                  │                                      │
│                  ├─► tool_http_request                  │
│                  │    urlWhitelist: localhost:8765      │
│                  │    (calls the lookup endpoints above)│
│                  │                                      │
│                  └─► tool_exa_search                    │
│                       (player / team breaking-news)     │
└─────────────────────────────────────────────────────────┘
```

### Key design decisions (why this shape)

- **Periodic, not event-driven.** Every tick the agent re-evaluates the
  world; silence is a valid output. Avoids enumerating event types
  upstream and matches the cron model the team asked for.
- **`tool_python` rejected, HTTP instead.** RocketRide's `tool_python`
  runs in a RestrictedPython sandbox with no filesystem or network
  access (`rocketride-server/nodes/src/nodes/tool_python/README.md:49`).
  Cannot read `data/matches/`. Solution: expose the lookup functions
  as a local FastAPI; agent reaches them with the `tool_http_request`
  it already had.
- **Files-on-disk are the store.** No DB, no vector index. The
  fresh-window payload is what the agent sees by default; the two
  lookup endpoints let it pull any wider window from the same JSON.
- **Replay clock lives in `agent_io_server`.** `POST /replay/start?
  from_minute=70` anchors the clock; tick loop + lookups all read
  through `current_match_minute()`. Wall-clock would put us in May
  2026 with a match that happened April 19.

---

## Repository layout

```text
gmi-io/
├── test.pipe                     # RocketRide pipeline (Track C)
├── scripts/
│   ├── agent_io_server.py        # FastAPI: tick loop + lookup endpoints + replay clock
│   ├── tools/
│   │   ├── match_helpers.py      # Shared: kickoff, minute↔ts, market index, cents
│   │   ├── market_state_lookup.py    # Polymarket window queries
│   │   └── events_commentary_lookup.py  # Events + commentary window queries
│   └── providers/                # One-time data pull (already run)
│       ├── espn.py               # ESPN events + commentary
│       └── polymarket.py         # Gamma (markets) + CLOB (price history)
├── data/matches/<id>/            # Seeded once, read by agent_io_server
│   ├── meta.json                 # short_id, kickoff_utc, teams
│   ├── markets.json              # 37 markets across 5 sibling events
│   ├── key_events.json           # In-game events (goal, card, sub, …)
│   ├── commentary.json           # Minute-by-minute commentary
│   └── prices/<token_id>.json    # Price history per outcome token
├── ui/                           # Vite + React (Track A — separate dir)
├── .env                          # NOT committed
├── .env.example                  # Committed, no real values
└── SPEC.md                       # This file
```

### Application server (Track B) — separate from the pipeline

Track B's FastAPI is a **separate process** from `agent_io_server`. It owns
the browser-facing SSE and `/api/chat`. `agent_io_server` owns the agent's
view of the world (ticks + lookups). They can run side by side; in a tight
hackathon they can be merged into one app if Track B prefers.

### `.env.example` (committed)

```bash
# GMI Cloud API - smoke target: google/gemini-3.5-flash at https://api.gmi-serving.com/v1
GMI_API_KEY=
# Same key, ROCKETRIDE_-prefixed so it interpolates into .pipe files.
ROCKETRIDE_GMI_API_KEY=

# EdgeCast agent IO server (scripts/agent_io_server.py)
EDGECAST_MATCH_ID=ars-man-2026-04-19
EDGECAST_TICK_SECONDS=60
EDGECAST_LOOKBACK_MIN=5
EDGECAST_TOP_MOVERS=5
EDGECAST_TICK_ENABLED=1
EDGECAST_WEBHOOK_URL=http://localhost:8080/api/pipelines/test.pipe/webhook
```

---

## Demo scenario — Man City vs Arsenal, 2026-04-19

Real data, not hand-authored. The match was 1-1 at half, City scored to make
it 2-1, then a late period. Demo seeks via `POST /replay/start?from_minute=N`
and the tick loop fires every `TICK_SECONDS`. Observed payload behavior at
key minutes (smoke-tested):

| Match minute | Tick payload signal | What the agent should broadcast |
| --- | --- | --- |
| 45' (halftime) | `halftime` event + Arsenal substitution; **"Exact 2-1" +39c, "Exact 1-1" −38c, "Arsenal leading at HT" −34c** | Big alert — the market already priced in a second-half City goal |
| 75' | Two Arsenal subs in commentary; **corners O/U 9.5 +16c** | Mid alert — late-game pressure on corners |
| 0-45' baseline | Ordinary fouls + corners, market deltas <5c | Silent (gate works) |

**Markets in play (37 in `data/matches/<id>/markets.json`):** 5 sibling
Polymarket events — main 3-way moneyline + spreads/totals/BTTS, halftime
moneyline, exact-score grid (~24 cells), and total-corners O/U at multiple
thresholds. Each market has 2 outcome tokens; the lookup reads the "Yes"
token by default.

---

## Historical context — DEFERRED in v1

The original SPEC called for a 30-40 snippet `facts.jsonl` corpus indexed
in pgvector. **This is cut from v1.** The agent reasons over:

1. The fresh-window tick payload (everything new since `now - 5min`).
2. `market_state_lookup` for deeper polymarket history.
3. `events_commentary_lookup` for deeper match history.
4. `tool_exa_search` for player/team breaking news (kept on the broadcast
   path — known latency risk, but accepted; see Risks).

If time allows post-demo, the fact corpus can be re-added without
restructuring: add `embedding_transformer` + `vectordb_postgres` nodes
back into `test.pipe` and write a one-shot `corpus_loader.py`.

---

## The RocketRide pipeline — `test.pipe`

Live in `test.pipe` at repo root. Nodes (read the file for full config):

| Node | Provider | Role |
| --- | --- | --- |
| `webhook_1` | `webhook` | Source. Receives tick payloads from `agent_io_server`. |
| `agent_deepagent_1` | `agent_deepagent` | The agent. Input lane: `questions` from `webhook_1`. |
| `llm_gmi_cloud_1` | `llm_gmi_cloud` | Profile `gemini-3-flash` (built-in, not Custom — see note). API key via `${ROCKETRIDE_GMI_API_KEY}`. |
| `tool_http_request_1` | `tool_http_request` | Whitelisted to `http://localhost:8765`. Agent uses this to call `/market/{id}/window`, `/events_window`, `/markets`. |
| `tool_exa_search_1` | `tool_exa_search` | Player/team breaking-news lookup. |
| `response_answers_1` | `response_answers` | Terminal node returning the agent's broadcast. |

**Divergences from the original SPEC draft (v3):**

- `chat` source → `webhook` source: webhook accepts the structured tick
  payload as JSON; `chat` is for free-text questions.
- `agent_rocketride` → `agent_deepagent`: deepagent is what the GMI fork
  ships; deepagent has no memory port, which is fine because cross-event
  recall lives in the tick payload + lookup tools, not in `memory_internal`.
- `tool_python` (market_state_lookup) → `tool_http_request` calling
  `agent_io_server` endpoints. The python sandbox cannot read `data/`.
- `vectordb_postgres` + `embedding_transformer` removed (corpus deferred).
- Custom-profile Gemini 3.5 Flash → built-in `gemini-3-flash` profile.
  Reduces config surface; revert to Custom if 3.5 is required for judging.

**Env var interpolation:** `${GMI_API_KEY}` does NOT interpolate — RocketRide
only substitutes `${ROCKETRIDE_*}`-prefixed vars in `.pipe` files (per
`ROCKETRIDE_COMPONENT_REFERENCE.md`). Set both `GMI_API_KEY` and
`ROCKETRIDE_GMI_API_KEY` to the same value in `.env`.

### Direct GMI smoke test

Run this before wiring `/api/chat`; it proves `.env`, the API route, and the model id work without exposing secrets:

```bash
set -a
source .env
set +a

curl --request POST \
  --url https://api.gmi-serving.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${GMI_API_KEY}" \
  --data '{
    "model": "google/gemini-3.5-flash",
    "messages": [
      {"role": "system", "content": "You are a helpful AI assistant"},
      {"role": "user", "content": "List 3 countries and their capitals."}
    ],
    "temperature": 0,
    "max_tokens": 500
  }'
```

**Setup-time gotcha:** pgvector extension must exist. Track C smoke-tests this in C2: `psql -d edgecast -c "CREATE EXTENSION IF NOT EXISTS vector;"`. If Postgres setup drags past 2:50 PM, fallback is a `tool_python` that does in-memory cosine similarity over a precomputed numpy embedding matrix — same product behavior, no DB.

---

## Gemini prompts

### `prompts/movement_alert.txt`

```text
You are EdgeCast, a trader-terse sports prediction market analyst.

INPUT:
- event: { minute, type, team?, player?, description }
- market_snapshot: current prices + 2-minute deltas for all markets
- historical_context: top 2 relevant facts from the vector store (may be empty)

OUTPUT: ONE broadcast message, ≤3 lines:
  Line 1: "{minute}' — {top_market}: {old}→{new}c. {1-3 other markets} also moving."
  Line 2: One sentence of trader-style context for why.
  Line 3 (if historical_context non-empty): "Context: {short fact}."

RULES:
- Cents (e.g., 28c). Never percentages.
- Never predict. Never recommend bets.
- No exclamation marks. No emoji.
- 200 tokens max.
```

### `prompts/state_summary.txt`

```text
You are EdgeCast, summarizing the market board.

INPUT: current minute, all markets w/ price + 5-min delta, last 3 events, historical_context.

OUTPUT: 3 lines:
  Line 1: "{minute}' Status: {1-sentence narrative}."
  Line 2: "Top 3 movers (5m): {market} {Δ}c, {market} {Δ}c, {market} {Δ}c."
  Line 3: "Quietest: {market}, {market}."

RULES: same as movement_alert. 200 tokens max.
```

### `prompts/chat_qa.txt`

```text
You are EdgeCast answering a single user question.

CONTEXT:
- Current minute, all markets with price + 5-min delta (from the tick payload)
- Recent events + commentary (from the tick payload)
- Optional: deeper history via `tool_http_request` GET /events_window or
  /market/{id}/window
- Optional: external player/team info via `tool_exa_search`

RULES:
- One-shot. No clarifying questions.
- 3-5 sentences max. Cite specific prices when relevant.
- Refusals (exact wording):
  · "place a bet" / "should I buy" / "should I cash out" → "EdgeCast watches markets — it doesn't place orders."
  · "what will happen" / "predict" → "I can show you what's moving, not what will happen."
- Trader-terse. 200 tokens max.
```

### Tick prompt (per-broadcast)

This lives in `build_tick_payload` (`scripts/agent_io_server.py`) as the
`hint` field, attached to each tick payload. Move it into
`agent_deepagent_1.config.instructions` once the wording stabilizes:

```text
You are EdgeCast. Each tick you receive:
  match_id, match_minute, since_minute, lookback_min,
  new_key_events, new_commentary, polymarket_top_movers.

If anything is broadcast-worthy (a goal, card, sub, or market move ≥5c),
produce ONE trader-terse alert. Otherwise return an empty string.

Tools (call only when the tick payload is insufficient):
  - tool_http_request GET http://localhost:8765/market/{market_id}/window
      ?start_min=&end_min=&agg=raw|delta|range
  - tool_http_request GET http://localhost:8765/events_window
      ?start_min=&end_min=&kind=both|events|commentary
  - tool_exa_search for player/team breaking news

Prices in integer cents. 200 tokens max. Never recommend bets, never predict.
```

---

## Fallback templates — `api/app/fallbacks.py`

Used when the LLM call exceeds 5s, errors, or returns empty. **No historical_context in fallbacks** — keep them deterministic.

```python
def movement_alert_fallback(event, top_markets):
    top = top_markets[0]
    others = ", ".join(f"{m['name']} {m['old']}→{m['new']}c" for m in top_markets[1:3])
    return (
        f"{event['minute']}' — {top['name']}: {top['old']}→{top['new']}c. "
        f"{event.get('description', '')}\n"
        f"Also moving: {others}."
    )

def state_summary_fallback(minute, top_movers, quietest):
    movers = ", ".join(f"{m['name']} {m['delta']:+d}c" for m in top_movers[:3])
    return (
        f"{minute}' Status: market stable.\n"
        f"Top 3 movers (5m): {movers}.\n"
        f"Quietest: {quietest[0]['name']}, {quietest[1]['name']}."
    )

def chat_qa_fallback(question):
    return "Hit a hiccup answering that — try rephrasing or asking about a specific market."
```

---

## Demo data — `data/matches/<id>/*.json` (Track B already done)

Real data pulled from ESPN + Polymarket via `scripts/providers/`. One match
seeded so far: `ars-man-2026-04-19` (Manchester City vs Arsenal, Premier
League, finished 2-1 City).

| File | Shape | Notes |
| --- | --- | --- |
| `meta.json` | `{short_id, home, away, kickoff_utc, polymarket_event_slug, espn_game_id}` | Used by `match_helpers.kickoff()` for minute↔ts conversion. |
| `markets.json` | List of 37 markets. Each: `{market_id, question, outcomes[], token_ids[], sports_market_type, metadata}` | 5 Polymarket sibling events: moneyline, halftime, exact-score, totals, corners. |
| `key_events.json` | List. Each: `{type:{type, text}, clock:{value:seconds}, text, wallclock}` | 19 events. `clock.value` is **seconds**, divide by 60 for match-minute. |
| `commentary.json` | List. Each: `{minute, text, ts_utc, raw_event_type, players, team}` | 96 entries, minute 0-90. |
| `events.json` | Polymarket *event-group* metadata (the betting event, not match events). | Generally not used by the agent. |
| `prices/<token_id>.json` | `{token_id, market_id, outcome, question, windows:{pre_match,in_match}, points:[{ts_utc, price}]}` | 74 token files. `points` is the full pre+in-match curve sorted by `ts_utc`. `windows.in_match.point_count` is metadata, NOT a separate array. |

To seed another match: run `scripts/seed_match.py` with a new slug.

---

## Track A — Frontend (sajayv98)

| # | Item | File(s) | Done when | Est |
| --- | --- | --- | --- | --- |
| A1 | Scaffold from workshop solution UI, strip branding | `ui/` | `pnpm dev` boots, localhost:5173 shows blank shell | 20m |
| A2 | Three-pane CSS grid (40/35/25) | `App.tsx` | Three panes render at fixed widths | 25m |
| A3 | Clock pane: minute display + commentary scroll | `ClockPane.tsx` | Polls `/api/state` every 1s; minute updates; commentary line reveals on tick | 35m |
| A4 | Markets pane: top-5 hot list + CSS glow on update | `MarketsPane.tsx` | Sorted by abs(delta_2min) desc; row glows yellow 3s on price change | 35m |
| A5 | Chat pane: SSE consumer + user input | `ChatPane.tsx` | SSE messages render with urgency colors; Enter on input POSTs `/api/chat` and renders the response | 50m |
| A6 | Polish: fonts, colors, urgency tokens, layout balance | (CSS) | Demo screenshot quality | 25m |

**Track A total: ~3h 10m.** A6 is the squeezable item.

---

## Track B — Backend, replay, seed data, fallbacks (KaushikSiva)

| # | Item | File(s) | Done when | Est |
| --- | --- | --- | --- | --- |
| B1 | Scaffold from workshop solution API, strip branding | `api/` | `uvicorn` runs, `/api/health` returns 200 | 15m |
| B2 | Author all 4 `demo-data/*.json` files | `demo-data/*.json` | Valid JSON; price-curves covers all 12 markets minutes 75-90 with realistic jumps at event minutes | 40m |
| B3 | Replay clock + `/api/state` endpoint | `replay.py`, `main.py` | Returns `{minute, prices, last_events[]}`; advances every 6s; resets via POST `/api/replay/reset` | 40m |
| B4 | `/api/events` SSE stream | `main.py` | Connecting client receives event payloads as they fire (replay engine posts to an asyncio queue) | 25m |
| B5 | `/api/chat` POST endpoint that calls the RocketRide pipe | `main.py` | curl returns Gemini answer with current state injected; 5s timeout enforced | 25m |
| B6 | `fallbacks.py` + 5s timeout wrappers around both LLM call paths | `fallbacks.py`, `main.py` | Disabling wifi → broadcast still emits fallback within 5s | 20m |

**Track B total: ~2h 45m.** Comfortable.

---

## Track C — RocketRide pipeline + agent IO server + prompts (pratikm778)

Reflects the actual built state. Postgres/vector items removed (deferred);
agent IO server replaces them. Items marked ✅ already shipped.

| # | Item | File(s) | Done when | Est | Status |
| --- | --- | --- | --- | --- | --- |
| C1 | Install RocketRide VS Code extension; deploy "Local" server | (IDE) | Extension running, can open `test.pipe` | 15m | ✅ |
| C2 | Author `test.pipe`: webhook → agent_deepagent → llm_gmi_cloud + tool_http_request + tool_exa_search → response_answers | `test.pipe` | All nodes render in canvas, no validation errors | 25m | ✅ |
| C3 | Smoke test via IDE chat using `${ROCKETRIDE_GMI_API_KEY}` from `.env` | (IDE chat) | Test message returns Gemini response within 5s | 15m | ⏳ |
| C4 | Implement `scripts/tools/{market_state_lookup,events_commentary_lookup,match_helpers}.py` | `scripts/tools/` | `python -c "from scripts.tools…"` smoke passes | 30m | ✅ |
| C5 | Build `agent_io_server.py`: tick loop + lookup endpoints + replay clock | `scripts/agent_io_server.py` | `uvicorn` runs; `/health` ok; replay seek works | 45m | ✅ |
| C6 | End-to-end test: start agent_io_server → start replay at 70' → confirm RocketRide receives tick payloads and agent emits broadcasts | (manual) | At least 3 sequential ticks produce sensible output | 25m | ⏳ |
| C7 | Author `agent_deepagent_1.config.instructions` (tick prompt + chat prompt + refusal rails) | `test.pipe` | Agent stays silent on quiet ticks; broadcasts on score change; refuses "should I buy?" | 40m | ⏳ |
| C8 | Wire Track B's `/api/events` SSE consumer to RocketRide responses | (Track B side) | Browser SSE receives broadcasts produced by ticks | 15m | ⏳ |

**Track C remaining: ~95m.** Squeeze: C8 can be cut if Track B integrates
directly with `response_answers` output instead of waiting on RocketRide.

---

## Remaining wall-clock to 5:00 PM

Schedule re-baselined; v3 schedule kept only for reference in commit history.
Right now:

| Track | Remaining critical-path |
| --- | --- |
| C (Pratik) | IDE smoke (C3) → end-to-end ticks (C6) → instructions prompt (C7). |
| B (Kaushik) | `/api/events` SSE bridging to `response_answers_1` so the UI sees broadcasts. |
| A (Sajay) | Connect SSE consumer to the new event stream; minimal polish. |

Joint end-to-end smoke + dress rehearsal in the last 10 minutes.

---

## Demo script (90 seconds — Man City vs Arsenal, 2026-04-19)

**0:00–0:10 — Frame**
"Sports prediction markets move faster than human attention. During a soccer match there can be 200+ live markets across a single game. We watch every one of them and decide what's worth telling you."

**0:10–0:25 — Quiet baseline**
[`POST /replay/start?from_minute=30`] "Minute 30. Even game, market quiet. The agent is silent — every 60 seconds it looks, sees nothing broadcast-worthy, says nothing. That restraint is the product."

**0:25–1:05 — Halftime cascade**
[Seek to 45'.] "Halftime arrives. Watch what the market does before the second half even starts: exact-score 2-1 jumps +39c, 1-1 collapses −38c, Arsenal-leading-at-HT drops −34c. The market is already pricing in a City goal. The agent sees all three deltas in one tick payload, picks the headline, and broadcasts."
[Show the RocketRide canvas for 2 seconds.] "One pipeline. RocketRide orchestrating, GMI Cloud serving Gemini, a local FastAPI feeding the agent its window of the match. The agent can pull deeper history through HTTP tools whenever a tick isn't enough."

**1:05–1:25 — Live chat**
[Type:] "Why are the corner totals climbing?"
[Agent calls `/events_window` for 70-75', spots the two Arsenal subs, answers.] "Live Gemini on GMI's GPUs, reasoning over real Polymarket data and real ESPN commentary, in under three seconds."

**1:25 — Close**
"Today, one match, thirty-seven markets, seventy-four price curves. Point the same pipeline at any match, any sport, any prediction market. That's the product."

---

## Out of scope (refer back when tempted)

- Position tracking / "My Positions" sidebar
- "I bet on X" buttons / order entry / cash-out suggestions
- Pre-event flags / "agent saw it coming" pre-predictions
- Fine-tuned classifier on GMI
- **Vector store + fact corpus (deferred to v2)**
- A second LLM node (single-LLM via GMI does it all)
- Live polymarket scraping during demo (data was pulled once via providers)
- Multi-match support (architecture supports it, demo runs one match)
- User accounts / auth / persistence beyond match-time state
- "Why?" trace panel (show the RocketRide canvas live instead)
- Mobile responsive / dark mode polish
- Video clip in center pane

---

## Risks + mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `${ROCKETRIDE_GMI_API_KEY}` doesn't interpolate at runtime | Med | Hard-paste the key during build (kept off git via `.env`), refactor before commit. Three spots in `test.pipe`. |
| `agent_deepagent` ignores `tool_http_request` because schema differs | Med | Verify in IDE: send a tick payload, watch trace for HTTP calls. If broken, fall back to inlining last-5-min payload only; lookups become non-functional but base broadcasts still work. |
| `tool_http_request` latency to `localhost:8765` blows the 5s budget | Low | Endpoints are pure file reads, <50ms. Cache-warm on first call. |
| Agent calls Exa on every broadcast tick → 2-3s extra latency | Med | Tighten prompt to "only call Exa for chat questions, not ticks". |
| Wall-clock leaks into demo (forgot to `/replay/start`) | Med | Add a startup banner check; `EDGECAST_FAKE_MINUTE` env var as a belt-and-suspenders default. |
| `google/gemini-3-flash` becomes unavailable on GMI mid-demo | Low | Switch model string to `gemini-3-pro` (also built-in) — same node, no other changes. |
| Live LLM call >5s | Low | 5s timeout + fallback templates. |
| Live chat in demo gets bad answer in Q&A | High | Demo uses one rehearsed question. Don't take ad-hoc Q&A during the 3-min demo. |
| Venue wifi unreliable | Med | Phone hotspot ready. Backup video recorded by 4:55. |
| Local network intercepts `api.gmi-serving.com` before TLS | Med on venue wifi | Retry from hotspot. Symptom: `curl: (35) ... wrong version number`. |

---

## Naming convention

- Match-time minute as **float** (e.g. `80.5` for 80'30"). Tools/payloads
  accept floats; UI rounds at render time.
- Prices as integer cents in code (`41`); `c` suffix only at UI layer.
- Event types passed through from ESPN (`kickoff | goal | yellow-card |
  substitution | halftime | start-2nd-half | end-regular-time`). Don't
  re-map.
- Broadcast message urgencies: `info | movement | major`.
- Env var names:
  - `GMI_API_KEY` — application code (curl, Python clients).
  - `ROCKETRIDE_GMI_API_KEY` — `.pipe` interpolation. Same value.
  - `EDGECAST_*` — agent_io_server config.

---

## Open questions still to lock

- **Does `agent_deepagent` correctly invoke `tool_http_request`?** Verify
  on the first IDE smoke test. If it doesn't, the lookup tools are
  unavailable to the agent — fall back to inlining a richer tick payload.
- **Tick prompt placement.** Currently shipped in `build_tick_payload`'s
  `hint` field. Move to `agent_deepagent_1.config.instructions` once the
  wording stabilizes — instructions are stable, tick `hint` is ephemeral.
- **Whether `${ROCKETRIDE_GMI_API_KEY}` interpolates** — needs smoke test.
  Fallback: hard-paste during demo, refactor before commit.
