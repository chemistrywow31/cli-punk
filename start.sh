#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  ""|"--web"|"web")
    ;;
  *)
    echo "Usage: ./start.sh [--web]" >&2
    exit 2
    ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
SERVER_URL="http://127.0.0.1:$PORT"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"

echo "Claude Punk"
echo "Root:     $ROOT_DIR"
echo "Backend:  $SERVER_URL"
echo "Frontend: $FRONTEND_URL"
echo

cd "$ROOT_DIR"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  echo "Installing dependencies..."
  npm install --prefix "$ROOT_DIR"
fi

npm --workspace backend run postinstall --silent >/dev/null 2>&1 || true

export ROOT_DIR
export PORT
export FRONTEND_PORT
export SERVER_URL
export FRONTEND_URL
export NO_OPEN="${NO_OPEN:-0}"

exec node "$ROOT_DIR/scripts/start.mjs"
