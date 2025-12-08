#!/bin/bash
# =============================================================================
# Cloudflare DNS Setup Script for NewsInsight
# =============================================================================
# 이 스크립트는 newsinsight.nodove.com DNS 레코드를 설정합니다.
#
# 사용법:
#   export CLOUDFLARE_API_TOKEN="your-api-token"
#   export CLOUDFLARE_ZONE_ID="your-zone-id"  # nodove.com의 Zone ID
#   ./setup-cloudflare-dns.sh
# =============================================================================

set -e

# Configuration
DOMAIN="newsinsight.nodove.com"
GCP_IP="34.95.88.123"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
echo_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
echo_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check required environment variables
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo_error "CLOUDFLARE_API_TOKEN is not set"
    echo "Please set it: export CLOUDFLARE_API_TOKEN='your-token'"
    exit 1
fi

# Get Zone ID if not provided
if [ -z "$CLOUDFLARE_ZONE_ID" ]; then
    echo_info "Fetching Zone ID for nodove.com..."
    CLOUDFLARE_ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=nodove.com" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" | jq -r '.result[0].id')
    
    if [ "$CLOUDFLARE_ZONE_ID" == "null" ] || [ -z "$CLOUDFLARE_ZONE_ID" ]; then
        echo_error "Could not find Zone ID for nodove.com"
        exit 1
    fi
    echo_info "Zone ID: $CLOUDFLARE_ZONE_ID"
fi

# Check if record exists
echo_info "Checking existing DNS records..."
EXISTING_RECORD=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?name=${DOMAIN}&type=A" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")

RECORD_ID=$(echo $EXISTING_RECORD | jq -r '.result[0].id // empty')

if [ -n "$RECORD_ID" ]; then
    echo_info "Updating existing A record..."
    RESPONSE=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{
            "type": "A",
            "name": "newsinsight",
            "content": "'${GCP_IP}'",
            "ttl": 1,
            "proxied": false
        }')
else
    echo_info "Creating new A record..."
    RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data '{
            "type": "A",
            "name": "newsinsight",
            "content": "'${GCP_IP}'",
            "ttl": 1,
            "proxied": false
        }')
fi

SUCCESS=$(echo $RESPONSE | jq -r '.success')

if [ "$SUCCESS" == "true" ]; then
    echo_info "✅ DNS record created/updated successfully!"
    echo ""
    echo "  Domain: ${DOMAIN}"
    echo "  Type:   A"
    echo "  Value:  ${GCP_IP}"
    echo "  Proxy:  Off (for GCP managed certificate)"
    echo ""
    echo_warn "Note: SSL certificate will be issued by GCP. Cloudflare proxy is disabled."
else
    echo_error "Failed to create/update DNS record"
    echo $RESPONSE | jq
    exit 1
fi

# Verify DNS propagation
echo_info "Verifying DNS resolution..."
sleep 2
RESOLVED_IP=$(dig +short ${DOMAIN} 2>/dev/null || echo "DNS not yet propagated")
echo "  Resolved IP: ${RESOLVED_IP}"

if [ "$RESOLVED_IP" == "$GCP_IP" ]; then
    echo_info "✅ DNS propagation complete!"
else
    echo_warn "DNS may take a few minutes to propagate globally"
fi
