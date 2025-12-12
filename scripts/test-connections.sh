#!/bin/bash
# ============================================================================
# NewsInsight Connection Test Script
# Tests connectivity between all services
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=============================================="
echo "NewsInsight Service Connection Test"
echo "=============================================="
echo ""

# Default URLs (can be overridden by environment variables)
FRONTEND_URL="${FRONTEND_URL:-http://localhost:8080}"
API_GATEWAY_URL="${API_GATEWAY_URL:-http://localhost:8000}"
COLLECTOR_SERVICE_URL="${COLLECTOR_SERVICE_URL:-http://localhost:8081}"
BROWSER_USE_URL="${BROWSER_USE_URL:-http://localhost:8500}"
ADMIN_DASHBOARD_URL="${ADMIN_DASHBOARD_URL:-http://localhost:8888}"
CONSUL_URL="${CONSUL_URL:-http://localhost:8500}"

# Test counter
PASSED=0
FAILED=0

test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    
    printf "Testing %-30s ... " "$name"
    
    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null || echo "000")
    
    if [ "$response" = "$expected_status" ]; then
        echo -e "${GREEN}OK${NC} (HTTP $response)"
        ((PASSED++))
    else
        echo -e "${RED}FAILED${NC} (Expected $expected_status, got $response)"
        ((FAILED++))
    fi
}

echo "1. Infrastructure Services"
echo "-------------------------------------------"
test_endpoint "Consul" "${CONSUL_URL}/v1/status/leader"
echo ""

echo "2. Backend Services"
echo "-------------------------------------------"
test_endpoint "API Gateway Health" "${API_GATEWAY_URL}/actuator/health"
test_endpoint "Collector Service Health" "${COLLECTOR_SERVICE_URL}/actuator/health"
test_endpoint "Browser-Use API" "${BROWSER_USE_URL}/health"
test_endpoint "Admin Dashboard" "${ADMIN_DASHBOARD_URL}/health"
echo ""

echo "3. Frontend"
echo "-------------------------------------------"
test_endpoint "Frontend Health" "${FRONTEND_URL}/health"
echo ""

echo "4. API Gateway Routing (via Frontend Proxy)"
echo "-------------------------------------------"
test_endpoint "Gateway -> Collector (Articles)" "${FRONTEND_URL}/api/v1/articles" "200"
test_endpoint "Gateway -> Collector (Sources)" "${FRONTEND_URL}/api/v1/sources" "200"
test_endpoint "Gateway -> Collector (Search Health)" "${FRONTEND_URL}/api/v1/search/health" "200"
test_endpoint "Gateway -> Browser-Use" "${FRONTEND_URL}/api/browser-use/health" "200"
test_endpoint "Gateway Health Check" "${FRONTEND_URL}/api/actuator/health" "200"
echo ""

echo "5. Consul Service Discovery"
echo "-------------------------------------------"
echo "Registered services:"
curl -s "${CONSUL_URL}/v1/catalog/services" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Failed to fetch services"
echo ""

echo "=============================================="
echo "Test Results: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILED} failed${NC}"
echo "=============================================="

if [ $FAILED -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Troubleshooting Tips:${NC}"
    echo "1. Check if all containers are running: docker-compose ps"
    echo "2. Check container logs: docker-compose logs <service-name>"
    echo "3. Verify network connectivity: docker network inspect newsinsight-prod"
    echo "4. Check Consul registration: curl http://localhost:8500/v1/catalog/services"
    echo ""
    exit 1
fi

exit 0
