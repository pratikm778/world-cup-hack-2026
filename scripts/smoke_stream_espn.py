"""Smoke test for EspnProvider.stream_live().

Against a completed game (gameId 740916, Man City vs Arsenal 2026-04-19):
  - First poll yields all 96 entries.
  - Second poll yields nothing new.
  - Loop terminates because match.completed = true and no new entries arrived.

Run:  python scripts/smoke_stream_espn.py [POLL_SECONDS]
Default poll interval is 3s for the smoke test (vs 30s production default).
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from providers import EspnProvider, FixtureRef  # noqa: E402


def main() -> None:
    poll = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    fixture = FixtureRef(
        home="Manchester City FC",
        away="Arsenal FC",
        kickoff_utc=datetime(2026, 4, 19, 15, 30, tzinfo=timezone.utc),
        espn_game_id="740916",
    )
    provider = EspnProvider()
    print(f"[smoke] streaming with {poll}s poll interval (completed game — should drain then stop)")

    started = time.monotonic()
    count = 0
    for entry in provider.stream_live(fixture, poll_interval_seconds=poll):
        count += 1
        when = f"{entry.minute}'+{entry.extra_time}" if entry.extra_time else f"{entry.minute}'"
        kind = entry.raw_event_type or "—"
        print(f"  [{count:3d}] {when:8s} [{kind:18s}] {entry.text[:90]}")

    elapsed = time.monotonic() - started
    print(f"[smoke] done — yielded {count} entries in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
