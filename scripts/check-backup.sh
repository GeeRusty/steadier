#!/bin/bash
# Proves a database backup really restores: loads it into a throwaway MySQL
# (no network, deleted afterwards) and counts what came back. Touches nothing live.
#   bash scripts/check-backup.sh                 (the newest backup)
#   bash scripts/check-backup.sh FILE.sql.gz     (a particular one)
set -euo pipefail
FILE="${1:-$(ls -1t "$HOME"/backups/steadier/steadier-*.sql.gz | head -1)}"
[ -f "$FILE" ] || { echo "No backup file found." >&2; exit 1; }
echo "Checking $FILE ($(du -h "$FILE" | cut -f1))"
gzip -t "$FILE" || { echo "FAIL: the file is damaged (gzip test failed)." >&2; exit 1; }
gunzip -c "$FILE" | tail -1 | grep -q "Dump completed" || { echo "FAIL: the dump is incomplete." >&2; exit 1; }
NAME="steadier-backup-check-$$"
PW="check-$RANDOM$RANDOM"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$NAME" --network none -e MYSQL_ROOT_PASSWORD="$PW" -e MYSQL_DATABASE=steadier mysql:8.4 >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" mysql -uroot -p"$PW" -e "SELECT 1" steadier >/dev/null 2>&1 && break
  sleep 2
done
gunzip -c "$FILE" | docker exec -i "$NAME" sh -c "mysql -uroot -p'$PW' steadier" 2>/dev/null
q() { docker exec "$NAME" mysql -N -uroot -p"$PW" steadier -e "$1" 2>/dev/null; }
users=$(q "SELECT COUNT(*) FROM users")
spaces=$(q "SELECT COUNT(*) FROM steadier_workspaces")
tasks=$(q "SELECT COALESCE(SUM(JSON_LENGTH(workspaceJson, '$.tasks')),0) FROM steadier_workspaces")
latest=$(q "SELECT MAX(updatedAt) FROM steadier_workspaces")
echo "Restored OK: $users account(s), $spaces workspace(s), $tasks task(s); last change $latest (server time)."
[ "${spaces:-0}" -ge 1 ] || { echo "FAIL: no workspace in the backup." >&2; exit 1; }
echo "PASS"
