@echo off
rem Starts the compositing API and the Vite dev server in two terminal windows.
start "AI Shubhkamna API (port 8000)" cmd /k "cd /d %~dp0server && .venv\Scripts\python run_local.py"
start "AI Shubhkamna Web (port 5173)" cmd /k "cd /d %~dp0 && npm run dev"
