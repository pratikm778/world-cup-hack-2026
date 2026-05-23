import asyncio
import logging
import os
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request

from env_loader import load_dotenv
from rocketride_exa import DEFAULT_PIPE, run_exa_search

load_dotenv()

app = Flask(__name__)
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


def _json_error(message: str, status_code: int):
    response = jsonify({"status": "error", "error": message})
    response.status_code = status_code
    return response


@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "rocketride_uri": os.environ.get("ROCKETRIDE_URI", "ws://localhost:5565"),
            "pipe": str(Path(os.environ.get("ROCKETRIDE_PIPE", DEFAULT_PIPE)).expanduser()),
        }
    )


@app.post("/search")
def search():
    payload: dict[str, Any] = request.get_json(silent=True) or {}
    query = str(payload.get("query") or "").strip()
    if not query:
        return _json_error("Request body must include a non-empty 'query'.", 400)

    try:
        result = asyncio.run(
            asyncio.wait_for(
                run_exa_search(
                    query,
                    uri=payload.get("uri") or os.environ.get("ROCKETRIDE_URI", "ws://localhost:5565"),
                    apikey=payload.get("apikey") or os.environ.get("ROCKETRIDE_APIKEY", "MYAPIKEY"),
                    pipe=payload.get("pipe") or os.environ.get("ROCKETRIDE_PIPE", DEFAULT_PIPE),
                    timeout_seconds=float(os.environ.get("ROCKETRIDE_CONNECT_TIMEOUT", "10")),
                ),
                timeout=float(os.environ.get("ROCKETRIDE_SEARCH_TIMEOUT", "90")),
            )
        )
    except TimeoutError:
        app.logger.exception("RocketRide Exa search timed out")
        return _json_error("RocketRide Exa search timed out.", 504)
    except FileNotFoundError as exc:
        app.logger.exception("Invalid pipeline path")
        return _json_error(str(exc), 400)
    except Exception as exc:
        app.logger.exception("RocketRide Exa search failed")
        return _json_error(str(exc), 502)

    return jsonify({"status": "ok", "query": query, "result": result})


if __name__ == "__main__":
    print(
        "RocketRide Exa API listening on "
        f"http://{os.environ.get('FLASK_HOST', '127.0.0.1')}:{os.environ.get('FLASK_PORT', '5000')}",
        flush=True,
    )
    app.run(
        host=os.environ.get("FLASK_HOST", "127.0.0.1"),
        port=int(os.environ.get("FLASK_PORT", "5055")),
        debug=os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"},
    )
