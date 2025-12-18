#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROJECT_NAME_DEFAULT="newsinsight"
COMPOSE_FILE_REL_DEFAULT="etc/docker/docker-compose.production.yml"
DEPLOY_PATH_DEFAULT="NewsInsight"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-remote-sshconfig.sh --host <ssh_alias> [options]

Required:
  --host <ssh_alias>        SSH config에 등록된 Host alias (예: pmx-102-2)

Options:
  --path <remote_path>      원격 서버의 프로젝트 루트 경로 (default: NewsInsight)
  --project-name <name>     docker compose -p 프로젝트명 (default: newsinsight)
  --compose-rel <path>      프로젝트 루트 기준 compose 파일 상대경로 (default: etc/docker/docker-compose.production.yml)
  --skip-build              로컬 빌드/푸시 단계 생략 (원격 배포만)
  --copy-env                로컬 etc/docker/.env 를 원격 etc/docker/.env 로 복사

Notes:
  - ssh/scp 모두 --host 값만 사용합니다. (User/Port/IdentityFile 등은 ~/.ssh/config 적용)
  - production compose의 ./db-init 마운트를 위해 etc/docker/db-init 디렉터리도 원격에 복사합니다.
EOF
}

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_PATH="${DEPLOY_PATH:-${DEPLOY_PATH_DEFAULT}}"
PROJECT_NAME="${PROJECT_NAME:-${PROJECT_NAME_DEFAULT}}"
COMPOSE_FILE_REL="${COMPOSE_FILE_REL:-${COMPOSE_FILE_REL_DEFAULT}}"
SKIP_BUILD=false
COPY_ENV=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      DEPLOY_HOST="${2:-}"
      shift 2
      ;;
    --path)
      DEPLOY_PATH="${2:-}"
      shift 2
      ;;
    --project-name)
      PROJECT_NAME="${2:-}"
      shift 2
      ;;
    --compose-rel)
      COMPOSE_FILE_REL="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --copy-env)
      COPY_ENV=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac

done

if [[ -z "${DEPLOY_HOST}" ]]; then
  echo "[ERROR] --host (또는 DEPLOY_HOST) 가 필요합니다." >&2
  usage >&2
  exit 1
fi

LOCAL_COMPOSE_PATH="${PROJECT_ROOT}/${COMPOSE_FILE_REL}"
LOCAL_DB_INIT_DIR="${PROJECT_ROOT}/etc/docker/db-init"
LOCAL_ENV_PATH="${PROJECT_ROOT}/etc/docker/.env"

if [[ ! -f "${LOCAL_COMPOSE_PATH}" ]]; then
  echo "[ERROR] Compose 파일을 찾을 수 없습니다: ${LOCAL_COMPOSE_PATH}" >&2
  exit 1
fi

cat <<EOF
==============================================
 NewsInsight Remote Deploy (ssh config)
==============================================
  Host        : ${DEPLOY_HOST}
  Remote Path : ${DEPLOY_PATH}
  Compose     : ${COMPOSE_FILE_REL}
  Project     : ${PROJECT_NAME}
  Build       : $([[ "${SKIP_BUILD}" == true ]] && echo "skip" || echo "build-and-push")
  Copy .env   : $([[ "${COPY_ENV}" == true ]] && echo "yes" || echo "no")
==============================================
EOF

if [[ "${SKIP_BUILD}" == false ]]; then
  echo "[INFO] 로컬 빌드/푸시: ${SCRIPT_DIR}/build-and-push.sh"
  "${SCRIPT_DIR}/build-and-push.sh"
fi

echo "[INFO] 원격 디렉터리 준비..."
ssh "${DEPLOY_HOST}" "mkdir -p '${DEPLOY_PATH}/etc/docker' '${DEPLOY_PATH}/etc/docker/db-init'"

echo "[INFO] Compose 파일 업로드..."
scp "${LOCAL_COMPOSE_PATH}" "${DEPLOY_HOST}:${DEPLOY_PATH}/${COMPOSE_FILE_REL}"

if [[ -d "${LOCAL_DB_INIT_DIR}" ]]; then
  echo "[INFO] db-init 업로드..."
  scp -r "${LOCAL_DB_INIT_DIR}" "${DEPLOY_HOST}:${DEPLOY_PATH}/etc/docker/"
fi

if [[ "${COPY_ENV}" == true ]]; then
  if [[ -f "${LOCAL_ENV_PATH}" ]]; then
    echo "[INFO] .env 업로드..."
    scp "${LOCAL_ENV_PATH}" "${DEPLOY_HOST}:${DEPLOY_PATH}/etc/docker/.env"
  else
    echo "[WARN] 로컬 .env 파일이 없어 복사하지 않습니다: ${LOCAL_ENV_PATH}" >&2
  fi
fi

echo "[INFO] 원격 배포 실행..."
ssh "${DEPLOY_HOST}" bash -s -- "${DEPLOY_PATH}" "${COMPOSE_FILE_REL}" "${PROJECT_NAME}" <<'REMOTE_EOF'
set -euo pipefail

DEPLOY_PATH="$1"
COMPOSE_FILE_REL="$2"
PROJECT_NAME="$3"

cd "${DEPLOY_PATH}"

if [[ ! -f "${COMPOSE_FILE_REL}" ]]; then
  echo "[ERROR] compose 파일을 찾을 수 없습니다: ${COMPOSE_FILE_REL}" >&2
  exit 1
fi

COMPOSE_DIR="$(dirname "${COMPOSE_FILE_REL}")"
if [[ ! -f "${COMPOSE_DIR}/.env" ]]; then
  echo "[WARN] ${COMPOSE_DIR}/.env 가 없습니다. 필요한 환경변수는 compose 실행 시 외부에서 주입되어야 합니다." >&2
fi

ENV_FILE="${COMPOSE_DIR}/.env"
COMPOSE_OPTS="-p ${PROJECT_NAME} -f ${COMPOSE_FILE_REL}"
if [[ -f "${ENV_FILE}" ]]; then
  COMPOSE_OPTS="--env-file ${ENV_FILE} ${COMPOSE_OPTS}"
fi

echo "[INFO] docker compose pull (가능한 경우)"
docker compose ${COMPOSE_OPTS} pull --ignore-pull-failures || true

echo "[INFO] docker compose up -d"
docker compose ${COMPOSE_OPTS} up -d

echo "[INFO] 현재 컨테이너 상태:"
docker compose ${COMPOSE_OPTS} ps
REMOTE_EOF

echo "[INFO] 완료"
