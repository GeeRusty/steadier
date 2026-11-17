#!/bin/bash
# Put back the version that ran before the last deploy (steadier:previous).
# The database is not touched: changes are additive, and the app reads old
# and new data. To also undo data, restore the backup the deploy took
# (RUNBOOK.md, "Restore a backup").
set -euo pipefail
cd "$(dirname "$0")/.."
docker image inspect steadier:previous >/dev/null 2>&1 || { echo "No previous version kept yet."; exit 1; }
docker tag steadier:previous steadier:latest
docker compose up -d --no-build app
for _ in $(seq 1 18); do
  case "$(docker compose ps app --format '{{.Status}}')" in *"(healthy)"*) break;; esac
  sleep 5
done
docker compose ps app --format 'app: {{.Status}}'
echo "Rolled back. The code in git is unchanged: fix forward, or 'git revert' the bad commit and deploy again."
