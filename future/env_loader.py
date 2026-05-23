import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_dotenv(path: str | Path = ".env") -> None:
    env_path = Path(path)
    if not env_path.is_absolute():
        env_path = ROOT / env_path
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)
