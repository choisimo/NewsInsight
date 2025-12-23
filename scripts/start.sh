#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="newsinsight"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/etc/docker"
ENV_FILE="${DOCKER_DIR}/.env"

echo "==== NewsInsight Docker 환경 선택 ===="
echo "  1) zerotrust (Cloudflare Tunnel)"
echo "  2) consul (로컬 개발환경)"
echo "  3) production (원격 서버 배포용)"
read -rp "번호를 선택하세요 [1-3]: " env_choice

case "${env_choice}" in
  1)
    ENV_NAME="zerotrust"
    echo
    echo "==== Zerotrust 배포 대상 선택 ===="
    echo "  1) 기본(내부 테스트용)          - docker-compose.zerotrust.yml"
    echo "  2) newsinsight.nodove.com     - docker-compose.zerotrust-newsinsight.yml"
    echo "  3) news.nodove.com            - docker-compose.zerotrust-news.yml"
    echo "  4) preview (zerotrust-preview) - docker-compose.zerotrust-preview.yml"
    read -rp "번호를 선택하세요 [1-4, 기본=1]: " zerotrust_choice
    zerotrust_choice=${zerotrust_choice:-1}

    case "${zerotrust_choice}" in
      2)
        COMPOSE_SUFFIX="zerotrust-newsinsight"
        ;;
      3)
        COMPOSE_SUFFIX="zerotrust-news"
        ;;
      4)
        COMPOSE_SUFFIX="zerotrust-preview"
        ;;
      *)
        COMPOSE_SUFFIX="zerotrust"
        ;;
    esac
    ;;
  2)
    ENV_NAME="consul"
    COMPOSE_SUFFIX="consul"
    ;;
  3)
    ENV_NAME="production"
    COMPOSE_SUFFIX="production"
    ;;
  *)
    echo "[ERROR] 잘못된 선택입니다: ${env_choice}" >&2
    exit 1
    ;;
esac

COMPOSE_FILE="${DOCKER_DIR}/docker-compose.${COMPOSE_SUFFIX}.yml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "[ERROR] docker compose 파일을 찾을 수 없습니다: ${COMPOSE_FILE}" >&2
  echo "해당 환경용 compose 파일을 먼저 생성해주세요." >&2
  exit 1
fi

echo
echo "선택된 환경: ${ENV_NAME}"
echo "사용할 compose 파일: ${COMPOSE_FILE}"

# ENV_FILE 옵션 설정
ENV_FILE_OPT=""
if [[ -f "${ENV_FILE}" ]]; then
  echo "환경변수 파일: ${ENV_FILE}"
  ENV_FILE_OPT="--env-file ${ENV_FILE}"
else
  echo "환경변수 파일: (없음 - 기본값 사용)"
fi

echo
echo "==== 정리 옵션 ===="
echo "풀 클린업: 컨테이너 중지, 캐시, 이미지, 볼륨(데이터베이스 볼륨 포함) 정리 후 재빌드/재기동"
read -rp "풀 클린업을 진행할까요? [y/N]: " CLEANUP
CLEANUP=${CLEANUP:-N}

if [[ "${CLEANUP}" =~ ^[Yy]$ ]]; then
  echo
  echo "==== 컨테이너 중지 및 볼륨(데이터베이스 포함) 제거 ===="
  docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" down -v || true

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
  docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" down || true

  echo
  echo "==== Docker 빌드 캐시 정리 (이미지/볼륨은 유지) ===="
  docker builder prune -f
fi

echo
echo "==== 이미지 빌드 ===="
if ! docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" build --progress=plain; then
  echo "[ERROR] 이미지 빌드에 실패했습니다." >&2
  exit 1
fi

echo
echo "==== 컨테이너 기동 (detached 모드) ===="
if ! docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" up -d; then
  echo "[ERROR] 컨테이너 기동에 실패했습니다." >&2
  echo "로그 확인: docker compose -p ${PROJECT_NAME} -f ${COMPOSE_FILE} logs" >&2
  exit 1
fi

echo
echo "==== 서비스 상태 대기 (최대 60초) ===="
MAX_WAIT=60
WAITED=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
  # Check if consul-seed completed (if it exists and is expected to complete)
  SEED_STATUS=$(docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" ps consul-seed --format '{{.State}}' 2>/dev/null || echo "missing")
  
  if [[ "$SEED_STATUS" == "exited" ]] || [[ "$SEED_STATUS" == "missing" ]]; then
    # Check exit code if exited
    if [[ "$SEED_STATUS" == "exited" ]]; then
      SEED_EXIT_CODE=$(docker inspect --format='{{.State.ExitCode}}' newsinsight-consul-seed-1 2>/dev/null || echo "0")
      if [[ "$SEED_EXIT_CODE" != "0" ]]; then
        echo "[WARNING] consul-seed exited with code $SEED_EXIT_CODE" >&2
        echo "로그 확인: docker logs newsinsight-consul-seed-1" >&2
      fi
    fi
    break
  fi
  
  echo "서비스 초기화 대기 중... ($WAITED/${MAX_WAIT}초)"
  sleep 5
  WAITED=$((WAITED + 5))
done

echo
echo "==== 완료 ===="
docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" ps

echo
echo "==== 서비스 상태 요약 ===="
UNHEALTHY=$(docker compose -p "${PROJECT_NAME}" ${ENV_FILE_OPT} -f "${COMPOSE_FILE}" ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -i "unhealthy" || true)
if [[ -n "$UNHEALTHY" ]]; then
  echo "[WARNING] 다음 서비스가 unhealthy 상태입니다:"
  echo "$UNHEALTHY"
  echo "로그 확인: docker compose -p ${PROJECT_NAME} -f ${COMPOSE_FILE} logs <service-name>"
else
  echo "[OK] 모든 서비스가 정상적으로 시작되었습니다."
fi
