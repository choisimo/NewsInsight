#!/bin/bash
#
# Cloudflare Tunnel Endpoint Consistency Test Script
# Tests all NewsInsight API endpoints through Cloudflare Tunnel
#
# Usage: ./test-cloudflare-endpoints.sh [iterations] [delay]
#   iterations: Number of times to test each endpoint (default: 5)
#   delay: Delay between requests in seconds (default: 1)
#
# Example: ./test-cloudflare-endpoints.sh 10 0.5

set -e

# Configuration
BASE_URL="${BASE_URL:-https://news.nodove.com}"
ITERATIONS="${1:-5}"
DELAY="${2:-1}"
TIMEOUT=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TOTAL_REQUESTS=0
SUCCESSFUL_REQUESTS=0
FAILED_REQUESTS=0

# Results storage
declare -A ENDPOINT_SUCCESS
declare -A ENDPOINT_FAIL

print_header() {
    echo ""
    echo "=============================================="
    echo -e "${BLUE}NewsInsight Cloudflare Tunnel Endpoint Test${NC}"
    echo "=============================================="
    echo "Base URL: $BASE_URL"
    echo "Iterations per endpoint: $ITERATIONS"
    echo "Delay between requests: ${DELAY}s"
    echo "Timeout: ${TIMEOUT}s"
    echo "=============================================="
    echo ""
}

test_endpoint() {
    local method="$1"
    local path="$2"
    local name="$3"
    local expected_codes="${4:-200,201}"
    local data="$5"
    
    local url="${BASE_URL}${path}"
    local success=0
    local fail=0
    local status_codes=""
    
    echo -e "${BLUE}Testing:${NC} [$method] $name"
    echo "  URL: $url"
    
    for ((i=1; i<=ITERATIONS; i++)); do
        local curl_opts="-s -o /dev/null -w '%{http_code}' --connect-timeout $TIMEOUT -X $method"
        
        if [ -n "$data" ]; then
            curl_opts="$curl_opts -H 'Content-Type: application/json' -d '$data'"
        fi
        
        local http_code
        http_code=$(eval "curl $curl_opts '$url'" 2>/dev/null || echo "000")
        
        status_codes="$status_codes $http_code"
        
        # Check if status code is in expected codes
        if [[ ",$expected_codes," == *",$http_code,"* ]]; then
            ((success++))
            ((SUCCESSFUL_REQUESTS++))
        else
            ((fail++))
            ((FAILED_REQUESTS++))
        fi
        
        ((TOTAL_REQUESTS++))
        sleep "$DELAY"
    done
    
    ENDPOINT_SUCCESS["$name"]=$success
    ENDPOINT_FAIL["$name"]=$fail
    
    local rate=$((success * 100 / ITERATIONS))
    local color=$GREEN
    if [ $rate -lt 100 ] && [ $rate -ge 70 ]; then
        color=$YELLOW
    elif [ $rate -lt 70 ]; then
        color=$RED
    fi
    
    echo -e "  Results: ${color}${success}/${ITERATIONS} (${rate}%)${NC}"
    echo "  Status codes:$status_codes"
    echo ""
}

test_health_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Health Check Endpoints ===${NC}"
    echo ""
    
    # Frontend health (serves index.html)
    test_endpoint "GET" "/" "Frontend Root" "200"
    
    # API Gateway actuator
    test_endpoint "GET" "/actuator/health" "API Gateway Health" "200"
    
    # Browser-Use API health
    test_endpoint "GET" "/api/browser-use/health" "Browser-Use Health" "200"
}

test_data_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Data Collection Endpoints ===${NC}"
    echo ""
    
    # DataController
    test_endpoint "GET" "/api/v1/data" "Get All Data" "200"
    test_endpoint "GET" "/api/v1/data/stats" "Get Data Stats" "200"
    test_endpoint "GET" "/api/v1/data/unprocessed" "Get Unprocessed Data" "200"
}

test_source_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Source Management Endpoints ===${NC}"
    echo ""
    
    # SourceController
    test_endpoint "GET" "/api/v1/sources" "Get All Sources" "200"
    test_endpoint "GET" "/api/v1/sources/active" "Get Active Sources" "200"
}

test_collection_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Collection Job Endpoints ===${NC}"
    echo ""
    
    # CollectionController
    test_endpoint "GET" "/api/v1/collections/jobs" "Get Collection Jobs" "200"
    test_endpoint "GET" "/api/v1/collections/stats" "Get Collection Stats" "200"
}

test_search_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Search Endpoints ===${NC}"
    echo ""
    
    # UnifiedSearchController - GET endpoints
    test_endpoint "GET" "/api/v1/search/jobs" "Get Search Jobs" "200"
    
    # SearchHistoryController
    test_endpoint "GET" "/api/v1/search-history" "Get Search History" "200"
    test_endpoint "GET" "/api/v1/search-history/recent" "Get Recent Searches" "200"
    test_endpoint "GET" "/api/v1/search-history/bookmarked" "Get Bookmarked Searches" "200"
    test_endpoint "GET" "/api/v1/search-history/tags" "Get Search Tags" "200"
}

test_analysis_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Analysis Endpoints ===${NC}"
    echo ""
    
    # AnalysisController
    test_endpoint "GET" "/api/v1/articles" "Get Articles" "200"
    
    # Note: POST endpoints require valid data, testing only availability
    # Deep analysis and live analysis are typically POST-only
}

test_browser_use_endpoints() {
    echo ""
    echo -e "${YELLOW}=== Browser-Use API Endpoints ===${NC}"
    echo ""
    
    # Browser-Use API
    test_endpoint "GET" "/api/browser-use/health" "Browser-Use Health" "200"
    test_endpoint "GET" "/api/browser-use/jobs" "Browser-Use Jobs" "200"
}

print_summary() {
    echo ""
    echo "=============================================="
    echo -e "${BLUE}TEST SUMMARY${NC}"
    echo "=============================================="
    echo ""
    
    local overall_rate=$((SUCCESSFUL_REQUESTS * 100 / TOTAL_REQUESTS))
    local color=$GREEN
    if [ $overall_rate -lt 100 ] && [ $overall_rate -ge 70 ]; then
        color=$YELLOW
    elif [ $overall_rate -lt 70 ]; then
        color=$RED
    fi
    
    echo "Total Requests: $TOTAL_REQUESTS"
    echo -e "Successful: ${GREEN}$SUCCESSFUL_REQUESTS${NC}"
    echo -e "Failed: ${RED}$FAILED_REQUESTS${NC}"
    echo -e "Overall Success Rate: ${color}${overall_rate}%${NC}"
    echo ""
    
    echo "--- Per-Endpoint Results ---"
    for endpoint in "${!ENDPOINT_SUCCESS[@]}"; do
        local success=${ENDPOINT_SUCCESS[$endpoint]}
        local fail=${ENDPOINT_FAIL[$endpoint]}
        local total=$((success + fail))
        local rate=$((success * 100 / total))
        
        local color=$GREEN
        if [ $rate -lt 100 ] && [ $rate -ge 70 ]; then
            color=$YELLOW
        elif [ $rate -lt 70 ]; then
            color=$RED
        fi
        
        printf "  %-30s ${color}%3d%%${NC} (%d/%d)\n" "$endpoint" "$rate" "$success" "$total"
    done | sort
    
    echo ""
    echo "=============================================="
    
    # Exit code based on success rate
    if [ $overall_rate -lt 70 ]; then
        echo -e "${RED}CRITICAL: Success rate below 70%${NC}"
        echo "Check Cloudflare Tunnel status and container health."
        exit 2
    elif [ $overall_rate -lt 100 ]; then
        echo -e "${YELLOW}WARNING: Some requests failed${NC}"
        echo "May indicate Cloudflare edge propagation delay or intermittent issues."
        exit 1
    else
        echo -e "${GREEN}SUCCESS: All endpoints responding correctly${NC}"
        exit 0
    fi
}

# Internal vs External comparison test
compare_internal_external() {
    echo ""
    echo "=============================================="
    echo -e "${BLUE}Internal vs External Comparison${NC}"
    echo "=============================================="
    echo ""
    echo "Testing same endpoints from inside Docker network..."
    echo "(Run this section from a container in the same network)"
    echo ""
    
    cat << 'INTERNAL_TEST'
# Run these commands from inside a container:

# Direct to frontend (internal)
curl -s -o /dev/null -w "%{http_code}" http://frontend:5173/

# Direct to API Gateway (internal)
curl -s -o /dev/null -w "%{http_code}" http://api-gateway:8000/actuator/health

# Direct to Browser-Use (internal)
curl -s -o /dev/null -w "%{http_code}" http://browser-use-api:8000/health

# Compare with external (through Cloudflare)
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/actuator/health
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/api/browser-use/health
INTERNAL_TEST
}

# Quick health check mode
quick_check() {
    echo ""
    echo -e "${BLUE}Quick Health Check (3 critical endpoints)${NC}"
    echo ""
    
    local endpoints=(
        "GET:/:Frontend"
        "GET:/actuator/health:API Gateway"
        "GET:/api/browser-use/health:Browser-Use"
    )
    
    for entry in "${endpoints[@]}"; do
        IFS=':' read -r method path name <<< "$entry"
        local url="${BASE_URL}${path}"
        local http_code
        http_code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 -X "$method" "$url" 2>/dev/null || echo "000")
        
        if [ "$http_code" = "200" ]; then
            echo -e "  ${GREEN}[OK]${NC} $name ($http_code)"
        else
            echo -e "  ${RED}[FAIL]${NC} $name ($http_code)"
        fi
    done
    echo ""
}

# Main execution
main() {
    case "${1:-full}" in
        quick|-q)
            quick_check
            ;;
        compare|-c)
            compare_internal_external
            ;;
        full|*)
            print_header
            test_health_endpoints
            test_data_endpoints
            test_source_endpoints
            test_collection_endpoints
            test_search_endpoints
            test_analysis_endpoints
            test_browser_use_endpoints
            print_summary
            ;;
    esac
}

# Handle arguments
if [[ "$1" == "quick" ]] || [[ "$1" == "-q" ]] || [[ "$1" == "compare" ]] || [[ "$1" == "-c" ]]; then
    main "$1"
else
    main "full"
fi
