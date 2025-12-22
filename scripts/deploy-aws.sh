#!/bin/bash
# =============================================================================
# NewsInsight - AWS Full Deployment Script
# =============================================================================
set -e

# Configuration
PROJECT_NAME="newsinsight"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
ENV_NAME="${ENV_NAME:-dev}"
TAG="${TAG:-latest}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CDK_DIR="${PROJECT_ROOT}/aws/cdk"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}NewsInsight AWS Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Environment: ${GREEN}${ENV_NAME}${NC}"
echo -e "AWS Region:  ${GREEN}${AWS_REGION}${NC}"
echo -e "Tag:         ${GREEN}${TAG}${NC}"
echo ""

# Check prerequisites
check_prerequisites() {
  echo -e "${YELLOW}Checking prerequisites...${NC}"
  
  # Check AWS CLI
  if ! command -v aws &> /dev/null; then
    echo -e "${RED}AWS CLI not found. Please install it first.${NC}"
    exit 1
  fi
  
  # Check CDK
  if ! command -v cdk &> /dev/null; then
    echo -e "${RED}AWS CDK not found. Installing...${NC}"
    npm install -g aws-cdk
  fi
  
  # Check Docker
  if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not found. Please install it first.${NC}"
    exit 1
  fi
  
  # Check AWS credentials
  if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}AWS credentials not configured. Please run 'aws configure' first.${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}All prerequisites met.${NC}"
}

# Install CDK dependencies
install_cdk_deps() {
  echo -e "${YELLOW}Installing CDK dependencies...${NC}"
  cd "${CDK_DIR}"
  npm install
  echo -e "${GREEN}CDK dependencies installed.${NC}"
}

# Bootstrap CDK (first time only)
bootstrap_cdk() {
  echo -e "${YELLOW}Bootstrapping CDK...${NC}"
  
  AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
  
  cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION} \
    --toolkit-stack-name CDKToolkit \
    --tags Project=${PROJECT_NAME} \
    --tags Environment=${ENV_NAME}
  
  echo -e "${GREEN}CDK bootstrap complete.${NC}"
}

# Deploy infrastructure with CDK
deploy_infrastructure() {
  echo -e "${YELLOW}Deploying infrastructure with CDK...${NC}"
  
  cd "${CDK_DIR}"
  
  # Synthesize first
  cdk synth -c env=${ENV_NAME}
  
  # Deploy all stacks
  cdk deploy --all \
    -c env=${ENV_NAME} \
    --require-approval never \
    --outputs-file "${PROJECT_ROOT}/aws/cdk-outputs.json"
  
  echo -e "${GREEN}Infrastructure deployment complete.${NC}"
}

# Build and push Docker images
build_and_push_images() {
  echo -e "${YELLOW}Building and pushing Docker images...${NC}"
  
  cd "${PROJECT_ROOT}"
  
  # Run the ECR build script
  ./scripts/build-ecr.sh --tag ${TAG}
  
  echo -e "${GREEN}Docker images pushed to ECR.${NC}"
}

# Update ECS services to use new images
update_ecs_services() {
  echo -e "${YELLOW}Updating ECS services...${NC}"
  
  CLUSTER_NAME="${PROJECT_NAME}-cluster-${ENV_NAME}"
  
  # Get all services in the cluster
  SERVICES=$(aws ecs list-services \
    --cluster ${CLUSTER_NAME} \
    --query 'serviceArns[]' \
    --output text \
    --region ${AWS_REGION})
  
  for SERVICE_ARN in ${SERVICES}; do
    SERVICE_NAME=$(echo ${SERVICE_ARN} | awk -F'/' '{print $NF}')
    
    echo -e "${BLUE}Updating service: ${SERVICE_NAME}${NC}"
    
    aws ecs update-service \
      --cluster ${CLUSTER_NAME} \
      --service ${SERVICE_NAME} \
      --force-new-deployment \
      --region ${AWS_REGION} \
      > /dev/null
    
    echo -e "${GREEN}Service ${SERVICE_NAME} update triggered.${NC}"
  done
  
  echo -e "${GREEN}All ECS services updated.${NC}"
}

# Wait for services to stabilize
wait_for_services() {
  echo -e "${YELLOW}Waiting for services to stabilize...${NC}"
  
  CLUSTER_NAME="${PROJECT_NAME}-cluster-${ENV_NAME}"
  
  # Get all services
  SERVICES=$(aws ecs list-services \
    --cluster ${CLUSTER_NAME} \
    --query 'serviceArns[]' \
    --output text \
    --region ${AWS_REGION})
  
  # Wait for each service
  for SERVICE_ARN in ${SERVICES}; do
    SERVICE_NAME=$(echo ${SERVICE_ARN} | awk -F'/' '{print $NF}')
    
    echo -e "${BLUE}Waiting for ${SERVICE_NAME}...${NC}"
    
    aws ecs wait services-stable \
      --cluster ${CLUSTER_NAME} \
      --services ${SERVICE_NAME} \
      --region ${AWS_REGION}
    
    echo -e "${GREEN}${SERVICE_NAME} is stable.${NC}"
  done
  
  echo -e "${GREEN}All services are stable.${NC}"
}

# Get deployment outputs
get_outputs() {
  echo -e "${YELLOW}Deployment Outputs:${NC}"
  echo ""
  
  if [ -f "${PROJECT_ROOT}/aws/cdk-outputs.json" ]; then
    cat "${PROJECT_ROOT}/aws/cdk-outputs.json"
  fi
  
  # Get ALB DNS name
  ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name "${PROJECT_NAME}-alb-${ENV_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
    --output text \
    --region ${AWS_REGION} 2>/dev/null || echo "Not found")
  
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}Deployment Complete!${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "Application URL: ${BLUE}https://${ALB_DNS}${NC}"
  echo ""
}

# Show help
show_help() {
  echo "Usage: $0 [command] [options]"
  echo ""
  echo "Commands:"
  echo "  all           Run full deployment (default)"
  echo "  bootstrap     Bootstrap CDK (first time only)"
  echo "  infra         Deploy infrastructure only"
  echo "  images        Build and push Docker images only"
  echo "  update        Update ECS services only"
  echo "  status        Show deployment status"
  echo ""
  echo "Options:"
  echo "  --env, -e     Environment name (dev, staging, prod)"
  echo "  --tag, -t     Docker image tag"
  echo "  --region, -r  AWS region"
  echo "  --help, -h    Show this help"
}

# Main execution
main() {
  local command="${1:-all}"
  shift || true
  
  # Parse options
  while [[ $# -gt 0 ]]; do
    case $1 in
      --env|-e)
        ENV_NAME="$2"
        shift 2
        ;;
      --tag|-t)
        TAG="$2"
        shift 2
        ;;
      --region|-r)
        AWS_REGION="$2"
        shift 2
        ;;
      --help|-h)
        show_help
        exit 0
        ;;
      *)
        echo "Unknown option: $1"
        show_help
        exit 1
        ;;
    esac
  done
  
  case $command in
    all)
      check_prerequisites
      install_cdk_deps
      deploy_infrastructure
      build_and_push_images
      update_ecs_services
      wait_for_services
      get_outputs
      ;;
    bootstrap)
      check_prerequisites
      install_cdk_deps
      bootstrap_cdk
      ;;
    infra)
      check_prerequisites
      install_cdk_deps
      deploy_infrastructure
      get_outputs
      ;;
    images)
      check_prerequisites
      build_and_push_images
      ;;
    update)
      check_prerequisites
      update_ecs_services
      wait_for_services
      ;;
    status)
      get_outputs
      ;;
    help)
      show_help
      ;;
    *)
      echo -e "${RED}Unknown command: ${command}${NC}"
      show_help
      exit 1
      ;;
  esac
}

# Run main
main "$@"
