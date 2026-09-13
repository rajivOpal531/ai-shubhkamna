"""Start the compositing service for local testing, reading server/.env for settings.

Usage (from anywhere):  .venv\Scripts\python run_local.py
"""
from __future__ import annotations

import os
from pathlib import Path

import uvicorn

HERE = Path(__file__).resolve().parent
os.chdir(HERE)

env_file = HERE / ".env"
if env_file.is_file():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

if __name__ == "__main__":
    # host="localhost" makes asyncio bind every address the name resolves to (::1 and 127.0.0.1),
    # so browsers that pick IPv6 for localhost reach the API just like IPv4 clients do.
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="localhost",
        port=int(os.environ.get("PORT", "8000")),
    )