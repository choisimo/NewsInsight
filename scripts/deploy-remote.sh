#!/usr/bin/env bash
# =============================================================================
# NewsInsight Remote Deploy Script
# =============================================================================
# - 로컬에서 Docker 이미지를 빌드 & GCP Artifact Registry에 푸시한 뒤
# - 원격 리눅스 서버(예: pmx-102-2)에서 docker-compose.production.yml 로 배포합니다.
#
# 사용법 예시:
#   export DEPLOY_HOST="pmx-102-2"        # 필수: 원격 서버 호스트명 또는 IP
#   export DEPLOY_USER="ubuntu"          # 선택: 기본값 ubuntu
#   export DEPLOY_PATH="/opt/NewsInsight" # 선택: 기본값 /home/$DEPLOY_USER/NewsInsight
#
#   ./scripts/deploy-remote.sh             # 빌드+푸시 후 원격 배포
#   ./scripts/deploy-remote.sh --skip-build  # 이미 이미지를 푸시했다면 빌드 생략
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROJECT_NAME="${PROJECT_NAME:-newsinsight}"
COMPOSE_FILE_REL="etc/docker/docker-compose.production.yml"

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PATH_DEFAULT="/home/${DEPLOY_USER}/NewsInsight"
DEPLOY_PATH="${DEPLOY_PATH:-${DEPLOY_PATH_DEFAULT}}"

SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --host)
      DEPLOY_HOST="$2"
      shift 2
      ;;
    --user)
      DEPLOY_USER="$2"
      shift 2
      ;;
    --path)
      DEPLOY_PATH="$2"
      shift 2
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      echo "Usage: $0 [--skip-build] [--host HOST] [--user USER] [--path PATH]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${DEPLOY_HOST}" ]]; then
  echo "[ERROR] DEPLOY_HOST 가 설정되어 있지 않습니다." >&2
  echo "  예: export DEPLOY_HOST=pmx-102-2" >&2
  exit 1
fi

cat <<EOF
==============================================
 NewsInsight Remote Deploy
==============================================
  Host : ${DEPLOY_USER}@${DEPLOY_HOST}
  Path : ${DEPLOY_PATH}
  File : ${COMPOSE_FILE_REL}
  Build: $([[ "${SKIP_BUILD}" == true ]] && echo "skip" || echo "build-and-push")
==============================================
EOF

if [[ "${SKIP_BUILD}" == false ]]; then
  echo "[INFO] 로컬에서 Docker 이미지 빌드 및 푸시를 수행합니다..."
  "${SCRIPT_DIR}/build-and-push.sh"
else
  echo "[INFO] --skip-build 지정: 빌드/푸시 단계 생략합니다."
fi

echo
echo "[INFO] 원격 서버에 배포를 시작합니다..."
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash -s <<EOF
set -euo pipefail

cd "${DEPLOY_PATH}"

if [[ ! -f "${COMPOSE_FILE_REL}" ]]; then
  echo "[ERROR] ${COMPOSE_FILE_REL} 파일을 찾을 수 없습니다." >&2
  exit 1
fi

echo "[INFO] docker compose pull (가능한 경우)"
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE_REL}" pull || true

echo "[INFO] docker compose up -d"
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE_REL}" up -d

echo "[INFO] 현재 컨테이너 상태:"
docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE_REL}" ps
EOF

echo
echo "[INFO] 원격 배포가 완료되었습니다."
