"""Direct smoke: real tick payload + test.pipe instructions → Gemini 3.5 Flash
on GMI Cloud. Bypasses RocketRide so we can verify the product question
(does the agent give a sensible polymarket verdict?) without needing the
pipeline server running.

Usage:
    python3 scripts/smoke_agent_verdict.py            # minute 45.5 (halftime)
    python3 scripts/smoke_agent_verdict.py 75         # minute 75
    python3 scripts/smoke_agent_verdict.py 30         # quiet baseline
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))


def load_env() -> None:
    env_path = REPO / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def load_instructions() -> list[str]:
    """Pull the agent's instructions out of test.pipe (tolerating trailing
    commas in the components array)."""
    raw = (REPO / "test.pipe").read_text()
    cleaned = re.sub(r",(\s*[\]}])", r"\1", raw)
    pipe = json.loads(cleaned)
    agent = next(c for c in pipe["components"] if c["id"] == "agent_deepagent_1")
    return agent["config"]["default"]["instructions"]


def main() -> None:
    load_env()
    api_key = os.environ.get("GMI_API_KEY") or os.environ.get("ROCKETRIDE_GMI_API_KEY")
    if not api_key:
        print("ERROR: set GMI_API_KEY (or ROCKETRIDE_GMI_API_KEY) in .env")
        sys.exit(2)

    minute = float(sys.argv[1]) if len(sys.argv) > 1 else 45.5

    import scripts.agent_io_server as srv
    srv._replay["fixed_minute"] = minute
    srv._reset_memory()
    payload = srv.build_tick_payload(datetime.now(timezone.utc), None)

    instructions = load_instructions()
    system_prompt = "\n\n".join(instructions)
    user_msg = json.dumps(payload, indent=2)

    print("=" * 70)
    print(f"TICK @ match-minute {payload['match_minute']}  "
          f"(window {payload['since_minute']}–{payload['match_minute']}, "
          f"lookback {payload['lookback_min']}min)")
    print("=" * 70)
    print(f"new_key_events:   {len(payload['new_key_events'])}")
    for e in payload["new_key_events"]:
        print(f"  [{e['id']}] {e['minute']}' {e['type']} — {(e['text'] or '')[:80]}")
    print(f"top_movers:       {len(payload['polymarket_top_movers'])}")
    for m in payload["polymarket_top_movers"][:3]:
        print(f"  {m['delta_c']:+4d}c  {m['open_c']:3d}→{m['close_c']:3d}  "
              f"{m['question'][:70]}")
    print(f"previously_seen:  {payload['previously_seen_key_event_ids']}")
    print(f"prior_broadcasts: {len(payload['prior_broadcasts'])} entries")
    print()
    print("Calling google/gemini-3.5-flash via api.gmi-serving.com ...")

    body = {
        "model": "google/gemini-3.5-flash",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }

    if "--dry" in sys.argv:
        print(f"system_prompt:    {len(system_prompt)} chars, "
              f"{len(instructions)} instruction blocks")
        print(f"user_payload:     {len(user_msg)} chars")
        print("DRY mode — skipping LLM call.")
        return

    req = urllib.request.Request(
        "https://api.gmi-serving.com/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    import ssl, urllib.error
    t0 = datetime.now(timezone.utc)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = json.loads(resp.read())
    except (ssl.SSLError, urllib.error.URLError) as e:
        print("-" * 70)
        print(f"NETWORK ERROR reaching api.gmi-serving.com: {e}")
        print("This is the SPEC §Risks venue-wifi TLS-interception symptom.")
        print("Mitigation: switch to phone hotspot and re-run this script.")
        print("Payload above is real and ready — only the egress is blocked.")
        sys.exit(1)
    dt = (datetime.now(timezone.utc) - t0).total_seconds()

    answer = resp_body["choices"][0]["message"]["content"]
    usage = resp_body.get("usage", {})

    print("-" * 70)
    print(f"VERDICT (latency {dt:.2f}s, tokens {usage.get('total_tokens')}):")
    print("-" * 70)
    if not answer.strip():
        print("(empty — agent decided to stay silent)")
    else:
        print(answer)
    print("-" * 70)


if __name__ == "__main__":
    main()
