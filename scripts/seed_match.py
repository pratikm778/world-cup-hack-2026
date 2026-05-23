"""Pull Polymarket markets + price history (and later commentary) for one match.

Hard-coded to Man City vs Arsenal, 2026-04-19 for the hackathon demo.
Outputs to data/matches/<short_id>/.

Usage:
    python scripts/seed_match.py
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make sibling package importable when run as `python scripts/seed_match.py`.
sys.path.insert(0, str(Path(__file__).parent))

from providers import EspnProvider, FixtureRef, PolymarketProvider, dump  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "matches"

# Polymarket sometimes rate-limits aggressive callers; tiny delay between
# per-token requests keeps us well under their threshold for a 6-token pull.
PER_TOKEN_DELAY_S = 0.25

# Two-window strategy: coarse fidelity from market open through pre-kickoff
# captures slow price drift; per-minute fidelity through the match captures
# every event-driven spike. Polymarket's `fidelity` param is in MINUTES and
# the endpoint caps responses near ~250-330 points, so pick fidelity to fit.
PRE_MATCH_FIDELITY_MIN = 10  # 10-min buckets over ~13 days → ~300 points
IN_MATCH_FIDELITY_MIN = 1    # 1-min buckets over ~4 hours → ~240 points
IN_MATCH_PRE_PAD_MIN = 30    # capture kickoff approach
IN_MATCH_POST_PAD_MIN = 60   # cover stoppage time + final-whistle settlement


def build_fixture() -> FixtureRef:
    return FixtureRef(
        home="Manchester City FC",
        away="Arsenal FC",
        kickoff_utc=datetime(2026, 4, 19, 15, 30, tzinfo=timezone.utc),
        competition="epl",
        polymarket_event_slug="epl-mac-ars-2026-04-19",
        espn_game_id="740916",
    )


def pull_polymarket(fixture: FixtureRef, out_dir: Path) -> None:
    provider = PolymarketProvider()
    print(f"[polymarket] fetching event {fixture.polymarket_event_slug!r}…")
    event, markets = provider.list_event_markets(fixture)

    print(f"[polymarket] event {event['id']} — {event['title']!r}")
    print(f"[polymarket] {len(markets)} markets, "
          f"{sum(len(m.token_ids) for m in markets)} tokens, "
          f"volume=${event.get('volume', 0):,.0f}")

    (out_dir / "event.json").write_text(json.dumps(event, indent=2))
    (out_dir / "markets.json").write_text(
        json.dumps([dump(m) for m in markets], indent=2)
    )

    kickoff = fixture.kickoff_utc
    pre_start = datetime.fromisoformat(event["createdAt"].replace("Z", "+00:00"))
    pre_end = kickoff - timedelta(minutes=IN_MATCH_PRE_PAD_MIN)
    in_start = pre_end
    in_end = kickoff + timedelta(minutes=90 + IN_MATCH_POST_PAD_MIN)

    print(f"[polymarket] pre-match window: {pre_start.isoformat()} → {pre_end.isoformat()} @ {PRE_MATCH_FIDELITY_MIN}min")
    print(f"[polymarket] in-match window:  {in_start.isoformat()} → {in_end.isoformat()} @ {IN_MATCH_FIDELITY_MIN}min")

    prices_dir = out_dir / "prices"
    prices_dir.mkdir(exist_ok=True)

    for market in markets:
        for outcome, token_id in zip(market.outcomes, market.token_ids):
            label = f"{market.metadata.get('group_item_title') or market.question[:32]} / {outcome}"
            try:
                pre = provider.get_price_history(
                    token_id,
                    start_ts=pre_start,
                    end_ts=pre_end,
                    fidelity_minutes=PRE_MATCH_FIDELITY_MIN,
                )
                time.sleep(PER_TOKEN_DELAY_S)
                live = provider.get_price_history(
                    token_id,
                    start_ts=in_start,
                    end_ts=in_end,
                    fidelity_minutes=IN_MATCH_FIDELITY_MIN,
                )
                time.sleep(PER_TOKEN_DELAY_S)
            except Exception as e:
                print(f"  ! {label}: {e}")
                continue

            merged = sorted(pre + live, key=lambda p: p.ts_utc)
            print(f"  · {label}: {len(pre)} pre + {len(live)} in-match = {len(merged)} points")

            payload = {
                "token_id": token_id,
                "market_id": market.market_id,
                "outcome": outcome,
                "question": market.question,
                "windows": {
                    "pre_match": {
                        "start": pre_start.isoformat(),
                        "end": pre_end.isoformat(),
                        "fidelity_minutes": PRE_MATCH_FIDELITY_MIN,
                        "point_count": len(pre),
                    },
                    "in_match": {
                        "start": in_start.isoformat(),
                        "end": in_end.isoformat(),
                        "fidelity_minutes": IN_MATCH_FIDELITY_MIN,
                        "point_count": len(live),
                    },
                },
                "points": [dump(p) for p in merged],
            }
            (prices_dir / f"{token_id}.json").write_text(json.dumps(payload, indent=2))


def pull_commentary(fixture: FixtureRef, out_dir: Path) -> None:
    provider = EspnProvider()
    print(f"[espn] fetching commentary for gameId {fixture.espn_game_id}…")
    commentary, key_events = provider.get_historical(fixture)
    print(f"[espn] {len(commentary)} commentary entries, {len(key_events)} keyEvents")

    type_counts: dict[str, int] = {}
    for entry in commentary:
        type_counts[entry.raw_event_type or "untyped"] = (
            type_counts.get(entry.raw_event_type or "untyped", 0) + 1
        )
    for t, n in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"  · {t}: {n}")

    (out_dir / "commentary.json").write_text(
        json.dumps([dump(c) for c in commentary], indent=2)
    )
    (out_dir / "key_events.json").write_text(json.dumps(key_events, indent=2))


def main() -> None:
    fixture = build_fixture()
    out_dir = DATA_DIR / fixture.short_id()
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[seed] writing to {out_dir}")

    meta = {
        "short_id": fixture.short_id(),
        "home": fixture.home,
        "away": fixture.away,
        "kickoff_utc": fixture.kickoff_utc.isoformat(),
        "competition": fixture.competition,
        "polymarket_event_slug": fixture.polymarket_event_slug,
        "espn_game_id": fixture.espn_game_id,
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    pull_polymarket(fixture, out_dir)
    pull_commentary(fixture, out_dir)
    print(f"[seed] done — {out_dir}")


if __name__ == "__main__":
    main()
