#!/usr/bin/env bash
# =============================================================================
# NewsInsight Local Artifacts Clean Script
# =============================================================================
# 이 스크립트는 NewsInsight 리포지토리 내의 로컬 빌드 아티팩트와 캐시를 정리합니다.
# - Docker 리소스는 건드리지 않습니다 (Docker 정리는 clean-docker.sh 사용)
#
# 정리 대상:
#   - frontend: node_modules, dist
#   - backend: 각 서비스의 build 디렉터리 (Gradle 출력물)
#   - backend/admin-dashboard/web: node_modules, .next
#   - backend/browser-use: __pycache__, .venv
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==== NewsInsight Local Artifacts Clean Preview ===="
cat <<EOF
이 스크립트는 다음과 같은 경로를 삭제합니다 (존재하는 경우에만):

  Frontend:
    - frontend/node_modules
    - frontend/dist

  Backend (Gradle):
    - backend/*/build (api-gateway, data-collection, shared-libs 등)
  
  Backend (Python):
    - backend/**/__pycache__
    
  Admin Dashboard:
    - backend/admin-dashboard/web/node_modules
    - backend/admin-dashboard/web/.next
EOF

echo
read -rp "계속 진행할까요? [y/N]: " CONFIRM
CONFIRM=${CONFIRM:-N}
if [[ ! "${CONFIRM}" =~ ^[Yy]$ ]]; then
  echo "중단되었습니다."
  exit 0
fi

echo
echo "==== frontend 빌드 아티팩트 제거 ===="
if [[ -d "${PROJECT_ROOT}/frontend/node_modules" ]]; then
  echo "  삭제: frontend/node_modules"
  rm -rf "${PROJECT_ROOT}/frontend/node_modules"
fi
if [[ -d "${PROJECT_ROOT}/frontend/dist" ]]; then
  echo "  삭제: frontend/dist"
  rm -rf "${PROJECT_ROOT}/frontend/dist"
fi

echo
echo "==== backend Gradle build 디렉터리 제거 ===="
for service_dir in "${PROJECT_ROOT}"/backend/*/; do
  build_dir="${service_dir}build"
  if [[ -d "${build_dir}" ]]; then
    echo "  삭제: ${build_dir#${PROJECT_ROOT}/}"
    rm -rf "${build_dir}"
  fi
done

# shared-libs도 확인
if [[ -d "${PROJECT_ROOT}/backend/shared-libs/build" ]]; then
  echo "  삭제: backend/shared-libs/build"
  rm -rf "${PROJECT_ROOT}/backend/shared-libs/build"
fi

echo
echo "==== backend Python __pycache__ 제거 ===="
find "${PROJECT_ROOT}/backend" -type d -name "__pycache__" -prune -print -exec rm -rf {} + 2>/dev/null || true

echo
echo "==== admin-dashboard web 아티팩트 제거 ===="
if [[ -d "${PROJECT_ROOT}/backend/admin-dashboard/web/node_modules" ]]; then
  echo "  삭제: backend/admin-dashboard/web/node_modules"
  rm -rf "${PROJECT_ROOT}/backend/admin-dashboard/web/node_modules"
fi
if [[ -d "${PROJECT_ROOT}/backend/admin-dashboard/web/.next" ]]; then
  echo "  삭제: backend/admin-dashboard/web/.next"
  rm -rf "${PROJECT_ROOT}/backend/admin-dashboard/web/.next"
fi

echo
echo "로컬 빌드/캐시 아티팩트 정리가 완료되었습니다."
