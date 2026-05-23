# EdgeCast — Runbook

How to run the demo, smoke-test the agent, and triage network issues on a
fresh machine. Companion to `SPEC.md`. If something here disagrees with
SPEC, fix SPEC.

---

## 0. Prerequisites

- Python **3.12** (3.11 likely works, untested)
- `pip install -r requirements.txt` (FastAPI, uvicorn, httpx, python-dotenv)
- A `.env` at repo root with:
  ```bash
  GMI_API_KEY=<the_key>
  ROCKETRIDE_GMI_API_KEY=<same_key>           # for ${} interpolation in test.pipe
  EDGECAST_MATCH_ID=ars-man-2026-04-19
  EDGECAST_TICK_SECONDS=60
  EDGECAST_LOOKBACK_MIN=5
  EDGECAST_TOP_MOVERS=5
  EDGECAST_TICK_ENABLED=1
  EDGECAST_WEBHOOK_URL=http://localhost:8080/api/pipelines/test.pipe/webhook
  ```
- RocketRide VS Code extension installed + "Local" server deployed on `:8080`
  with `test.pipe` open (only needed for §3 full pipeline). Skip if you only
  want the §2 direct smoke.

---

## 1. Sanity check the network FIRST (30 seconds)

The single most common failure mode is the network silently blocking
`api.gmi-serving.com`. Run this before anything else:

```bash
curl -sS --max-time 8 https://api.gmi-serving.com/ -o /dev/null \
  -w "HTTP %{http_code}  time=%{time_total}s\n"
```

| Output | Meaning | Action |
| --- | --- | --- |
| `HTTP 404` / `HTTP 200` | Network is fine | Proceed to §2 |
| `curl: (35) ... wrong version number` | A web filter is intercepting TLS | Run §1.a below |
| `curl: (7) Failed to connect` | Total block at L3/L4 | VPN or alternate network |

### 1.a — Confirm the filter

```bash
timeout 5 bash -c 'exec 3<>/dev/tcp/api.gmi-serving.com/443
  && printf "GET / HTTP/1.0\r\nHost: api.gmi-serving.com\r\n\r\n" >&3
  && head -c 200 <&3'
```

If you see `Location: https://www.safebrowse.io/warn.html?...` (or similar
warning-page redirect), a content filter has flagged GMI Cloud. **The fix
is L3, not curl flags.** In rough order of fastest:

1. **Different DNS** — fastest if filter is DNS-level:
   ```bash
   sudo sh -c 'echo "nameserver 1.1.1.1" > /etc/resolv.conf'
   curl -sS --max-time 8 https://api.gmi-serving.com/ -o /dev/null -w "%{http_code}\n"
   ```
2. **Mobile hotspot on a different carrier** — filter is often per-SIM /
   per-ISP. Phone-A hotspot may be blocked, phone-B may not.
3. **Cloudflare WARP** (free, ~60s install): bypasses DNS + ISP filtering.
   ```bash
   curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
     | sudo gpg --yes --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg
   echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" \
     | sudo tee /etc/apt/sources.list.d/cloudflare-client.list
   sudo apt update && sudo apt install -y cloudflare-warp
   warp-cli registration new && warp-cli connect
   ```
4. **SSH tunnel through any cloud VPS you control** — last resort.

The `wrong version number` SSL error is misleading: it just means the
filter answered with HTTP, not TLS. There is no curl/openssl/Python
workaround that fixes this client-side. Route around it at L3.

---

## 2. Direct verdict smoke (no RocketRide needed) — **the fast demo**

This bypasses the pipeline entirely and proves the product question:
*does the agent produce a sensible polymarket verdict for a given match
minute?* Useful when RocketRide isn't running, or when triaging whether
a bug is in the agent vs the pipeline.

```bash
# Halftime cascade (the headline demo moment)
python3 scripts/smoke_agent_verdict.py 45.5

# Late-game corners + Arsenal subs
python3 scripts/smoke_agent_verdict.py 75

# Quiet baseline — use 32 not 30 (see "demo gotcha" below)
python3 scripts/smoke_agent_verdict.py 32

# Inspect the payload without making the LLM call
python3 scripts/smoke_agent_verdict.py 45.5 --dry
```

What it does, end to end:
1. Pins the replay clock at the minute you pass.
2. Calls `build_tick_payload()` — same code path the live tick loop uses.
3. Reads the agent instructions out of `test.pipe`
   (`agent_deepagent_1.config.default.instructions`).
4. POSTs to `google/gemini-3.5-flash` via `https://api.gmi-serving.com/v1/chat/completions`.
5. Prints latency + token usage + the verdict.

**Expected verdict shape** (halftime, minute 45.5):
```
45' — Exact Score 2-1 (City): 11→50c. Exact 1-1 48→10c, Arsenal HT 43→9c also moving.
The market is pricing in a second City goal before half ended; the
halftime print shifted ~40c of mass off the "stalemate" and "Arsenal lead"
outcomes.
```

If the script prints `NETWORK ERROR reaching api.gmi-serving.com` →
loop back to §1.

---

## 3. Full pipeline via RocketRide (the demo configuration)

Only needed if you want to verify the webhook → agent_deepagent →
response_answers path end-to-end (e.g., for a UI demo where SSE pulls
broadcasts from `response_answers_1`).

### 3.a — Start the agent IO server

```bash
EDGECAST_WEBHOOK_URL=http://localhost:8080/api/pipelines/test.pipe/webhook \
  python3 -m uvicorn scripts.agent_io_server:app --host 0.0.0.0 --port 8765
```

Tick loop starts immediately and POSTs every 60s. Inspect:
```bash
curl http://localhost:8765/health           # {ok, now_minute, mode, speed, ...}
curl http://localhost:8765/markets          # market_id ↔ question index
curl http://localhost:8765/agent/memory     # broadcast_history + seen_event_count
```

### 3.b — Drive the demo clock

The wall clock is meaningless (the match happened 2026-04-19). Drive the
replay clock explicitly:

```bash
# Freeze at a specific match minute (also clears cross-tick memory):
curl -X POST 'http://localhost:8765/replay/seek?minute=45.5'

# Or start the clock running from a minute (advances at EDGECAST_REPLAY_SPEED,
# default 10x):
curl -X POST 'http://localhost:8765/replay/start?from_minute=30'
```

Two modes:

| Mode | When to use | Side effects |
| --- | --- | --- |
| `seek` | Teleport to interesting minutes; talk over a still moment | Memory reset, clock frozen |
| `start` | Show the clock visibly ticking up in the UI | Memory reset, clock advances at speed |

### 3.c — 90-second demo script

| Real time | Match minute | Command |
| --- | --- | --- |
| 0:00 | — | Frame the problem (no command) |
| 0:10 | 30 | `curl -X POST 'http://localhost:8765/replay/start?from_minute=30'` |
| 0:25 | 45.5 | `curl -X POST 'http://localhost:8765/replay/seek?minute=45.5'` |
| 1:05 | 75 | `curl -X POST 'http://localhost:8765/replay/seek?minute=75'` |
| 1:25 | — | Close (no command) |

Each `seek`/`start` resets cross-tick memory, so the agent sees the
halftime / late-game events as fresh on every demo run.

---

## 4. What "works" looks like, by layer

| Layer | Verify with | Pass criteria |
| --- | --- | --- |
| Data files | `ls data/matches/ars-man-2026-04-19/` | meta, key_events (19), commentary (96), markets (37), prices/ (74 files) |
| Lookup tools | `curl 'localhost:8765/events_window?start_min=44&end_min=46'` | Returns halftime event with id `47500603` |
| Tick payload | `python3 scripts/smoke_agent_verdict.py 45.5 --dry` | Top mover Exact-Score 2-1 City at +39c |
| Cross-tick memory | Run two `--dry` calls at 45.5; second shows `previously_seen` populated | Yes |
| LLM verdict | `python3 scripts/smoke_agent_verdict.py 45.5` | Latency <5s, broadcast cites Exact-Score 2-1 |
| Full pipeline | Start RocketRide :8080 + agent_io_server :8765; watch logs | "broadcast captured" line appears in uvicorn log within 60s |

---

## 5. Demo gotchas

- **Minute 30 is noisy, not quiet.** Exact-Score markets like "1-3 Arsenal"
  decay from ~50c toward zero as remaining time can't fit that many goals.
  The 5-min lookback catches that pure time-decay. **Use minute 32 or 35
  for the "quiet baseline" demo line** — the decay has flattened by then.
- **`/replay/seek` and `/replay/start` BOTH reset cross-tick memory.**
  This is intentional (a fresh demo run shouldn't see stale dedup state),
  but it means if you seek mid-demo you lose `prior_broadcasts`. Plan the
  demo arc to seek-then-narrate, not narrate-then-seek-back.
- **The `last_tick` parameter in `build_tick_payload` is dead code**
  in FIXED mode but used in RUNNING mode (dynamic lookback). Don't remove
  it — at speed=10 with 60s ticks, RUNNING mode needs the wider lookback
  or events get dropped between ticks.
- **`api.gmi-serving.com` resolves to Cloudflare** (104.18.12.99). If your
  network has SafeBrowse / NextDNS / a corporate proxy, GMI Cloud is the
  most likely vendor to be flagged. OpenAI / Google work fine on the same
  network typically. See §1 if so.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `curl: (35) ... wrong version number` on `api.gmi-serving.com` | Network web filter intercepting TLS | §1.a, switch networks/DNS/VPN |
| `webhook 404` in agent_io_server log | RocketRide server not running or pipe not deployed | Open `test.pipe` in IDE, deploy local |
| `webhook 500` with `apikey ... not set` | `${ROCKETRIDE_GMI_API_KEY}` didn't interpolate | Set the var in `.env` with that exact name; restart RocketRide |
| Agent always returns empty broadcast | Threshold too high, or wall-clock leaked | Check `/health.mode` — should be `fixed` or `running`, not `wall_clock`. Lower threshold in `test.pipe` instructions |
| Agent broadcasts on every tick | Dedup not enforced; check it references `previously_seen_key_event_ids` + `prior_broadcasts` | Verify those fields appear in the agent's `instructions` rule block |
| `model "google/gemini-3.5-flash" not found` | Typo or model decommissioned | Try `google/gemini-3-flash-preview` (built-in `gemini-3-flash` profile) as fallback |
| `now_minute` stuck at wall-clock value (~49000+) | `/replay/start` or `/replay/seek` not called | Call one of them before testing |

---

## 7. Quick commands reference

```bash
# Direct verdict (any minute)
python3 scripts/smoke_agent_verdict.py 45.5

# Inspect the tick payload without LLM call
python3 scripts/smoke_agent_verdict.py 45.5 --dry

# Start the IO server (full pipeline mode)
python3 -m uvicorn scripts.agent_io_server:app --host 0.0.0.0 --port 8765

# Seek / start clock
curl -X POST 'http://localhost:8765/replay/seek?minute=45.5'
curl -X POST 'http://localhost:8765/replay/start?from_minute=30'

# Inspect state
curl http://localhost:8765/health
curl http://localhost:8765/agent/memory
curl 'http://localhost:8765/events_window?start_min=40&end_min=46'
curl 'http://localhost:8765/market/<market_id>/window?start_min=40&end_min=46&agg=range'

# Smoke the GMI endpoint directly (raw)
set -a; source .env; set +a
curl --request POST --url https://api.gmi-serving.com/v1/chat/completions \
  -H "Content-Type: application/json" -H "Authorization: Bearer ${GMI_API_KEY}" \
  --data '{"model":"google/gemini-3.5-flash","messages":[{"role":"user","content":"reply OK"}],"max_tokens":10}'
```
