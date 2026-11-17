#!/bin/bash
# Deploy Steadier: tests green, database backed up and checked, previous
# version kept for rollback, then the new version built and started.
#   bash scripts/deploy.sh
# Roll back:  bash scripts/rollback.sh
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== 1/5 Tests (type check + full suite, in Docker)"
docker run --rm -v "$PWD":/src:ro -v steadier-test-nm:/app/node_modules -w /app node:22 bash -c \
  'cd /src && tar --exclude=node_modules --exclude=.git --exclude=android --exclude=downloads -cf - . | (cd /app && tar xf -) && cd /app && corepack enable >/dev/null 2>&1 && CI=1 pnpm install --frozen-lockfile >/dev/null && CI=1 pnpm check && CI=1 pnpm test' \
  > /tmp/steadier-deploy-tests.log 2>&1 || { echo "Tests failed: nothing deployed. See /tmp/steadier-deploy-tests.log"; exit 1; }
grep -E "Tests +[0-9]+ passed" /tmp/steadier-deploy-tests.log | tail -1
echo "== 2/5 Database backup"
bash scripts/backup-db.sh
echo "== 3/5 Backup check (restores into a throwaway database)"
bash scripts/check-backup.sh | tail -2
echo "== 4/5 Keep the running version as steadier:previous"
docker image inspect steadier:latest >/dev/null 2>&1 && docker tag steadier:latest steadier:previous
git rev-parse --short HEAD > .deployed-commit
echo "== 5/5 Build and start"
docker compose up -d --build app
for _ in $(seq 1 18); do
  case "$(docker compose ps app --format '{{.Status}}')" in *"(healthy)"*) break;; esac
  sleep 5
done
docker compose ps app --format 'app: {{.Status}}'
curl -fsS -o /dev/null -w "site: HTTP %{http_code}\n" "$(grep ^PUBLIC_ORIGIN= .env | cut -d= -f2-)/api/health"
echo "Deployed $(cat .deployed-commit)."
