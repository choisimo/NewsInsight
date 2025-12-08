# Cloudflare Tunnel Operations Checklist

This document provides operational procedures for managing the NewsInsight Cloudflare Tunnel deployment.

## Quick Reference

| Item | Value |
|------|-------|
| Tunnel ID | `ed317942-3e87-4b0e-a3c2-3df106d4c0f4` |
| Account ID | `f6f11e2a4e5178d2f37476785018f761` |
| Public URL | `https://news.nodove.com` |
| Compose File | `etc/docker/docker-compose.zerotrust.yml` |
| Project Name | `newsinsight` |

---

## Pre-Deployment Checklist

### 1. Environment Verification

```bash
# Verify no conflicting cloudflared containers are running
docker ps -a | grep cloudflared

# If found in other projects, stop them first
# Example: Stop Capstone cloudflared
docker stop capstone-cloudflared-tunnel-1 2>/dev/null || true
docker rm capstone-cloudflared-tunnel-1 2>/dev/null || true
```

### 2. Token Verification

```bash
# Ensure .env file exists with valid token
cat etc/docker/.env | grep CLOUDFLARE_TUNNEL_TOKEN

# CRITICAL: Never use the same token in multiple compose projects
# Check for duplicate usage:
grep -r "CLOUDFLARE_TUNNEL_TOKEN" ~/workspace/*/docker/.env 2>/dev/null
grep -r "CLOUDFLARE_TUNNEL_TOKEN" ~/workspace/*/.env 2>/dev/null
```

### 3. Network Verification

```bash
# Ensure the shared network exists
docker network ls | grep news-network

# If not, create it
docker network create news-network
```

---

## Deployment Procedure

### Standard Deployment

```bash
cd /home/nodove/workspace/NewsInsight/etc/docker

# Always use explicit project name to avoid conflicts
docker compose -p newsinsight -f docker-compose.zerotrust.yml up -d
```

### First-Time or Clean Deployment

```bash
cd /home/nodove/workspace/NewsInsight/etc/docker

# Stop any existing containers
docker compose -p newsinsight -f docker-compose.zerotrust.yml down

# Remove old cloudflared container if stuck
docker rm -f cloudflared-tunnel 2>/dev/null || true

# Start fresh
docker compose -p newsinsight -f docker-compose.zerotrust.yml up -d

# Wait for Cloudflare edge propagation
echo "Waiting 60 seconds for edge propagation..."
sleep 60

# Verify
../scripts/test-cloudflare-endpoints.sh quick
```

---

## Post-Deployment Verification

### Quick Health Check

```bash
# Run quick test (3 critical endpoints)
./etc/scripts/test-cloudflare-endpoints.sh quick
```

Expected output:
```
Quick Health Check (3 critical endpoints)

  [OK] Frontend (200)
  [OK] API Gateway (200)
  [OK] Browser-Use (200)
```

### Full Endpoint Test

```bash
# Run comprehensive test
./etc/scripts/test-cloudflare-endpoints.sh 5 1
```

### Manual Verification

```bash
# Frontend
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/

# API Gateway Health
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/actuator/health

# Browser-Use Health
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/api/browser-use/health

# Data API
curl -s -o /dev/null -w "%{http_code}" https://news.nodove.com/api/v1/data
```

---

## Troubleshooting

### 502 Bad Gateway Errors

#### Symptom: Intermittent 502 errors (30-50%)

**Likely Cause**: Multiple cloudflared containers using the same tunnel token

**Diagnosis**:
```bash
# Check for multiple cloudflared processes
docker ps -a | grep cloudflared

# Check Cloudflare dashboard for multiple connectors
# Dashboard: https://one.dash.cloudflare.com/
# Navigate: Zero Trust > Access > Tunnels > [Your Tunnel] > Connectors
```

**Resolution**:
```bash
# Stop all cloudflared containers
docker stop $(docker ps -q --filter "name=cloudflared") 2>/dev/null

# Remove them
docker rm $(docker ps -aq --filter "name=cloudflared") 2>/dev/null

# Restart only the NewsInsight tunnel
cd /home/nodove/workspace/NewsInsight/etc/docker
docker compose -p newsinsight -f docker-compose.zerotrust.yml up -d cloudflared-tunnel
```

#### Symptom: Consistent 502 errors

**Likely Cause**: Target service not running or misconfigured

**Diagnosis**:
```bash
# Check service status
docker compose -p newsinsight -f docker-compose.zerotrust.yml ps

# Check cloudflared logs
docker logs cloudflared-tunnel --tail 50

# Test internal connectivity (from within network)
docker exec cloudflared-tunnel wget -qO- http://frontend:5173/ || echo "Frontend unreachable"
docker exec cloudflared-tunnel wget -qO- http://api-gateway:8000/actuator/health || echo "API Gateway unreachable"
```

**Resolution**:
```bash
# Restart affected service
docker compose -p newsinsight -f docker-compose.zerotrust.yml restart frontend
docker compose -p newsinsight -f docker-compose.zerotrust.yml restart api-gateway
```

### QUIC/UDP Issues

#### Symptom: Connection timeouts, "failed to dial" errors in logs

**Likely Cause**: UDP buffer size limitations or firewall blocking QUIC

**Diagnosis**:
```bash
docker logs cloudflared-tunnel 2>&1 | grep -i "quic\|udp\|buffer"
```

**Resolution**: Switch to HTTP/2 protocol
```yaml
# In docker-compose.zerotrust.yml, update cloudflared command:
command: tunnel --protocol http2 run
```

### DNS Resolution Issues

#### Symptom: "DNS resolution failed" or unable to reach news.nodove.com

**Diagnosis**:
```bash
# Check DNS resolution
nslookup news.nodove.com
dig news.nodove.com

# Expected: Should resolve to Cloudflare IPs
```

**Resolution**:
- Verify DNS record exists in Cloudflare dashboard
- Check if tunnel is creating the DNS record automatically
- Manually add CNAME record pointing to tunnel ID if needed

---

## Internal vs External Testing

When debugging, compare internal (direct) vs external (through tunnel) access:

### Internal Access (from container in same network)

```bash
# Enter a container in the network
docker exec -it api-gateway sh

# Test direct access
curl http://frontend:5173/
curl http://api-gateway:8000/actuator/health
curl http://browser-use-api:8000/health
```

### External Access (through Cloudflare)

```bash
# From host machine
curl https://news.nodove.com/
curl https://news.nodove.com/actuator/health
curl https://news.nodove.com/api/browser-use/health
```

### Comparison Matrix

| Endpoint | Internal URL | External URL | Expected |
|----------|-------------|--------------|----------|
| Frontend | `http://frontend:5173/` | `https://news.nodove.com/` | 200 |
| API Gateway Health | `http://api-gateway:8000/actuator/health` | `https://news.nodove.com/actuator/health` | 200 |
| Browser-Use Health | `http://browser-use-api:8000/health` | `https://news.nodove.com/api/browser-use/health` | 200 |
| Data API | `http://collector-service:8080/api/v1/data` | `https://news.nodove.com/api/v1/data` | 200 |

---

## Adding New Endpoints

### Step 1: Add Route in API Gateway

Edit `backend/api-gateway-service/src/main/resources/application.yml`:

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: new-service
          uri: http://new-service:8080
          predicates:
            - Path=/api/v1/new/**
```

### Step 2: Update Cloudflare Tunnel Config (if needed)

If the new service requires a separate ingress rule, update `etc/docker/cloudflared-config.yml`:

```yaml
ingress:
  - hostname: news.nodove.com
    path: /api/new-service/*
    service: http://new-service:8080
```

### Step 3: Update Test Script

Add the new endpoint to `etc/scripts/test-cloudflare-endpoints.sh`:

```bash
test_new_service_endpoints() {
    echo ""
    echo -e "${YELLOW}=== New Service Endpoints ===${NC}"
    echo ""
    
    test_endpoint "GET" "/api/v1/new/health" "New Service Health" "200"
}
```

### Step 4: Verify

```bash
# Rebuild and restart
docker compose -p newsinsight -f docker-compose.zerotrust.yml up -d --build

# Wait for propagation
sleep 30

# Test new endpoint
curl -v https://news.nodove.com/api/v1/new/health
```

---

## Maintenance Windows

### Planned Restart Procedure

```bash
# 1. Notify (if applicable)
echo "Starting maintenance window..."

# 2. Graceful shutdown
docker compose -p newsinsight -f docker-compose.zerotrust.yml down

# 3. Perform maintenance
# ... (updates, config changes, etc.)

# 4. Restart
docker compose -p newsinsight -f docker-compose.zerotrust.yml up -d

# 5. Wait for propagation
sleep 60

# 6. Verify
./etc/scripts/test-cloudflare-endpoints.sh quick

# 7. Full verification
./etc/scripts/test-cloudflare-endpoints.sh 3 1
```

### Emergency Recovery

```bash
# Force remove all and restart
docker compose -p newsinsight -f docker-compose.zerotrust.yml down -v
docker rm -f $(docker ps -aq --filter "name=cloudflared") 2>/dev/null
docker compose -p newsinsight -f docker-compose.zerotrust.yml up -d
```

---

## Monitoring

### Log Monitoring

```bash
# Follow cloudflared logs
docker logs -f cloudflared-tunnel

# Check for specific errors
docker logs cloudflared-tunnel 2>&1 | grep -i "error\|fail\|502"
```

### Health Check Cron (Optional)

Add to crontab for regular monitoring:

```bash
# Every 5 minutes, run quick health check
*/5 * * * * /home/nodove/workspace/NewsInsight/etc/scripts/test-cloudflare-endpoints.sh quick >> /var/log/newsinsight-health.log 2>&1
```

---

## Critical Constraints

1. **Never use the same CLOUDFLARE_TUNNEL_TOKEN in multiple docker-compose projects**
2. **Always use `-p newsinsight` project name** to isolate from other projects
3. **Wait 60 seconds after restart** for Cloudflare edge propagation
4. **Use `--protocol http2`** if experiencing QUIC/UDP issues
5. **Check for stale connectors** in Cloudflare dashboard after 502 errors

---

## Related Documentation

- [GATEWAY_ARCHITECTURE.md](./GATEWAY_ARCHITECTURE.md) - API Gateway routing details
- [Scripts README](../scripts/README.md) - Test script usage
- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
