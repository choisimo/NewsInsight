#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="$HOME/workspace/NewsInsight/etc/docker/docker-compose.zerotrust.yml"
PROJECT_NAME="newsinsight"

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down -v

docker builder prune -f

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" build

docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up -d
