#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIRECTORY:=./backups}"

mkdir -p "$BACKUP_DIRECTORY"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIRECTORY/photomatch-$timestamp.dump"

pg_dump --format=custom --no-owner --no-acl --file="$output" "$DATABASE_URL"
printf '%s\n' "$output"
