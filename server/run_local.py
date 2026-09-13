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
    uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
