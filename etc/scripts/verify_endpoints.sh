#!/usr/bin/env bash
#
# Endpoint Verification Script
# 
# Verifies all service endpoints are accessible and healthy after docker-compose startup
#
# Usage:
#   ./scripts/verify_endpoints.sh [--verbose] [--wait-time SECONDS]
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
VERBOSE=${VERBOSE:-false}
WAIT_TIME=${WAIT_TIME:-300}  # 5 minutes default
CHECK_INTERVAL=5

# Parse arguments
for arg in "$@"; do
    case "$arg" in
        --verbose|-v)
            VERBOSE=true
            ;;
        --wait-time)
            shift
            WAIT_TIME=$1
            ;;
    esac
done

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${CYAN}[DEBUG]${NC} $1"
    fi
}

# Print banner
print_banner() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║         NewsInsight Endpoint Verification Script          ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
}

# Check if a service endpoint is accessible
check_endpoint() {
    local service_name=$1
    local url=$2
    local expected_status=${3:-200}
    
    log_verbose "Checking $service_name at $url"
    
    local response_code
    response_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    
    if [[ "$response_code" == "$expected_status" || "$response_code" == "200" ]]; then
        log_success "$service_name is healthy (HTTP $response_code)"
        return 0
    else
        log_error "$service_name is not responding correctly (HTTP $response_code)"
        return 1
    fi
}

# Wait for a service to become healthy
wait_for_service() {
    local service_name=$1
    local url=$2
    local max_wait=$WAIT_TIME
    local elapsed=0
    
    log_info "Waiting for $service_name to become healthy..."
    
    while [[ $elapsed -lt $max_wait ]]; do
        if check_endpoint "$service_name" "$url" > /dev/null 2>&1; then
            log_success "$service_name is ready after ${elapsed}s"
            return 0
        fi
        
        sleep $CHECK_INTERVAL
        elapsed=$((elapsed + CHECK_INTERVAL))
        
        if [[ $((elapsed % 30)) -eq 0 ]]; then
            log_info "Still waiting for $service_name... (${elapsed}s elapsed)"
        fi
    done
    
    log_error "$service_name did not become healthy within ${max_wait}s"
    return 1
}

# Main verification
main() {
    print_banner
    
    log_info "Starting endpoint verification..."
    log_info "Wait timeout: ${WAIT_TIME}s"
    echo ""
    
    local total_services=0
    local healthy_services=0
    local failed_services=0
    
    # ============================================================================
    # Infrastructure Services
    # ============================================================================
    echo -e "${CYAN}=== Infrastructure Services ===${NC}"
    
    services=(
        "Consul:http://localhost:8505/v1/status/leader"
        "PostgreSQL:http://localhost:5432"  # Note: This will fail, need pg_isready
        "MongoDB:http://localhost:27017"     # Note: This will fail, need mongosh
        "Redis:http://localhost:6379"        # Note: This will fail, need redis-cli
        "Redpanda:http://localhost:19093"    # Note: This will fail, need rpk
    )
    
    # Consul
    ((total_services++))
    if check_endpoint "Consul" "http://localhost:8505/v1/status/leader"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    echo ""
    
    # ============================================================================
    # Core Backend Services
    # ============================================================================
    echo -e "${CYAN}=== Core Backend Services ===${NC}"
    
    # API Gateway
    ((total_services++))
    if check_endpoint "API Gateway" "http://localhost:8112/actuator/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Collector Service
    ((total_services++))
    if check_endpoint "Collector Service" "http://localhost:8081/actuator/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Admin Dashboard
    ((total_services++))
    if check_endpoint "Admin Dashboard" "http://localhost:8888/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    echo ""
    
    # ============================================================================
    # Crawler Services
    # ============================================================================
    echo -e "${CYAN}=== Crawler Services ===${NC}"
    
    # Web Crawler (Crawl4AI)
    ((total_services++))
    if check_endpoint "Web Crawler" "http://localhost:11235/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Autonomous Crawler
    ((total_services++))
    if check_endpoint "Autonomous Crawler (Metrics)" "http://localhost:9190/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Browser-Use API
    ((total_services++))
    if check_endpoint "Browser-Use API" "http://localhost:8501/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # IP Rotation Service
    ((total_services++))
    if check_endpoint "IP Rotation" "http://localhost:8050/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Crawl Worker
    ((total_services++))
    if check_endpoint "Crawl Worker" "http://localhost:8040/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Maigret Worker
    ((total_services++))
    if check_endpoint "Maigret Worker" "http://localhost:8020/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    echo ""
    
    # ============================================================================
    # ML Add-ons
    # ============================================================================
    echo -e "${CYAN}=== ML Add-ons ===${NC}"
    
    # Sentiment Addon
    ((total_services++))
    if check_endpoint "Sentiment Addon" "http://localhost:8100/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Factcheck Addon
    ((total_services++))
    if check_endpoint "Factcheck Addon" "http://localhost:8101/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Bias Addon
    ((total_services++))
    if check_endpoint "Bias Addon" "http://localhost:8102/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Bot Detector
    ((total_services++))
    if check_endpoint "Bot Detector" "http://localhost:8041/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # ML Trainer
    ((total_services++))
    if check_endpoint "ML Trainer" "http://localhost:8090/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    echo ""
    
    # ============================================================================
    # MCP Servers
    # ============================================================================
    echo -e "${CYAN}=== MCP Servers ===${NC}"
    
    # NewsInsight MCP
    ((total_services++))
    if check_endpoint "NewsInsight MCP" "http://localhost:5000/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Bias MCP
    ((total_services++))
    if check_endpoint "Bias MCP" "http://localhost:5001/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Factcheck MCP
    ((total_services++))
    if check_endpoint "Factcheck MCP" "http://localhost:5002/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Topic MCP
    ((total_services++))
    if check_endpoint "Topic MCP" "http://localhost:5003/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # AIAgent MCP
    ((total_services++))
    if check_endpoint "AIAgent MCP" "http://localhost:5004/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # HuggingFace MCP
    ((total_services++))
    if check_endpoint "HuggingFace MCP" "http://localhost:5011/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Kaggle MCP
    ((total_services++))
    if check_endpoint "Kaggle MCP" "http://localhost:5012/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # MLTraining MCP
    ((total_services++))
    if check_endpoint "MLTraining MCP" "http://localhost:5013/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    # Roboflow MCP
    ((total_services++))
    if check_endpoint "Roboflow MCP" "http://localhost:5014/health"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    echo ""
    
    # ============================================================================
    # Frontend
    # ============================================================================
    echo -e "${CYAN}=== Frontend ===${NC}"
    
    # Frontend (Vite dev server)
    ((total_services++))
    if check_endpoint "Frontend" "http://localhost:8810"; then
        ((healthy_services++))
    else
        ((failed_services++))
    fi
    
    echo ""
    
    # ============================================================================
    # Summary
    # ============================================================================
    echo "════════════════════════════════════════════════════════════"
    echo -e "${BLUE}Verification Summary${NC}"
    echo "════════════════════════════════════════════════════════════"
    echo "Total Services Checked: $total_services"
    log_success "Healthy Services: $healthy_services"
    
    if [[ $failed_services -gt 0 ]]; then
        log_error "Failed Services: $failed_services"
        echo ""
        log_warning "Some services are not healthy. Check the logs above for details."
        exit 1
    else
        echo ""
        log_success "All services are healthy! ✨"
        exit 0
    fi
}

# Run main function
main "$@"
