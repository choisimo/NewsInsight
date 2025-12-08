#!/usr/bin/env bash
#
# Consul KV Seed Script
# 
# This script loads configuration from environment-specific files into Consul KV store.
# Supports both .env files and JSON configuration (services.json).
#
# Usage:
#   ./scripts/consul_seed.sh [environment] [--json|--env]
#
# Arguments:
#   environment - Optional. One of: development (default), staging, production
#   --json      - Use JSON config from services.json (service definitions + env-specific settings)
#   --env       - Use .env file (default, legacy behavior)
#   --both      - Load both JSON service config and .env secrets
#
# Environment Variables:
#   CONSUL_HTTP_ADDR  - Consul HTTP API address (default: http://localhost:8500)
#   CONSUL_HTTP_TOKEN - Consul ACL token (optional, for secured Consul)
#   CONFIG_MODE       - Alternative to --json/--env flag: "json", "env", or "both"
#
# Examples:
#   ./scripts/consul_seed.sh development
#   ./scripts/consul_seed.sh production --json
#   ./scripts/consul_seed.sh staging --both
#   CONSUL_HTTP_ADDR=http://consul:8500 ./scripts/consul_seed.sh staging
#   CONFIG_MODE=json ./scripts/consul_seed.sh production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
ENVIRONMENT="development"
CONFIG_MODE="${CONFIG_MODE:-env}"

for arg in "$@"; do
    case "$arg" in
        --json)
            CONFIG_MODE="json"
            ;;
        --env)
            CONFIG_MODE="env"
            ;;
        --both)
            CONFIG_MODE="both"
            ;;
        development|staging|production)
            ENVIRONMENT="$arg"
            ;;
        *)
            if [[ "$arg" != -* ]]; then
                ENVIRONMENT="$arg"
            fi
            ;;
    esac
done

# Configuration
CONSUL_ADDR="${CONSUL_HTTP_ADDR:-http://localhost:8500}"
CONSUL_TOKEN="${CONSUL_HTTP_TOKEN:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ETC_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$ETC_DIR")"
CONFIG_FILE="$ETC_DIR/configs/${ENVIRONMENT}.env"
JSON_CONFIG_FILE="$ETC_DIR/configs/services.json"

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

# Print usage
print_usage() {
    echo "Usage: $0 [environment] [options]"
    echo ""
    echo "Arguments:"
    echo "  environment    One of: development, staging, production (default: development)"
    echo ""
    echo "Options:"
    echo "  --env          Load configuration from .env file (default)"
    echo "  --json         Load configuration from services.json"
    echo "  --both         Load both JSON service config and .env secrets"
    echo "  --help, -h     Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  CONSUL_HTTP_ADDR   Consul HTTP API address (default: http://localhost:8500)"
    echo "  CONSUL_HTTP_TOKEN  Consul ACL token (optional)"
    echo "  CONFIG_MODE        Alternative to flags: 'json', 'env', or 'both'"
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
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        if [[ "$CONFIG_MODE" == "json" || "$CONFIG_MODE" == "both" ]]; then
            log_error "jq is required for JSON config mode. Please install jq."
            exit 1
        else
            log_warning "jq is not installed. Output formatting will be limited."
        fi
    fi
    
    # Check config files based on mode
    if [[ "$CONFIG_MODE" == "env" || "$CONFIG_MODE" == "both" ]]; then
        if [[ ! -f "$CONFIG_FILE" ]]; then
            log_error "Configuration file not found: $CONFIG_FILE"
            log_error "Available environments: development, staging, production"
            exit 1
        fi
    fi
    
    if [[ "$CONFIG_MODE" == "json" || "$CONFIG_MODE" == "both" ]]; then
        if [[ ! -f "$JSON_CONFIG_FILE" ]]; then
            log_error "JSON configuration file not found: $JSON_CONFIG_FILE"
            exit 1
        fi
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
    elif [[ "$key" =~ ^AUTONOMOUS_CRAWLER_ ]]; then
        echo "autonomous-crawler"
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
        "autonomous-crawler")
            echo "${key#AUTONOMOUS_CRAWLER_}"
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

# Load configuration from JSON file (services.json) into Consul
load_json_config() {
    log_info "Loading configuration from $JSON_CONFIG_FILE (environment: $ENVIRONMENT)..."
    echo ""
    
    local total_keys=0
    local successful_keys=0
    local failed_keys=0
    
    # Validate JSON
    if ! jq empty "$JSON_CONFIG_FILE" 2>/dev/null; then
        log_error "Invalid JSON in $JSON_CONFIG_FILE"
        return 1
    fi
    
    # Store entire config version for reference
    local version
    version=$(jq -r '.version' "$JSON_CONFIG_FILE")
    if consul_kv_put "config/version" "$version"; then
        log_success "✓ config/version = $version"
    fi
    
    # -------------------------------------------------------------------------
    # Load Service Configurations
    # -------------------------------------------------------------------------
    log_info "Loading service configurations..."
    
    local services
    services=$(jq -r '.services | keys[]' "$JSON_CONFIG_FILE")
    
    for service in $services; do
        echo -e "${CYAN}=== Service: $service ===${NC}"
        
        # Get service base info
        local port healthcheck
        port=$(jq -r ".services[\"$service\"].port" "$JSON_CONFIG_FILE")
        healthcheck=$(jq -r ".services[\"$service\"].healthcheck" "$JSON_CONFIG_FILE")
        
        # Store service metadata
        consul_kv_put "config/${service}/PORT" "$port" && ((successful_keys++)) || ((failed_keys++))
        ((total_keys++))
        log_success "  ✓ config/${service}/PORT = $port"
        
        consul_kv_put "config/${service}/HEALTHCHECK" "$healthcheck" && ((successful_keys++)) || ((failed_keys++))
        ((total_keys++))
        log_success "  ✓ config/${service}/HEALTHCHECK = $healthcheck"
        
        # Get dependencies
        local dependencies
        dependencies=$(jq -r ".services[\"$service\"].dependencies | join(\",\")" "$JSON_CONFIG_FILE")
        if [[ -n "$dependencies" && "$dependencies" != "null" ]]; then
            consul_kv_put "config/${service}/DEPENDENCIES" "$dependencies" && ((successful_keys++)) || ((failed_keys++))
            ((total_keys++))
            log_success "  ✓ config/${service}/DEPENDENCIES = $dependencies"
        fi
        
        # Get environment-specific settings
        local env_settings
        env_settings=$(jq -r ".services[\"$service\"].profiles[\"$ENVIRONMENT\"] // empty" "$JSON_CONFIG_FILE")
        
        if [[ -n "$env_settings" ]]; then
            # Replicas
            local replicas
            replicas=$(jq -r ".services[\"$service\"].profiles[\"$ENVIRONMENT\"].replicas // 1" "$JSON_CONFIG_FILE")
            consul_kv_put "config/${service}/REPLICAS" "$replicas" && ((successful_keys++)) || ((failed_keys++))
            ((total_keys++))
            log_success "  ✓ config/${service}/REPLICAS = $replicas"
            
            # Resources
            local memory cpu
            memory=$(jq -r ".services[\"$service\"].profiles[\"$ENVIRONMENT\"].resources.memory // \"256Mi\"" "$JSON_CONFIG_FILE")
            cpu=$(jq -r ".services[\"$service\"].profiles[\"$ENVIRONMENT\"].resources.cpu // \"250m\"" "$JSON_CONFIG_FILE")
            consul_kv_put "config/${service}/MEMORY" "$memory" && ((successful_keys++)) || ((failed_keys++))
            consul_kv_put "config/${service}/CPU" "$cpu" && ((successful_keys++)) || ((failed_keys++))
            ((total_keys+=2))
            log_success "  ✓ config/${service}/MEMORY = $memory"
            log_success "  ✓ config/${service}/CPU = $cpu"
            
            # Environment variables from profile
            local env_keys
            env_keys=$(jq -r ".services[\"$service\"].profiles[\"$ENVIRONMENT\"].env // {} | keys[]" "$JSON_CONFIG_FILE" 2>/dev/null || echo "")
            
            for env_key in $env_keys; do
                local env_value
                env_value=$(jq -r ".services[\"$service\"].profiles[\"$ENVIRONMENT\"].env[\"$env_key\"]" "$JSON_CONFIG_FILE")
                consul_kv_put "config/${service}/${env_key}" "$env_value" && ((successful_keys++)) || ((failed_keys++))
                ((total_keys++))
                log_success "  ✓ config/${service}/${env_key} = $env_value"
            done
        fi
        
        echo ""
    done
    
    # -------------------------------------------------------------------------
    # Load ML Addons Configuration
    # -------------------------------------------------------------------------
    log_info "Loading ML addon configurations..."
    
    local addons
    addons=$(jq -r '."ml-addons" // {} | keys[]' "$JSON_CONFIG_FILE" 2>/dev/null || echo "")
    
    for addon in $addons; do
        local enabled port
        enabled=$(jq -r ".\"ml-addons\"[\"$addon\"].enabled[\"$ENVIRONMENT\"] // false" "$JSON_CONFIG_FILE")
        port=$(jq -r ".\"ml-addons\"[\"$addon\"].port" "$JSON_CONFIG_FILE")
        
        consul_kv_put "config/ml-addons/${addon}/ENABLED" "$enabled" && ((successful_keys++)) || ((failed_keys++))
        consul_kv_put "config/ml-addons/${addon}/PORT" "$port" && ((successful_keys++)) || ((failed_keys++))
        ((total_keys+=2))
        
        if [[ "$enabled" == "true" ]]; then
            log_success "✓ config/ml-addons/${addon} (ENABLED, port: $port)"
        else
            log_warning "○ config/ml-addons/${addon} (disabled, port: $port)"
        fi
    done
    
    echo ""
    
    # -------------------------------------------------------------------------
    # Load Infrastructure Configuration
    # -------------------------------------------------------------------------
    log_info "Loading infrastructure configurations..."
    
    local infra_services
    infra_services=$(jq -r '.infrastructure // {} | keys[]' "$JSON_CONFIG_FILE" 2>/dev/null || echo "")
    
    for infra in $infra_services; do
        local image port
        image=$(jq -r ".infrastructure[\"$infra\"].image" "$JSON_CONFIG_FILE")
        port=$(jq -r ".infrastructure[\"$infra\"].port" "$JSON_CONFIG_FILE")
        
        consul_kv_put "config/infrastructure/${infra}/IMAGE" "$image" && ((successful_keys++)) || ((failed_keys++))
        consul_kv_put "config/infrastructure/${infra}/PORT" "$port" && ((successful_keys++)) || ((failed_keys++))
        ((total_keys+=2))
        
        log_success "✓ config/infrastructure/${infra} (image: $image, port: $port)"
    done
    
    echo ""
    log_info "════════════════════════════════════════════════════════════"
    log_info "JSON configuration loading completed"
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

# Load configuration from .env file into Consul
load_env_config() {
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
    log_info ".env configuration loading completed"
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

# Unified load_config function that calls appropriate loader based on mode
load_config() {
    local exit_code=0
    
    case "$CONFIG_MODE" in
        json)
            load_json_config || exit_code=1
            ;;
        env)
            load_env_config || exit_code=1
            ;;
        both)
            log_info "Loading both JSON and .env configurations..."
            echo ""
            load_json_config || exit_code=1
            echo ""
            load_env_config || exit_code=1
            ;;
        *)
            log_error "Unknown config mode: $CONFIG_MODE"
            exit_code=1
            ;;
    esac
    
    return $exit_code
}

# List loaded keys by service
list_loaded_keys() {
    log_info "Listing loaded keys by service..."
    echo ""
    
    # List application services
    local services=("api-gateway" "collector-service" "browser-use-api" "autonomous-crawler" "frontend")
    
    for service in "${services[@]}"; do
        log_info "Service: $service"
        
        local response
        
        # Use curl with error handling - don't fail on 404
        response=$(curl -s "${CONSUL_ADDR}/v1/kv/config/${service}/?keys" 2>/dev/null) || true
        
        if [[ -n "$response" && "$response" != "null" && "$response" != "" ]]; then
            if command -v jq &> /dev/null; then
                echo "$response" | jq -r '.[]' 2>/dev/null | sed 's/^/  - /' || log_warning "  No keys found"
            else
                echo "$response"
            fi
        else
            log_warning "  No keys found for this service"
        fi
        echo ""
    done
    
    # List ML addons if JSON mode was used
    if [[ "$CONFIG_MODE" == "json" || "$CONFIG_MODE" == "both" ]]; then
        log_info "ML Addons:"
        local response
        response=$(curl -s "${CONSUL_ADDR}/v1/kv/config/ml-addons/?keys&recurse" 2>/dev/null) || true
        
        if [[ -n "$response" && "$response" != "null" && "$response" != "" ]]; then
            if command -v jq &> /dev/null; then
                echo "$response" | jq -r '.[]' 2>/dev/null | sed 's/^/  - /' || log_warning "  No keys found"
            else
                echo "$response"
            fi
        else
            log_warning "  No ML addon keys found"
        fi
        echo ""
        
        log_info "Infrastructure:"
        response=$(curl -s "${CONSUL_ADDR}/v1/kv/config/infrastructure/?keys&recurse" 2>/dev/null) || true
        
        if [[ -n "$response" && "$response" != "null" && "$response" != "" ]]; then
            if command -v jq &> /dev/null; then
                echo "$response" | jq -r '.[]' 2>/dev/null | sed 's/^/  - /' || log_warning "  No keys found"
            else
                echo "$response"
            fi
        else
            log_warning "  No infrastructure keys found"
        fi
        echo ""
    fi
}

# Main execution
main() {
    # Handle help flag
    for arg in "$@"; do
        case "$arg" in
            --help|-h)
                print_banner
                print_usage
                exit 0
                ;;
        esac
    done
    
    print_banner
    
    log_info "Environment: $ENVIRONMENT"
    log_info "Config Mode: $CONFIG_MODE"
    log_info "Consul Address: $CONSUL_ADDR"
    
    if [[ "$CONFIG_MODE" == "env" || "$CONFIG_MODE" == "both" ]]; then
        log_info "Env Config File: $CONFIG_FILE"
    fi
    if [[ "$CONFIG_MODE" == "json" || "$CONFIG_MODE" == "both" ]]; then
        log_info "JSON Config File: $JSON_CONFIG_FILE"
    fi
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
main "$@"
