#!/bin/bash
# Task 6: start dev server if needed, wait for API health, run webhook tests.
set -u
cd /home/z/my-project

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/api/users 2>/dev/null)
if [ "$code" != "200" ]; then
  echo "[runner] starting dev server…"
  pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null; sleep 2
  fuser -k 3000/tcp 2>/dev/null; sleep 1
  nohup bun run dev > /dev/null 2>&1 &
  for i in $(seq 1 90); do
    sleep 3
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 http://127.0.0.1:3000/api/users 2>/dev/null)
    [ "$code" = "200" ] && break
  done
fi

echo "[runner] /api/users -> $code"
if [ "$code" != "200" ]; then
  echo "[runner] FAILED to bring server up"; exit 1
fi

echo "[runner] running Discord webhook integration test…"
python3 scripts/test_webhook_discord.py
rc=$?
echo "[runner] test exit code: $rc"
exit $rc
