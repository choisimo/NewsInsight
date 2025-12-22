#!/bin/bash
# =============================================================================
# NewsInsight - Build and Push Docker Images to AWS ECR
# =============================================================================
set -e

# Configuration
PROJECT_NAME="newsinsight"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
TAG="${TAG:-latest}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Service definitions: name:dockerfile_path:context_path
SERVICES=(
  "frontend:frontend/Dockerfile:."
  "api-gateway:backend/api-gateway-service/Dockerfile:."
  "collector-service:backend/data-collection-service/Dockerfile:."
  "autonomous-crawler:backend/autonomous-crawler-service/Dockerfile:."
  "browser-use-api:backend/services/browser-use-api/Dockerfile.api:backend/services/browser-use-api"
  "admin-dashboard:backend/admin-dashboard/Dockerfile:backend/admin-dashboard"
  "bot-detector:backend/services/bot-detector/Dockerfile:."
  "ip-rotation:backend/services/ip-rotation/Dockerfile:backend/services/ip-rotation"
  "crawl-worker:backend/autonomous-crawler-service/crawl-worker/Dockerfile:."
  "maigret-worker:backend/data-collection-service/maigret-worker/Dockerfile:."
  "sentiment-addon:backend/ml-addons/sentiment-addon/Dockerfile:backend/ml-addons/sentiment-addon"
  "factcheck-addon:backend/ml-addons/factcheck-addon/Dockerfile:backend/ml-addons/factcheck-addon"
  "bias-addon:backend/ml-addons/bias-addon/Dockerfile:backend/ml-addons/bias-addon"
  "ml-trainer:backend/ml-addons/ml-trainer/Dockerfile:backend/ml-addons/ml-trainer"
  "newsinsight-mcp:mcp/newsinsight_mcp/Dockerfile:mcp"
  "bias-mcp:mcp/bias_mcp/Dockerfile:mcp"
  "factcheck-mcp:mcp/factcheck_mcp/Dockerfile:mcp"
  "topic-mcp:mcp/topic_mcp/Dockerfile:mcp"
  "aiagent-mcp:mcp/aiagent_mcp/Dockerfile:mcp"
  "huggingface-mcp:mcp/huggingface_mcp/Dockerfile:mcp"
  "kaggle-mcp:mcp/kaggle_mcp/Dockerfile:mcp"
  "mltraining-mcp:mcp/mltraining_mcp/Dockerfile:mcp"
  "roboflow-mcp:mcp/roboflow_mcp/Dockerfile:mcp"
)

# Parse arguments
BUILD_ALL=true
SPECIFIC_SERVICE=""
PUSH_ONLY=false
BUILD_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --service|-s)
      SPECIFIC_SERVICE="$2"
      BUILD_ALL=false
      shift 2
      ;;
    --push-only)
      PUSH_ONLY=true
      shift
      ;;
    --build-only)
      BUILD_ONLY=true
      shift
      ;;
    --tag|-t)
      TAG="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --service, -s    Build specific service"
      echo "  --push-only      Only push (skip build)"
      echo "  --build-only     Only build (skip push)"
      echo "  --tag, -t        Docker image tag (default: latest)"
      echo "  --help, -h       Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Print configuration
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}NewsInsight ECR Build & Push${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "AWS Account: ${GREEN}${AWS_ACCOUNT_ID}${NC}"
echo -e "AWS Region:  ${GREEN}${AWS_REGION}${NC}"
echo -e "ECR Registry: ${GREEN}${ECR_REGISTRY}${NC}"
echo -e "Tag: ${GREEN}${TAG}${NC}"
echo ""

# Login to ECR
echo -e "${YELLOW}Logging into ECR...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}
echo -e "${GREEN}ECR login successful${NC}"
echo ""

# Function to build and push a service
build_and_push() {
  local service_def=$1
  IFS=':' read -r service_name dockerfile context <<< "$service_def"
  
  local image_name="${PROJECT_NAME}/${service_name}"
  local ecr_image="${ECR_REGISTRY}/${image_name}:${TAG}"
  
  echo -e "${BLUE}----------------------------------------${NC}"
  echo -e "${BLUE}Processing: ${service_name}${NC}"
  echo -e "${BLUE}----------------------------------------${NC}"
  
  # Ensure ECR repository exists
  aws ecr describe-repositories --repository-names "${image_name}" --region ${AWS_REGION} 2>/dev/null || \
    aws ecr create-repository --repository-name "${image_name}" --region ${AWS_REGION} --image-scanning-configuration scanOnPush=true
  
  if [ "$PUSH_ONLY" = false ]; then
    echo -e "${YELLOW}Building ${service_name}...${NC}"
    
    # Build
    docker build \
      -t "${image_name}:${TAG}" \
      -t "${ecr_image}" \
      -f "${dockerfile}" \
      "${context}"
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}Build successful: ${service_name}${NC}"
    else
      echo -e "${RED}Build failed: ${service_name}${NC}"
      return 1
    fi
  fi
  
  if [ "$BUILD_ONLY" = false ]; then
    echo -e "${YELLOW}Pushing ${service_name} to ECR...${NC}"
    
    # Push
    docker push "${ecr_image}"
    
    if [ $? -eq 0 ]; then
      echo -e "${GREEN}Push successful: ${ecr_image}${NC}"
    else
      echo -e "${RED}Push failed: ${service_name}${NC}"
      return 1
    fi
  fi
  
  echo ""
}

# Build and push services
cd "$(dirname "$0")/../.."

if [ "$BUILD_ALL" = true ]; then
  echo -e "${YELLOW}Building all services...${NC}"
  echo ""
  
  for service_def in "${SERVICES[@]}"; do
    build_and_push "$service_def"
  done
else
  # Build specific service
  found=false
  for service_def in "${SERVICES[@]}"; do
    IFS=':' read -r name _ _ <<< "$service_def"
    if [ "$name" = "$SPECIFIC_SERVICE" ]; then
      build_and_push "$service_def"
      found=true
      break
    fi
  done
  
  if [ "$found" = false ]; then
    echo -e "${RED}Service not found: ${SPECIFIC_SERVICE}${NC}"
    echo "Available services:"
    for service_def in "${SERVICES[@]}"; do
      IFS=':' read -r name _ _ <<< "$service_def"
      echo "  - $name"
    done
    exit 1
  fi
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Build and Push Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
