#!/bin/bash
# =============================================================================
# NewsInsight Docker Build and Push Script
# =============================================================================
# 이 스크립트는 모든 서비스의 Docker 이미지를 빌드하고 
# GCP Artifact Registry에 푸시합니다.
# =============================================================================

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-newsinsight-prod}"
REGION="${GCP_REGION:-asia-northeast3}"
REPO="newsinsight-repo"
TAG="${IMAGE_TAG:-latest}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're logged in to GCP
check_gcp_auth() {
    echo_info "Checking GCP authentication..."
    if ! gcloud auth print-access-token &> /dev/null; then
        echo_error "Not authenticated to GCP. Please run: gcloud auth login"
        exit 1
    fi
    echo_info "GCP authentication OK"
}

# Configure Docker for Artifact Registry
configure_docker() {
    echo_info "Configuring Docker for Artifact Registry..."
    gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
}

# Build and push a single service
build_and_push() {
    local service=$1
    local dockerfile=$2
    local context=$3
    
    echo_info "Building ${service}..."
    
    docker build \
        -t ${REGISTRY}/${service}:${TAG} \
        -t ${REGISTRY}/${service}:latest \
        -f ${dockerfile} \
        ${context}
    
    echo_info "Pushing ${service}..."
    docker push ${REGISTRY}/${service}:${TAG}
    docker push ${REGISTRY}/${service}:latest
    
    echo_info "✅ ${service} done!"
}

# Main build process
main() {
    echo "=============================================="
    echo "  NewsInsight Docker Build & Push"
    echo "=============================================="
    echo "Registry: ${REGISTRY}"
    echo "Tag: ${TAG}"
    echo "=============================================="
    
    check_gcp_auth
    configure_docker
    
    # Change to project root
    cd "$(dirname "$0")/.."
    
    # Build services
    echo_info "Building all services..."
    
    # Frontend
    build_and_push "frontend" \
        "frontend/Dockerfile" \
        "frontend"
    
    # API Gateway
    build_and_push "api-gateway" \
        "backend/api-gateway-service/Dockerfile" \
        "."
    
    # Collector Service
    build_and_push "collector-service" \
        "backend/data-collection-service/Dockerfile" \
        "."
    
    # Browser-Use API
    build_and_push "browser-use-api" \
        "backend/browser-use/Dockerfile.api" \
        "backend/browser-use"
    
    # Autonomous Crawler
    build_and_push "autonomous-crawler" \
        "backend/autonomous-crawler-service/Dockerfile" \
        "."
    
    # ML Addons
    for addon in sentiment factcheck bias; do
        build_and_push "${addon}-addon" \
            "backend/ml-addons/${addon}-addon/Dockerfile" \
            "backend/ml-addons/${addon}-addon"
    done
    
    echo ""
    echo "=============================================="
    echo "  ✅ All images built and pushed!"
    echo "=============================================="
    echo ""
    echo "Images:"
    echo "  - ${REGISTRY}/frontend:${TAG}"
    echo "  - ${REGISTRY}/api-gateway:${TAG}"
    echo "  - ${REGISTRY}/collector-service:${TAG}"
    echo "  - ${REGISTRY}/browser-use-api:${TAG}"
    echo "  - ${REGISTRY}/autonomous-crawler:${TAG}"
    echo "  - ${REGISTRY}/sentiment-addon:${TAG}"
    echo "  - ${REGISTRY}/factcheck-addon:${TAG}"
    echo "  - ${REGISTRY}/bias-addon:${TAG}"
}

# Run main function
main "$@"
