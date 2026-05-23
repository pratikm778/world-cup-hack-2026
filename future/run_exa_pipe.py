import argparse
import asyncio
import json
import os
from pathlib import Path

from rocketride_exa import DEFAULT_PIPE, run_exa_search


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a RocketRide Exa pipeline against a local server.")
    parser.add_argument(
        "--uri",
        default=os.environ.get("ROCKETRIDE_URI", "ws://localhost:5565"),
        help="RocketRide server URI. Default: ws://localhost:5565 or ROCKETRIDE_URI.",
    )
    parser.add_argument(
        "--apikey",
        default=os.environ.get("ROCKETRIDE_APIKEY", "MYAPIKEY"),
        help="RocketRide API key. Default: ROCKETRIDE_APIKEY or MYAPIKEY for local dev.",
    )
    parser.add_argument(
        "--pipe",
        default=str(DEFAULT_PIPE),
        help=f"Path to the .pipe file to run. Default: {DEFAULT_PIPE}",
    )
    parser.add_argument(
        "--query",
        required=True,
        help="Single query to send into the chat source node.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    response = await run_exa_search(
        args.query,
        uri=args.uri,
        apikey=args.apikey,
        pipe=Path(args.pipe),
    )
    if isinstance(response, (dict, list)):
        print(json.dumps(response, indent=2))
    else:
        print(response)


if __name__ == "__main__":
    asyncio.run(main())
