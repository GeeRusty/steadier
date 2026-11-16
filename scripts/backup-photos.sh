#!/bin/bash
# Nightly backup of Steadier task photos (runs after backup-db.sh).
#
# Photos never change once saved (markup is kept beside them, in the
# workspace), so each photo is copied once and never again: this only adds
# new files. Previews (*.thumb.jpg) are not backed up; the app rebuilds
# nothing from them and they are re-made on upload.
#
# A photo is removed from the backup only when the app has purged it, 30 days
# after it was deleted (listed in purged.log). Nothing else is ever removed,
# so an accident in the live folder can't empty the backup.
set -euo pipefail
LIVE="${PHOTOS_HOST_DIR:-$HOME/steadier-photos}"
DEST="$HOME/backups/steadier-photos"
mkdir -p "$DEST"
[ -d "$LIVE" ] || { echo "$(date '+%F %T') no photos folder yet"; exit 0; }

rsync -a --ignore-existing --chmod=F644,D755 \
  --include='*/' --include='[0-9a-f]*.jpg' --exclude='*.thumb.jpg' --exclude='*' \
  "$LIVE"/ "$DEST"/

removed=0
if [ -f "$LIVE/purged.log" ]; then
  while read -r _when rel; do
    [[ "$rel" =~ ^[1-9][0-9]*/[0-9a-f]{64}\.jpg$ ]] || continue
    if [ -f "$DEST/$rel" ]; then rm -f "$DEST/$rel"; removed=$((removed + 1)); fi
  done < "$LIVE/purged.log"
fi

count=$(find "$DEST" -name '*.jpg' | wc -l)
echo "$(date '+%F %T') photos backed up: $count stored ($(du -sh "$DEST" | cut -f1)), $removed removed after 30 days"
