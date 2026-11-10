#!/bin/bash
# Daily Steadier database backup. Keeps the last 14 days in ~/backups/steadier.
# Restore: gunzip -c FILE | docker exec -i steadier-db-1 sh -c 'mysql -usteadier -p"$MYSQL_PASSWORD" steadier'
set -euo pipefail
DEST="$HOME/backups/steadier"
mkdir -p "$DEST"
umask 077
FILE="$DEST/steadier-$(date +%Y-%m-%d_%H%M).sql.gz"
docker exec steadier-db-1 sh -c 'mysqldump -usteadier -p"$MYSQL_PASSWORD" --single-transaction --no-tablespaces --routines steadier' | gzip > "$FILE.tmp"
# Sanity check: a complete dump ends with "Dump completed".
gunzip -c "$FILE.tmp" | tail -1 | grep -q "Dump completed" || { echo "Backup incomplete" >&2; rm -f "$FILE.tmp"; exit 1; }
mv "$FILE.tmp" "$FILE"
find "$DEST" -name 'steadier-*.sql.gz' -mtime +14 -delete
echo "$(date '+%F %T') saved $FILE ($(du -h "$FILE" | cut -f1))"
