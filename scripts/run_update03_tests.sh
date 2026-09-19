#!/bin/bash
# Update 0.3: start dev server if needed, wait for API health, run the full
# API regression (task3 suite with decision-flow + cancel tests), then the
# Discord webhook integration suite and the channel-adapter unit checks.
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

echo "[runner] running task3 API regression (update 0.3)…"
python3 scripts/test_task3_api.py
rc1=$?

echo "[runner] running Discord webhook integration test…"
python3 scripts/test_webhook_discord.py
rc2=$?

echo "[runner] running webhook channel adapter checks…"
bun scripts/webhook_channels_check.ts
rc3=$?

echo "[runner] exit codes: task3=$rc1 discord=$rc2 channels=$rc3"
overall=0
[ "$rc1" != "0" ] && overall=1
[ "$rc2" != "0" ] && overall=1
[ "$rc3" != "0" ] && overall=1
exit $overall
