#!/usr/bin/env bash
# Manual deploy — run on the VPS from the repo root.
#   ./scripts/deploy.sh
# Pulls latest main, rebuilds, and restarts. Migrations run automatically when
# the api container boots (see server/Dockerfile CMD).
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

echo "==> Pulling latest code"
git pull origin main

echo "==> Building images"
$COMPOSE build

echo "==> Starting stack"
$COMPOSE up -d

echo "==> Waiting for API health"
sleep 5
$COMPOSE ps

echo "==> Pruning old images"
docker image prune -f

echo "✅ Deploy complete. App is live on http://<VPS_IP>/"
