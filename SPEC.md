# EdgeCast — Hackathon Spec (v3 — single-LLM via GMI, vector search, 3-person team)

> A market-aware co-watcher for live sports prediction markets.
> Built for the **Google I/O Kickoff: Pre-World Cup Hack** — May 23, 2026.

---

## Status

- **Now:** ~2:15 PM PDT
- **Submission:** 5:00 PM PDT
- **Demo:** 5:10 PM (3 min + 2 min Q&A)
- **Build budget:** ~2h 45m wall-clock × 3 people = **~8 person-hours**
- **Repo:** [pratikm778/world-cup-hack-2026](https://github.com/pratikm778/world-cup-hack-2026)
- **API key:** `GMI_API_KEY` in `.env`; direct smoke target is `google/gemini-3.5-flash` on `api.gmi-serving.com`. `.env` is gitignored and untracked.

### Team (collaborators on repo, push access)

| Member | GitHub | Track |
| --- | --- | --- |
| Pratik | `pratikm778` (owner) | **C** — RocketRide pipeline, prompts, vector store, historical corpus |
| Sajay | `sajayv98` | **A** — Frontend, three-pane UI, SSE consumption |
| Kaushik Sivakumar | `KaushikSiva` | **B** — FastAPI backend, replay engine, /api/chat, seed data, fallbacks |

---

## One-sentence pitch

> "Sports prediction markets move faster than human attention. EdgeCast watches every market, brings in the historical context a human would already know, and narrates what's moving — live, on GMI Cloud's GPUs, with Google's newest Gemini."

---

## Decisions (locked — do not relitigate)

| Decision | Value |
| --- | --- |
| **Data source** | Static JSON, scripted simulation. No scraping, no real Polymarket API. |
| **Demo mode** | Live LLM calls, scripted event triggers, 5s timeout + per-event fallback templates. |
| **Pre-event flags** | Cut. Agent reacts to events only — never predicts. |
| **Brand** | Generic "sports prediction markets." Polymarket name appears nowhere. |
| **LLM (single)** | `llm_gmi_cloud` with **Custom profile** → `google/gemini-3.5-flash` via `https://api.gmi-serving.com/v1`. **Ticks GMI Cloud + Google requirements in one call.** |
| **Historical context** | 30-40 hand-authored fact snippets (players, teams, matchup history) indexed in `vectordb_postgres` via `embedding_transformer` (local, no API key). |
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
│         ▲                                  ▲           │
│         │ SSE: broadcast msgs              │ /state    │
│         │ POST: chat questions             │ (1s poll) │
└─────────┼──────────────────────────────────┼───────────┘
          ▼                                  ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI (api/app/main.py)                              │
│   • /api/state          → current minute, prices        │
│   • /api/events (SSE)   → broadcast messages            │
│   • /api/chat (POST)    → single-turn Q&A               │
│   • Replay clock: 6s real-time = 1 match-minute         │
└──────────┬──────────────────────────────────┬───────────┘
           │ on event                         │ on user msg
           ▼                                  ▼
┌─────────────────────────────────────────────────────────┐
│  RocketRide pipeline (api/app/pipelines/edgecast.pipe)  │
│                                                         │
│   chat_source ─► agent_rocketride                       │
│                    │                                    │
│                    ├─► llm_gmi_cloud                    │
│                    │    profile: custom                 │
│                    │    model:   google/gemini-3.5-flash│
│                    │                                    │
│                    ├─► memory_internal                  │
│                    │                                    │
│                    ├─► tool_python (market_state_lookup)│
│                    │                                    │
│                    └─► vectordb_postgres                │
│                         ▲                               │
│                         │ embedded queries              │
│                         └─ embedding_transformer (local)│
└─────────────────────────────────────────────────────────┘
```

---

## Repository layout

```text
world-cup-hack-2026/
├── api/                          # FastAPI + RocketRide (Tracks B + C)
│   ├── app/
│   │   ├── main.py               # FastAPI app, SSE, /api/chat
│   │   ├── replay.py             # Clock ticker, event scheduler
│   │   ├── pipelines/
│   │   │   └── edgecast.pipe     # Single-agent RocketRide pipeline
│   │   ├── prompts/
│   │   │   ├── movement_alert.txt
│   │   │   ├── state_summary.txt
│   │   │   └── chat_qa.txt
│   │   ├── fallbacks.py          # Deterministic templates
│   │   └── corpus_loader.py      # One-time ingest of facts.jsonl into pgvector
│   ├── data/
│   │   └── facts.jsonl           # Historical fact snippets, one JSON per line
│   └── pyproject.toml
├── ui/                           # Vite + React (Track A)
│   ├── src/
│   │   ├── App.tsx               # 3-pane layout
│   │   ├── ChatPane.tsx
│   │   ├── ClockPane.tsx
│   │   └── MarketsPane.tsx
│   └── package.json
├── demo-data/                    # Static seed data (Track B)
│   ├── match.json                # Timeline, events
│   ├── markets.json              # 8-12 markets + opening prices
│   ├── price-curves.json         # Per-minute price points
│   └── commentary.json           # Minute-by-minute text
├── .env                          # NOT committed (gitignored)
├── .env.example                  # Committed, no real values
└── README.md
```

### `.env.example` (committed)

```bash
# GMI Cloud API - smoke target: google/gemini-3.5-flash at https://api.gmi-serving.com/v1
GMI_API_KEY=

# Postgres for vector store (pgvector extension required)
PGVECTOR_HOST=localhost
PGVECTOR_PORT=5432
PGVECTOR_USER=postgres
PGVECTOR_PASSWORD=
PGVECTOR_DB=edgecast
```

---

## Demo scenario (locked timeline — 10 match-minutes = 60s real)

| Match minute | Real time | Event | Agent does |
| --- | --- | --- | --- |
| 75' | t=0s | Calm baseline | Quiet sidebar, last state_summary visible |
| 77' | t=12s | France corner #3 in 4 min | `movement_alert`: corners O9.5 ticks up; vector adds: "France averages 7 corners per knockout match" |
| 78' | t=18s | state_summary tick | Quick summary |
| 80' | t=30s | **GOAL — France (Mbappé equalizer)** | Big `movement_alert`: 3 markets cited; vector adds: "Mbappé has scored in 4 of his last 5 knockout-round appearances" |
| 82' | t=42s | French shot saved | Small `movement_alert`: shots O14.5 +5c |
| 85' | t=60s | Yellow card — Argentina | `movement_alert`: cards O4.5, France winner; vector adds: "Otamendi averages 1 card every 2 high-stakes matches" |
| 87' | t=72s | (presenter types question) | `chat_qa`: live answer using vector + state context |
| 90' | t=90s | Wrap | Final `state_summary` if time |

**Markets in play (12, in `markets.json`):** Match winner (Arg/Fra/Draw), Both teams to score, Total goals O2.5/O3.5, Goes to extra time, Next goal scorer (5 names), Corners O9.5, Yellow cards O4.5, Mbappé to score, Messi to score, Exact score 2-1.

---

## Historical fact corpus

### Shape — `api/data/facts.jsonl`

One JSON object per line:

```json
{"id": "mbappe_knockout_record", "category": "player", "subject": "Mbappé",
 "text": "Mbappé has scored in 4 of his last 5 World Cup knockout-round appearances, with 3 of those goals coming after the 70th minute."}
```

### Authoring guidelines (~30-40 snippets total)

| Bucket | Count | Examples |
| --- | --- | --- |
| Player profiles (Mbappé, Messi, Griezmann, Otamendi, Di María) | 10 | "Mbappé has scored 3 of his career goals from counter-attacks after the 80th minute." |
| Team tactical tendencies (France, Argentina) | 8 | "France has equalized in 3 of their last 6 knockout matches when trailing by 1 in the final 15 min." |
| Matchup history (head-to-head, prior finals) | 6 | "France and Argentina have met 12 times; Argentina leads 6-3-3." |
| Statistical priors (corner/card rates, goal timing) | 6 | "In World Cup knockout matches, the average yellow-card count is 4.2." |
| Referee / context | 4 | "Referees averaging 5+ cards/match book defenders earlier than midfielders." |

### Ingest path

1. Author `facts.jsonl` (Track C, 45 min)
2. `corpus_loader.py` reads jsonl, runs each through `embedding_transformer`, inserts into Postgres table `fact_vectors`
3. Runs once at server startup; idempotent (`ON CONFLICT (id) DO NOTHING`)

### How the agent uses it

On each event, the broadcast loop builds a query like `"goal by Mbappé in 80th minute"` → vector lookup top 2 facts → injects into the LLM prompt as `<historical_context>...</historical_context>`. Chat path does the same with top 3 on the user's question text.

---

## The RocketRide pipeline — `edgecast.pipe`

> **Custom profile schema** verified against `rocketride-server/nodes/src/nodes/llm_gmi_cloud/services.json`. The Custom profile requires `model`, `modelTotalTokens`, `serverbase`, `apikey`.

```json
{
  "components": [
    {
      "id": "chat_1",
      "provider": "chat",
      "config": { "mode": "Source", "type": "chat" }
    },
    {
      "id": "agent_1",
      "provider": "agent_rocketride",
      "config": {
        "instructions": [
          "You are EdgeCast, a live prediction-market analyst. ",
          "When given an event, produce ONE trader-terse broadcast alert. ",
          "When given a user question, answer in 3-5 sentences using current state and recent events. ",
          "Use the <historical_context> block when it adds insight. ",
          "Never recommend bets. Never predict outcomes. Cap responses at 200 tokens."
        ],
        "max_waves": 4
      },
      "input": [{ "lane": "questions", "from": "chat_1" }]
    },
    {
      "id": "llm_1",
      "provider": "llm_gmi_cloud",
      "config": {
        "profile": "custom",
        "custom": {
          "model": "google/gemini-3.5-flash",
          "modelTotalTokens": 128000,
          "serverbase": "https://api.gmi-serving.com/v1",
          "apikey": "${GMI_API_KEY}"
        }
      },
      "control": [{ "classType": "llm", "from": "agent_1" }]
    },
    {
      "id": "mem_1",
      "provider": "memory_internal",
      "config": { "type": "memory_internal" },
      "control": [{ "classType": "memory", "from": "agent_1" }]
    },
    {
      "id": "tool_market_1",
      "provider": "tool_python",
      "config": { "type": "tool_python" },
      "control": [{ "classType": "tool", "from": "agent_1" }]
    },
    {
      "id": "embed_local",
      "provider": "embedding_transformer",
      "config": { "profile": "all-minilm-l6-v2" }
    },
    {
      "id": "vector_store",
      "provider": "vectordb_postgres",
      "config": {
        "host":     "${PGVECTOR_HOST}",
        "port":     5432,
        "user":     "${PGVECTOR_USER}",
        "password": "${PGVECTOR_PASSWORD}",
        "database": "${PGVECTOR_DB}",
        "table":    "fact_vectors",
        "similarity_metric": "cosine",
        "retrieval_score":    0.5
      },
      "control": [{ "classType": "tool", "from": "agent_1" }],
      "input":   [{ "lane": "questions", "from": "embed_local" }]
    }
  ]
}
```

**Why Custom profile, not a built-in one:** `gemini-3.5-flash` is not in GMI Cloud's profile dropdown (the built-ins are `gemini-3-pro` and `gemini-3-flash`). Custom takes any model the GMI endpoint serves; the direct smoke command below is the verifier before `/api/chat` wiring.

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
- Current minute, all 12 markets with price + 5-min delta
- Last 5 events, last 5 broadcast messages
- historical_context: top 3 relevant facts from the vector store

RULES:
- One-shot. No clarifying questions.
- 3-5 sentences max. Cite specific prices when relevant.
- Cite ≤1 historical fact when it adds insight; don't force it.
- Refusals (exact wording):
  · "place a bet" / "should I buy" / "should I cash out" → "EdgeCast watches markets — it doesn't place orders."
  · "what will happen" / "predict" → "I can show you what's moving, not what will happen."
- Trader-terse. 200 tokens max.
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

## Demo data — `demo-data/*.json` (Track B)

### `match.json`

```json
{
  "id": "demo-match-1",
  "title": "France vs Argentina (Demo)",
  "start_minute": 75,
  "end_minute": 90,
  "tick_seconds_per_minute": 6,
  "events": [
    {"minute": 77, "type": "corner", "team": "France", "description": "France's third corner in four minutes"},
    {"minute": 80, "type": "goal", "team": "France", "player": "Mbappé", "description": "Equalizer, 2-2"},
    {"minute": 82, "type": "shot_saved", "team": "France", "player": "Griezmann"},
    {"minute": 85, "type": "yellow_card", "team": "Argentina", "player": "Otamendi"}
  ],
  "state_summary_minutes": [78, 90]
}
```

### `markets.json` (12 entries)

Each: `{id, name, category}`. Categories: `outcome | goals | events | player | score`.

### `price-curves.json`

Per market, list of `{minute, price_cents}` points. Hand-author so the jumps line up with event minutes:

- `match_winner_fra`: 28c → 41c (jumps at 80')
- `extra_time`: 19c → 34c (jumps at 80')
- `goals_o35`: 22c → 35c (jumps at 80')
- `corners_o95`: 18c → 27c (climbs 76'–78')
- `cards_o45`: 31c → 38c (jumps at 85')
- Most others stay flat — that's intentional, the sidebar's value is showing the few that move.

### `commentary.json`

```json
{
  "75": "France in possession in their own half.",
  "76": "Argentina pressing high, intercepts on halfway.",
  "77": "Corner for France — third in four minutes. Pressure mounting.",
  "...": "..."
}
```

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

## Track C — RocketRide pipeline, vector store, corpus, prompts (pratikm778)

| # | Item | File(s) | Done when | Est |
| --- | --- | --- | --- | --- |
| C1 | Install RocketRide VS Code extension; deploy "Local" server | (IDE) | Extension running, can open a `.pipe` file | 15m |
| C2 | Stand up Postgres + pgvector locally; create `edgecast` DB + `vector` extension | (local) | `psql -c "CREATE EXTENSION vector;"` returns OK; creds in `.env` | 25m |
| C3 | Author `edgecast.pipe` per JSON above; verify it loads in canvas | `edgecast.pipe` | All 7 nodes render, no validation errors | 25m |
| C4 | Smoke test via IDE chat using GMI key from `.env` | (IDE chat) | Test message returns Gemini 3.5 Flash response within 5s | 15m |
| C5 | Author `data/facts.jsonl` (30-40 snippets per buckets above) | `facts.jsonl` | File has 30+ lines, each ≤3 sentences, JSONL valid | 45m |
| C6 | `corpus_loader.py` — runs facts through `embedding_transformer`, inserts into pgvector | `corpus_loader.py` | One run populates `fact_vectors`; idempotent | 30m |
| C7 | Vector tool wiring: agent → vectordb_postgres returns top-K on query | (IDE) | Sending "Mbappé scored" via the agent surfaces the Mbappé fact in context | 20m |
| C8 | Write & tune all 3 system prompts against 3 test inputs each | `prompts/*.txt` | Each prompt produces in-spec output on 3 hand-crafted test inputs | 40m |
| C9 | Refusal-rail verification — both "bet" and "predict" triggers fire | (IDE chat) | Both refusal messages reproduce verbatim from `chat_qa.txt` | 10m |

**Track C total: ~3h 45m.** Heavier than A and B. **Squeeze candidates: C5 → cut to 20 snippets if running long; C8 → tune 2 prompts deeply, accept fallback for state_summary.**

---

## Schedule (3 people parallel)

| Time | Track A (Sajay) | Track B (Kaushik) | Track C (Pratik) | Joint |
| --- | --- | --- | --- | --- |
| 2:15–2:45 | A1 scaffold UI | B1 scaffold API + B2 seed data starts | C1 RR install + C2 Postgres+pgvector | — |
| 2:45–3:15 | A2 grid + A3 starts | B2 seed data finishes | C3 author .pipe + C4 smoke test | — |
| 3:15–3:45 | A3 clock+commentary | B3 replay clock | C5 corpus authoring | — |
| 3:45–4:15 | A4 markets sidebar | B4 SSE stream | C6 corpus loader + C7 vector wiring | — |
| 4:15–4:35 | A5 chat pane SSE+POST | B5 /api/chat | C8 prompts | — |
| 4:35–4:50 | A6 polish | B6 fallbacks | C8 + C9 refusal | **End-to-end smoke** |
| 4:50–5:00 | — | — | — | **1 dress rehearsal + final commit + push** |

Wall-clock: **2h 45m**. Per-track loads (A=3h10m, B=2h45m, C=3h45m) — C is the bottleneck; explicit squeeze items handle that.

---

## Demo script (90 seconds — practice between 4:50 and 5:00)

**0:00–0:10 — Frame**
"Sports prediction markets move faster than human attention. During a soccer match there can be 200+ live markets. We watch them all, and we add the historical context a sharp human would already know."

**0:10–0:30 — Calm**
"Minute 75. Argentina up 2-1. The agent is quiet. Last status: nothing moving. That's correct."

**0:30–1:10 — The spike**
"Press play." [Events fire at 77', 80', 82', 85'.] "Mbappé equalizes at 80'. Watch: three markets light up. France wins 28→41 cents. Goes to extra time 19→34. Total goals over 3.5: 22→35. **And the agent adds: 'Mbappé has scored in 4 of his last 5 knockout-round appearances.'** That's the vector store pulling historical context the LLM wouldn't have on its own." [Show RocketRide canvas in VS Code for 2 seconds.] "One pipeline. RocketRide orchestrating, GMI Cloud serving, Google's Gemini 3.5 Flash thinking. All three sponsors, one API call per event."

**1:10–1:30 — Live chat**
[Type:] "Why is the corners market moving?" [Agent answers using current state + vector-fetched France-corner stat.] "Live Gemini, on GMI's GPUs, with historical context, in under three seconds."

**1:30 — Close**
"Today, one match, twelve markets, thirty facts. Point the pipeline at any match, any sport, any prediction market. That's the product."

---

## Out of scope (refer back when tempted)

- Position tracking / "My Positions" sidebar
- "I bet on X" buttons / order entry / cash-out suggestions
- Pre-event flags / "agent saw it coming" pre-predictions
- Fine-tuned classifier on GMI
- Embeddings via external API (we use local `embedding_transformer`)
- A second LLM node (single-LLM via GMI does it all)
- Real Polymarket data / scraping
- Real match commentary scraping
- Multi-match support
- User accounts / auth / persistence beyond match-time state
- "Why?" trace panel (show the RocketRide canvas live instead)
- Mobile responsive / dark mode polish
- Video clip in center pane

---

## Risks + mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Postgres+pgvector install drags past 2:50 PM | Med | Fallback to in-memory cosine sim in `tool_python`. Decide at 2:50 if not green. |
| `google/gemini-3.5-flash` becomes unavailable on GMI mid-demo | Low | Switch model string to `google/gemini-3-flash-preview` (built-in profile) — same node, no other changes. |
| Custom-profile `serverbase`/`apikey` keys don't interpolate `${GMI_API_KEY}` correctly | Med | If `${...}` interpolation isn't supported in the .pipe file, hard-code the env var read in a tiny Python wrapper for the agent's tool path. |
| Live LLM call >5s | Low | 5s timeout + fallback templates. Per-event fallbacks pre-written. |
| Live chat in demo gets bad answer in Q&A | High | Demo uses one rehearsed question. Don't take ad-hoc Q&A during the 3-min demo — save those for the 2-min Q&A. |
| Venue wifi unreliable | Med | Phone hotspot ready. Backup video recorded by 4:55. |
| Local network intercepts `api.gmi-serving.com` before TLS | Med on venue wifi | Retry from hotspot or another network. Symptom: `curl: (35) ... wrong version number` on HTTPS, or SafeBrowse redirect on HTTP. |

---

## Naming convention

- Match-time minute as integer (e.g. `80`), never strings or `"80'"`
- Prices as integer cents in code (`41`); `c` suffix only at UI layer
- Event types from a fixed enum: `goal | shot_saved | shot_off | yellow_card | red_card | corner | substitution | injury`
- Broadcast message urgencies: `info | movement | major`
- Fact category enum: `player | team | matchup | stat | referee`
- Env var name: **`GMI_API_KEY`** (matches `.env`; do not rename to `GMI_CLOUD_APIKEY`)

---

## Open questions still to lock before code

- **Postgres credentials**: Pratik chooses local user/pw, writes to `.env`, copies the variable-name shape into `.env.example` (no real values).
- **Whether `${GMI_API_KEY}` interpolates in .pipe JSON** — verify on first IDE smoke test (C4). If not, hard-paste the key during build (kept off git via `.env`), then refactor before commit.
