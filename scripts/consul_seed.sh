#!/usr/bin/env bash
#
# Consul KV Seed Script
# 
# This script loads configuration from environment-specific files into Consul KV store.
# It parses .env files and populates Consul with the appropriate key-value pairs.
#
# Usage:
#   ./scripts/consul_seed.sh [environment]
#
# Arguments:
#   environment - Optional. One of: development (default), staging, production
#
# Environment Variables:
#   CONSUL_HTTP_ADDR - Consul HTTP API address (default: http://localhost:8500)
#   CONSUL_HTTP_TOKEN - Consul ACL token (optional, for secured Consul)
#
# Examples:
#   ./scripts/consul_seed.sh development
#   CONSUL_HTTP_ADDR=http://consul:8500 ./scripts/consul_seed.sh staging
#   CONSUL_HTTP_TOKEN=secret ./scripts/consul_seed.sh production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT="${1:-development}"
CONSUL_ADDR="${CONSUL_HTTP_ADDR:-http://localhost:8500}"
CONSUL_TOKEN="${CONSUL_HTTP_TOKEN:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_ROOT/configs/${ENVIRONMENT}.env"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Print banner
print_banner() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           Consul KV Configuration Seed Script              ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        log_error "curl is not installed. Please install curl to use this script."
        exit 1
    fi
    
    # Check if jq is installed (optional but recommended)
    if ! command -v jq &> /dev/null; then
        log_warning "jq is not installed. Output formatting will be limited."
    fi
    
    # Check if config file exists
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found: $CONFIG_FILE"
        log_error "Available environments: development, staging, production"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Wait for Consul to be ready
wait_for_consul() {
    log_info "Waiting for Consul to be ready at $CONSUL_ADDR..."
    
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -sf "${CONSUL_ADDR}/v1/status/leader" > /dev/null 2>&1; then
            log_success "Consul is ready"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts: Consul not ready yet, waiting..."
        sleep 2
        ((attempt++))
    done
    
    log_error "Consul did not become ready after $max_attempts attempts"
    exit 1
}

# Parse service name from key prefix
get_service_name() {
    local key="$1"
    
    # Extract service name from key prefix (e.g., API_GATEWAY_PORT -> api-gateway)
    if [[ "$key" =~ ^API_GATEWAY_ ]]; then
        echo "api-gateway"
    elif [[ "$key" =~ ^ANALYSIS_SERVICE_ ]]; then
        echo "analysis-service"
    elif [[ "$key" =~ ^COLLECTOR_SERVICE_ ]]; then
        echo "collector-service"
    elif [[ "$key" =~ ^WEB_CRAWLER_ ]]; then
        echo "web-crawler"
    else
        echo ""
    fi
}

# Strip service prefix from key
strip_service_prefix() {
    local key="$1"
    local service="$2"
    
    case "$service" in
        "api-gateway")
            echo "${key#API_GATEWAY_}"
            ;;
        "analysis-service")
            echo "${key#ANALYSIS_SERVICE_}"
            ;;
        "collector-service")
            echo "${key#COLLECTOR_SERVICE_}"
            ;;
        "web-crawler")
            echo "${key#WEB_CRAWLER_}"
            ;;
        *)
            echo "$key"
            ;;
    esac
}

# Put a key-value pair into Consul KV
consul_kv_put() {
    local key="$1"
    local value="$2"
    local headers=(-H "Content-Type: application/json")
    
    # Add ACL token if provided
    if [[ -n "$CONSUL_TOKEN" ]]; then
        headers+=(-H "X-Consul-Token: $CONSUL_TOKEN")
    fi
    
    # URL encode the value for safe transmission
    local encoded_value
    encoded_value=$(printf '%s' "$value" | jq -sRr @uri)
    
    # Make the PUT request
    local response
    response=$(curl -sf -X PUT \
        "${headers[@]}" \
        -d "$value" \
        "${CONSUL_ADDR}/v1/kv/${key}" 2>&1)
    
    if [[ $? -eq 0 ]]; then
        return 0
    else
        log_error "Failed to set key $key: $response"
        return 1
    fi
}

# Load configuration from file into Consul
load_config() {
    log_info "Loading configuration from $CONFIG_FILE..."
    echo ""
    
    local total_keys=0
    local successful_keys=0
    local failed_keys=0
    
    # Read the config file line by line
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        
        # Trim whitespace
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)
        
        # Skip if key is empty after trimming
        [[ -z "$key" ]] && continue
        
        ((total_keys++))
        
        # Get service name from key prefix
        local service
        service=$(get_service_name "$key")
        
        if [[ -z "$service" ]]; then
            log_warning "Skipping key without recognized service prefix: $key"
            continue
        fi
        
        # Strip service prefix from key
        local clean_key
        clean_key=$(strip_service_prefix "$key" "$service")
        
        # Construct Consul KV path: config/{service-name}/{KEY}
        local consul_key="config/${service}/${clean_key}"
        
        # Store in Consul
        if consul_kv_put "$consul_key" "$value"; then
            log_success "✓ $consul_key = $value"
            ((successful_keys++))
        else
            log_error "✗ Failed to set $consul_key"
            ((failed_keys++))
        fi
        
    done < "$CONFIG_FILE"
    
    echo ""
    log_info "════════════════════════════════════════════════════════════"
    log_info "Configuration loading completed"
    log_info "Total keys: $total_keys"
    log_success "Successful: $successful_keys"
    if [[ $failed_keys -gt 0 ]]; then
        log_error "Failed: $failed_keys"
    fi
    log_info "════════════════════════════════════════════════════════════"
    echo ""
    
    if [[ $failed_keys -gt 0 ]]; then
        return 1
    fi
    
    return 0
}

# List loaded keys by service
list_loaded_keys() {
    log_info "Listing loaded keys by service..."
    echo ""
    
    local services=("api-gateway" "analysis-service" "collector-service" "web-crawler")
    
    for service in "${services[@]}"; do
        log_info "Service: $service"
        
        local response
        response=$(curl -sf "${CONSUL_ADDR}/v1/kv/config/${service}/?keys" 2>&1)
        
        if [[ $? -eq 0 ]]; then
            if command -v jq &> /dev/null; then
                echo "$response" | jq -r '.[]' | sed 's/^/  - /'
            else
                echo "$response"
            fi
        else
            log_warning "  No keys found or error accessing Consul"
        fi
        echo ""
    done
}

# Main execution
main() {
    print_banner
    
    log_info "Environment: $ENVIRONMENT"
    log_info "Consul Address: $CONSUL_ADDR"
    log_info "Config File: $CONFIG_FILE"
    echo ""
    
    check_prerequisites
    wait_for_consul
    
    if load_config; then
        log_success "All configurations loaded successfully!"
        echo ""
        list_loaded_keys
        exit 0
    else
        log_error "Some configurations failed to load"
        exit 1
    fi
}

# Run main function
main
