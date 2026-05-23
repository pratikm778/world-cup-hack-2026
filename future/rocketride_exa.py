import os
from pathlib import Path
from typing import Any

from rocketride import RocketRideClient
from rocketride.schema import Question

from env_loader import load_dotenv

load_dotenv()

DEFAULT_PIPE = Path(__file__).resolve().parent / "rocketride-server" / "pipelines" / "exa-search-working.pipe"
DEFAULT_GMI_PIPE = Path(__file__).resolve().parent / "rocketride-server" / "pipelines" / "gmi-ranker-working.pipe"


async def run_exa_search(
    query: str,
    *,
    uri: str | None = None,
    apikey: str | None = None,
    pipe: str | Path | None = None,
    timeout_seconds: float | None = None,
) -> Any:
    return await run_rocketride_chat_pipe(
        query,
        uri=uri,
        apikey=apikey,
        pipe=pipe or DEFAULT_PIPE,
        timeout_seconds=timeout_seconds,
    )


async def run_rocketride_chat_pipe(
    query: str,
    *,
    uri: str | None = None,
    apikey: str | None = None,
    pipe: str | Path | None = None,
    timeout_seconds: float | None = None,
) -> Any:
    pipe_path = Path(pipe or DEFAULT_PIPE).expanduser().resolve()
    if not pipe_path.exists():
        raise FileNotFoundError(f"Pipe file not found: {pipe_path}")

    client = RocketRideClient(
        uri=uri or os.environ.get("ROCKETRIDE_URI", "ws://localhost:5565"),
        auth=apikey or os.environ.get("ROCKETRIDE_APIKEY", "MYAPIKEY"),
    )
    await client.connect(timeout=timeout_seconds)
    try:
        result = await client.use(filepath=str(pipe_path))
        token = result["token"]
        try:
            question = Question()
            question.addQuestion(query)
            return await client.chat(token=token, question=question)
        finally:
            await client.terminate(token)
    finally:
        await client.disconnect()
