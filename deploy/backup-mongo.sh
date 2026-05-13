#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/quizsolver-mongo}"
DB_NAME="${DB_NAME:-quizsolver}"
MONGO_URI="${MONGO_URI:-mongodb://quizsolver_admin:CHANGE_ME_MONGO_PASSWORD@127.0.0.1:27017/quizsolver?authSource=admin}"

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}-$(date +%F-%H%M%S).archive.gz"

if command -v mongodump >/dev/null 2>&1; then
  mongodump --uri="$MONGO_URI" --archive="$BACKUP_FILE" --gzip
elif command -v docker >/dev/null 2>&1; then
  docker exec quizsolver-mongo mongodump --uri="$MONGO_URI" --archive --gzip > "$BACKUP_FILE"
else
  echo "mongodump or docker is required for backups." >&2
  exit 1
fi

find "$BACKUP_DIR" -type f -name "${DB_NAME}-*.archive.gz" -mtime +14 -delete
