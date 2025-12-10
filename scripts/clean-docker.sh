#!/usr/bin/env bash
# =============================================================================
# NewsInsight Docker Clean Script
# =============================================================================
# 이 스크립트는 NewsInsight 관련 docker-compose 스택을 정리합니다.
# - 각 compose 파일 기준으로 containers + networks + named volumes 를 정리
# - --full-prune 옵션 사용 시, 전체 Docker builder/image/volume/network prune 수행
#   (⚠️ 다른 프로젝트에도 영향이 갈 수 있으니 주의)
#
# 사용 예시:
#   ./scripts/clean-docker.sh
#   ./scripts/clean-docker.sh --full-prune
# =============================================================================

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-newsinsight}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/etc/docker"

COMPOSE_FILES=(
  "docker-compose.consul.yml"
  "docker-compose.zerotrust.yml"
  "docker-compose.zerotrust-preview.yml"
  "docker-compose.zerotrust-news.yml"
  "docker-compose.zerotrust-newsinsight.yml"
  "docker-compose.production.yml"
)

FULL_PRUNE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --full-prune)
      FULL_PRUNE=true
      shift
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      echo "Usage: $0 [--full-prune]" >&2
      exit 1
      ;;
  esac
done

echo "==== NewsInsight Docker Clean Preview ===="
echo "정리 대상 compose 파일들:"
for f in "${COMPOSE_FILES[@]}"; do
  echo "  - ${DOCKER_DIR}/${f}"
done

if [[ "${FULL_PRUNE}" == true ]]; then
  echo
  echo "[주의] --full-prune 옵션이 활성화되어 있습니다."
  echo "       docker builder/image/volume/network prune 가 수행되어,"
  echo "       NewsInsight 외의 Docker 리소스도 삭제될 수 있습니다."
fi

echo
read -rp "계속 진행할까요? [y/N]: " CONFIRM
CONFIRM=${CONFIRM:-N}
if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
  echo "중단되었습니다."
  exit 0
fi

for f in "${COMPOSE_FILES[@]}"; do
  if [[ -f "${DOCKER_DIR}/${f}" ]]; then
    echo
    echo "==== docker compose -p ${PROJECT_NAME} -f ${DOCKER_DIR}/${f} down -v ===="
    docker compose -p "${PROJECT_NAME}" -f "${DOCKER_DIR}/${f}" down -v || true
  fi
done

if [[ "${FULL_PRUNE}" == true ]]; then
  echo
  echo "==== Docker builder cache prune ===="
  docker builder prune -f || true

  echo
  echo "==== Docker image prune (dangling) ===="
  docker image prune -f || true

  echo
  echo "==== Docker volume prune (dangling) ===="
  docker volume prune -f || true

  echo
  echo "==== Docker network prune (dangling) ===="
  docker network prune -f || true
fi

echo
echo "정리가 완료되었습니다."
