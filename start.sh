#!/usr/bin/env bash
# SURVIVOR SMP launcher: game server (HTTP static + WebSocket multiplayer + persistence)
set -uo pipefail
cd "$(dirname "$0")"
export PORT="${PORT:-3000}"

if node server/index.mjs; then
  exit 0
fi
echo "[start.sh] custom game server failed to start; falling back to static-only server" >&2
if [ -n "${RUNTIME_DIR:-}" ] && [ -f "$RUNTIME_DIR/scripts/default-start.mjs" ]; then
  exec node "$RUNTIME_DIR/scripts/default-start.mjs"
fi
exit 1
