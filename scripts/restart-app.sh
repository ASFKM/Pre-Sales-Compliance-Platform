#!/usr/bin/env bash
set -euo pipefail

# Restarts the built app after `npm run build`, working both on the dev server (systemd
# service "commercial-assistant-ai") and in CI (no systemd - run dist/server.cjs directly
# in the background, matching what the systemd unit does).
if [ -n "${CI:-}" ]; then
  pkill -f "node dist/server.cjs" >/dev/null 2>&1 || true
  sleep 1
  NODE_ENV=production nohup node dist/server.cjs > /tmp/ci-app.log 2>&1 &
  disown
else
  sudo systemctl restart commercial-assistant-ai
fi
