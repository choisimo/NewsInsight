#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="newsinsight"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/etc/docker"

declare -A ENV_MAP=(
  ["1"]="zerotrust"
  ["2"]="local"
  ["3"]="gcp"
  ["4"]="aws"
)

echo "==== NewsInsight Docker 환경 선택 ===="
echo "  1) zerotrust"
echo "  2) local"
echo "  3) gcp"
echo "  4) aws"
read -rp "번호를 선택하세요 [1-4]: " env_choice

ENV_NAME="${ENV_MAP[${env_choice}]:-}"

if [[ -z "${ENV_NAME}" ]]; then
  echo "[ERROR] 잘못된 선택입니다: ${env_choice}" >&2
  exit 1
fi

COMPOSE_FILE="${DOCKER_DIR}/docker-compose.${ENV_NAME}.yml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "[ERROR] docker compose 파일을 찾을 수 없습니다: ${COMPOSE_FILE}" >&2
  echo "해당 환경용 compose 파일을 먼저 생성해주세요." >&2
  exit 1
fi

echo "선택된 환경: ${ENV_NAME}"
echo "사용할 compose 파일: ${COMPOSE_FILE}"

echo
echo "==== 정리 옵션 ===="
echo "풀 클린업: 컨테이너 중지, 캐시, 이미지, 볼륨(데이터베이스 볼륨 포함) 정리 후 재빌드/재기동"
read -rp "풀 클린업을 진행할까요? [y/N]: " CLEANUP
CLEANUP=${CLEANUP:-N}

if [[ "${CLEANUP}" =~ ^[Yy]$ ]]; then
  echo
  echo "==== 컨테이너 중지 및 볼륨(데이터베이스 포함) 제거 ===="
  docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" down -v || true

  echo
  echo "==== Docker 빌드 캐시 정리 ===="
  docker builder prune -f

  echo
  echo "==== 사용하지 않는 이미지 정리 ===="
  docker image prune -f

  echo
  echo "==== 사용하지 않는 볼륨 정리 ===="
  docker volume prune -f
else
  echo
  echo "==== 컨테이너 중지 (볼륨 유지) ===="
  docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" down || true

  echo
  echo "==== Docker 빌드 캐시 정리 (이미지/볼륨은 유지) ===="
  docker builder prune -f
fi

echo
echo "==== 이미지 빌드 ===="
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" build --progress=plain

echo
echo "==== 컨테이너 기동 (detached 모드) ===="
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" up -d

echo
echo "==== 완료 ===="
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" ps
