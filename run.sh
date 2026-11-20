#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -r requirements.txt
(cd frontend && npm install && npm run build && npm run build:extension)
if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${PORT:-8000}/api/health" >/dev/null 2>&1; then
  echo "Backend already running at http://127.0.0.1:${PORT:-8000}"
  exit 0
fi
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "${PORT:-8000}"
