#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="newsinsight"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${PROJECT_ROOT}/etc/docker"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.consul.yml"
ENV_FILE="${DOCKER_DIR}/.env"

PKG_MANAGER=""
OS_PRETTY_NAME=""
OS_KERNEL=""
OS_ARCH=""
IS_WSL="false"

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

detect_platform() {
  OS_KERNEL="$(uname -s 2>/dev/null || echo unknown)"
  OS_ARCH="$(uname -m 2>/dev/null || echo unknown)"

  case "${OS_KERNEL}" in
    Linux*)
      ;;
    Darwin*)
      err "macOS 환경이 감지되었습니다. Docker Desktop을 사용해 컨테이너를 실행한 뒤 'docker compose'를 직접 실행해주세요."
      exit 1
      ;;
    MINGW*|MSYS*|CYGWIN*|Windows*)
      err "Windows/WSL1 환경에서는 이 스크립트가 지원되지 않습니다. WSL2 + systemd 또는 Linux 서버에서 실행해주세요."
      exit 1
      ;;
    *)
      warn "알 수 없는 OS 커널: ${OS_KERNEL}. Linux 환경에서만 정상 동작할 수 있습니다."
      ;;
  esac

  if [[ -f /proc/sys/kernel/osrelease ]] && grep -qi microsoft /proc/sys/kernel/osrelease; then
    IS_WSL="true"
    warn "WSL 환경이 감지되었습니다. systemd가 활성화되어 있어야 Docker 데몬 제어가 가능합니다."
    warn "Windows Docker Desktop과 WSL 통합을 사용하는 경우, 이 스크립트 대신 Docker Desktop에서 compose를 실행해주세요."
  fi
}

detect_pkg_manager() {
  if [[ -n "${PKG_MANAGER}" ]]; then
    return 0
  fi

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_PRETTY_NAME=${PRETTY_NAME:-${NAME:-unknown}}
  else
    OS_PRETTY_NAME="$(uname -s)"
  fi

  for pm in apt-get dnf yum zypper pacman apk; do
    if command -v "$pm" >/dev/null 2>&1; then
      PKG_MANAGER="$pm"
      break
    fi
  done

  if [[ -z "${PKG_MANAGER}" ]]; then
    warn "지원되는 패키지 관리자를 찾지 못했습니다. (apt/dnf/yum/zypper/pacman/apk)"
  else
    info "감지된 OS: ${OS_PRETTY_NAME} / 패키지 관리자: ${PKG_MANAGER}"
  fi
}

pkg_update() {
  detect_pkg_manager
  case "${PKG_MANAGER}" in
    apt-get)
      require_sudo
      sudo apt-get update -y
      ;;
    dnf|yum)
      require_sudo
      sudo "${PKG_MANAGER}" makecache -y >/dev/null 2>&1 || true
      ;;
    zypper)
      require_sudo
      sudo zypper refresh
      ;;
    pacman)
      require_sudo
      sudo pacman -Sy --noconfirm
      ;;
    apk)
      require_sudo
      sudo apk update
      ;;
  esac
}

pkg_install() {
  local packages=("$@")
  detect_pkg_manager

  if [[ -z "${PKG_MANAGER}" ]]; then
    err "패키지 관리자를 감지하지 못했습니다. 수동으로 ${packages[*]} 설치 후 다시 실행해주세요."
    exit 1
  fi

  case "${PKG_MANAGER}" in
    apt-get)
      require_sudo
      sudo apt-get install -y "${packages[@]}"
      ;;
    dnf|yum)
      require_sudo
      sudo "${PKG_MANAGER}" install -y "${packages[@]}"
      ;;
    zypper)
      require_sudo
      sudo zypper --non-interactive install "${packages[@]}"
      ;;
    pacman)
      require_sudo
      sudo pacman -Sy --noconfirm "${packages[@]}"
      ;;
    apk)
      require_sudo
      sudo apk add --no-cache "${packages[@]}"
      ;;
    *)
      err "패키지 설치를 지원하지 않는 환경입니다. (${PKG_MANAGER})"
      exit 1
      ;;
  esac
}

ensure_network_connectivity() {
  local test_url="https://get.docker.com"
  if need_cmd curl; then
    if ! curl -fsSL --max-time 10 "${test_url}" >/dev/null; then
      warn "인터넷 연결을 확인할 수 없습니다. 프록시/방화벽 설정을 확인해주세요."
      return 1
    fi
  elif need_cmd wget; then
    if ! wget -q --spider --timeout=10 "${test_url}"; then
      warn "인터넷 연결을 확인할 수 없습니다. 프록시/방화벽 설정을 확인해주세요."
      return 1
    fi
  else
    warn "curl/wget이 없어 네트워크 상태를 확인할 수 없습니다."
  fi
  return 0
}

ensure_download_tool() {
  if need_cmd curl || need_cmd wget; then
    return 0
  fi

  detect_pkg_manager
  if [[ -n "${PKG_MANAGER}" ]]; then
    info "curl/wget을 찾을 수 없어 설치합니다."
    case "${PKG_MANAGER}" in
      apt-get)
        pkg_update
        pkg_install curl wget
        ;;
      dnf|yum|zypper|pacman|apk)
        pkg_install curl wget
        ;;
      *)
        err "curl 또는 wget을 설치할 수 없습니다. 수동 설치 후 재실행해주세요."
        exit 1
        ;;
    esac
  fi

  if ! need_cmd curl && ! need_cmd wget; then
    err "curl 또는 wget이 필요합니다. 설치 후 재실행해주세요."
    exit 1
  fi
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

  ensure_download_tool

  ensure_network_connectivity || true

  if need_cmd curl; then
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  elif need_cmd wget; then
    wget -qO /tmp/get-docker.sh https://get.docker.com
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

install_docker_compose_binary() {
  local version="${1:-v2.30.0}"
  local target="/usr/local/bin/docker-compose"
  local url="https://github.com/docker/compose/releases/download/${version}/docker-compose-$(uname -s)-$(uname -m)"

  ensure_download_tool

  bold "Docker Compose standalone 바이너리를 설치합니다. (${version})"
  require_sudo
  if need_cmd curl; then
    sudo curl -L "${url}" -o "${target}"
  else
    sudo wget -O "${target}" "${url}"
  fi
  sudo chmod +x "${target}"
}

install_docker_compose_plugin() {
  detect_pkg_manager
  if [[ -z "${PKG_MANAGER}" ]]; then
    warn "패키지 관리자를 감지하지 못했습니다. Compose 플러그인을 바이너리로 설치합니다."
    install_docker_compose_binary
    return
  fi

  bold "Docker Compose 플러그인 설치 시도 (${PKG_MANAGER})"
  case "${PKG_MANAGER}" in
    apt-get)
      pkg_update
      pkg_install docker-compose-plugin
      ;;
    dnf|yum)
      pkg_install docker-compose-plugin || pkg_install docker-compose
      ;;
    zypper)
      pkg_install docker-compose-plugin || pkg_install docker-compose
      ;;
    pacman)
      pkg_install docker-compose
      ;;
    apk)
      pkg_install docker-cli-compose || pkg_install docker-compose
      ;;
    *)
      warn "패키지 관리자를 통한 설치를 지원하지 않습니다. 바이너리 설치를 시도합니다."
      install_docker_compose_binary
      ;;
  esac
}

ensure_docker_compose() {
  if have_docker_compose_plugin; then
    return 0
  fi

  warn "docker compose 플러그인을 찾지 못했습니다. 설치를 시도합니다."

  install_docker_compose_plugin

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

cleanup_network_if_exists() {
  local network_name="compose_capstone-net"
  if docker_cmd network inspect "$network_name" >/dev/null 2>&1; then
    info "기존 네트워크 정리 중: ${network_name}"
    local containers
    containers="$(docker_cmd network inspect "$network_name" \
      -f '{{range $id, $c := .Containers}}{{println $c.Name}}{{end}}' 2>/dev/null || true)"

    if [[ -n "${containers// /}" ]]; then
      while IFS= read -r container_name; do
        [[ -z "$container_name" ]] && continue
        info " - 네트워크에서 분리: ${container_name}"
        docker_cmd network disconnect "$network_name" "$container_name" >/dev/null 2>&1 || true
      done <<< "$containers"
    fi

    docker_cmd network rm "$network_name" >/dev/null 2>&1 && info "네트워크 제거 완료: ${network_name}"
  fi
}

main() {
  bold "NewsInsight: docker-compose.consul.yml 원클릭 빌드/실행"
  echo

  detect_platform

  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    err "compose 파일을 찾을 수 없습니다: ${COMPOSE_FILE}"
    exit 1
  fi

  info "프로젝트 경로: ${PROJECT_ROOT}"
  info "compose 파일: ${COMPOSE_FILE}"

  ensure_docker_installed
  start_docker_daemon
  ensure_docker_compose
  cleanup_network_if_exists

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
