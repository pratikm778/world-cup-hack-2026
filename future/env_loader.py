import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def load_dotenv(path: str | Path = ".env") -> None:
    candidates = [
        Path(path),
        ROOT / path,
        ROOT.parent / ".env",
    ]
    seen: set[Path] = set()
    for candidate in candidates:
        env_path = candidate if candidate.is_absolute() else ROOT / candidate
        env_path = env_path.resolve()
        if env_path in seen or not env_path.exists():
            continue
        seen.add(env_path)
        _load_env_file(env_path)


def _load_env_file(env_path: Path) -> None:
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)
