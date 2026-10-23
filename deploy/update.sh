#!/bin/sh
# Pull the newest worker image from Docker Hub and restart the workers only if it changed. Run every 5 minutes by
# swipeapply-update.timer (docs/DEPLOY.md, "Home server"). An unchanged image leaves the running workers alone; a changed one
# replaces them one at a time, each finishing its runs in progress first (stop_grace_period in docker-compose.yml).
set -eu
cd "$(dirname "$0")"
docker compose pull --quiet
docker compose up -d --remove-orphans
# Old images left behind by updates.
docker image prune -f >/dev/null
