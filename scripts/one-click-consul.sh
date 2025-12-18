#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="newsinsight"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/etc/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.consul.yml"
ENV_FILE="${DOCKER_DIR}/.env"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
info() { printf "[INFO] %s\n" "$*"; }
warn() { printf "[WARN] %s\n" "$*"; }
err() { printf "[ERROR] %s\n" "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

require_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    return 0
  fi
  if ! need_cmd sudo; then
    err "sudo가 필요하지만 설치되어 있지 않습니다. root 권한으로 실행해주세요."
    exit 1
  fi
  sudo -v
}

install_docker_get_docker() {
  bold "Docker 설치 중 (get.docker.com)..."

  if ! need_cmd curl && need_cmd apt-get; then
    require_sudo
    sudo apt-get update -y
    sudo apt-get install -y curl
  fi

  if need_cmd curl; then
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  elif need_cmd wget; then
    wget -qO /tmp/get-docker.sh https://get.docker.com
  else
    err "Docker 설치를 위해 curl 또는 wget이 필요합니다."
    exit 1
  fi

  require_sudo
  sudo sh /tmp/get-docker.sh
}

start_docker_daemon() {
  if ! need_cmd docker; then
    return 0
  fi

  if docker info >/dev/null 2>&1; then
    return 0
  fi

  bold "Docker 데몬 시작 중..."
  require_sudo

  if need_cmd systemctl; then
    sudo systemctl enable --now docker || true
    sudo systemctl start docker || true
  elif need_cmd service; then
    sudo service docker start || true
  fi

  if ! docker info >/dev/null 2>&1; then
    err "Docker 데몬을 시작하지 못했습니다. (systemctl/service 확인 필요)"
    exit 1
  fi
}

ensure_docker_installed() {
  if need_cmd docker; then
    return 0
  fi

  warn "Docker가 설치되어 있지 않습니다. 자동 설치를 진행합니다."
  install_docker_get_docker

  if ! need_cmd docker; then
    err "Docker 설치에 실패했습니다."
    exit 1
  fi
}

have_docker_compose_plugin() {
  docker compose version >/dev/null 2>&1
}

ensure_docker_compose() {
  if have_docker_compose_plugin; then
    return 0
  fi

  warn "docker compose 플러그인을 찾지 못했습니다. 설치를 시도합니다."

  if need_cmd apt-get; then
    require_sudo
    sudo apt-get update -y
    sudo apt-get install -y docker-compose-plugin || true
  fi

  if have_docker_compose_plugin; then
    return 0
  fi

  if need_cmd docker-compose; then
    return 0
  fi

  err "Docker Compose를 사용할 수 없습니다. docker compose 플러그인 또는 docker-compose 설치가 필요합니다."
  exit 1
}

docker_cmd() {
  if docker ps >/dev/null 2>&1; then
    docker "$@"
  else
    require_sudo
    sudo docker "$@"
  fi
}

compose_cmd() {
  if docker_cmd compose version >/dev/null 2>&1; then
    docker_cmd compose "$@"
  else
    if need_cmd docker-compose; then
      docker-compose "$@"
    else
      err "Docker Compose 실행기를 찾지 못했습니다."
      exit 1
    fi
  fi
}

main() {
  bold "NewsInsight: docker-compose.consul.yml 원클릭 빌드/실행"
  echo

  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    err "compose 파일을 찾을 수 없습니다: ${COMPOSE_FILE}"
    exit 1
  fi

  info "프로젝트 경로: ${PROJECT_ROOT}"
  info "compose 파일: ${COMPOSE_FILE}"

  ensure_docker_installed
  start_docker_daemon
  ensure_docker_compose

  local -a env_opt=()
  if [[ -f "${ENV_FILE}" ]]; then
    info "env 파일: ${ENV_FILE}"
    env_opt=(--env-file "${ENV_FILE}")
  else
    info "env 파일: 없음 (compose 기본값 사용)"
  fi

  bold "이전 컨테이너 정리 (볼륨 유지)"
  compose_cmd -p "${PROJECT_NAME}" "${env_opt[@]}" -f "${COMPOSE_FILE}" down --remove-orphans || true

  bold "이미지 빌드"
  DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 \
    compose_cmd -p "${PROJECT_NAME}" "${env_opt[@]}" -f "${COMPOSE_FILE}" build --progress=plain

  bold "컨테이너 기동"
  compose_cmd -p "${PROJECT_NAME}" "${env_opt[@]}" -f "${COMPOSE_FILE}" up -d

  echo
  bold "상태 확인"
  compose_cmd -p "${PROJECT_NAME}" "${env_opt[@]}" -f "${COMPOSE_FILE}" ps

  echo
  bold "접속 주소"
  printf -- '%s\n' "- Frontend:      http://localhost:8810"
  printf -- '%s\n' "- API Gateway:   http://localhost:8112"
  printf -- '%s\n' "- Consul UI:     http://localhost:8505"
  printf -- '%s\n' "- Crawl4AI:      http://localhost:11235"
  printf -- '%s\n' "- Browser-Use:   http://localhost:8501"
  printf -- '\n'

  info "완료되었습니다."
}

main "$@"
