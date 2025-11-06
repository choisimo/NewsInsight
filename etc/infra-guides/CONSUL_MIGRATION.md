# Consul KV Configuration Migration Guide

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Structure Design](#key-structure-design)
4. [Configuration Loader](#configuration-loader)
5. [Migrated Services](#migrated-services)
6. [Deployment Guide](#deployment-guide)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)
9. [Security & ACL Setup](#security--acl-setup)
10. [Rollback Strategy](#rollback-strategy)

---

## Overview

This project has migrated from hardcoded/mock environment variables to production-ready Consul KV-based configuration management. All microservices now load their configuration exclusively from Consul KV or environment variables, with **no hardcoded defaults**.

### Goals Achieved
- ✅ Centralized configuration management using Consul KV
- ✅ Eliminated all hardcoded configuration defaults
- ✅ Fail-fast validation: services refuse to start if configuration is missing
- ✅ Config precedence: Consul KV → Environment variables → (error)
- ✅ Observability: health endpoints expose configuration source statistics
- ✅ Environment-specific configurations (development, staging, production)
- ✅ Automated configuration seeding via init container

### Benefits
- **Centralized Management**: Single source of truth for all configuration
- **Dynamic Updates**: Configuration can be updated without rebuilding containers
- **Environment Isolation**: Separate configurations for dev/staging/production
- **Audit Trail**: Consul provides built-in versioning and change tracking
- **Security**: Sensitive values stored in Consul, not in code or env files
- **Observability**: Real-time visibility into configuration sources

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Consul Server                          │
│                                                             │
│  ┌───────────────────────────────────────────────────┐    │
│  │           Consul KV Store                         │    │
│  │                                                   │    │
│  │  config/api-gateway/PORT                         │    │
│  │  config/api-gateway/DEBUG                        │    │
│  │  config/api-gateway/JWT_SECRET_KEY               │    │
│  │  config/analysis-service/DATABASE_URL            │    │
│  │  config/collector-service/REDIS_URL              │    │
│  │  ...                                             │    │
│  └───────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                         ▲
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│              │ │              │ │              │
│ API Gateway  │ │  Analysis    │ │  Collector   │
│              │ │  Service     │ │  Service     │
│              │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Configuration Flow

1. **Startup Sequence**:
   ```
   Consul → consul-seed (init) → Services Start → Load Config from Consul
   ```

2. **Configuration Loading**:
   - Service imports `ConsulConfigLoader`
   - Loader connects to Consul using `CONSUL_HTTP_ADDR`
   - Loader retrieves keys from `config/{service-name}/`
   - If key not in Consul, fallback to environment variable
   - If still missing and required, service fails to start

3. **Runtime Behavior**:
   - Configuration loaded once at startup
   - Health endpoints report config source (Consul vs Environment)
   - Services track which keys came from which source

---

## Key Structure Design

### Consul KV Hierarchy

All configuration keys follow this pattern:

```
config/{service-name}/{CONFIGURATION_KEY}
```

### Service Prefixes

| Service            | Consul KV Prefix         | Environment Prefix       |
|--------------------|--------------------------|--------------------------|
| API Gateway        | `config/api-gateway/`    | `API_GATEWAY_`           |
| Analysis Service   | `config/analysis-service/` | `ANALYSIS_SERVICE_`    |
| Collector Service  | `config/collector-service/` | `COLLECTOR_SERVICE_`  |
| Web Crawler        | `config/web-crawler/`    | `WEB_CRAWLER_`           |

### Example Keys

**API Gateway:**
```
config/api-gateway/PORT = 8000
config/api-gateway/DEBUG = false
config/api-gateway/JWT_SECRET_KEY = secure-secret-here
config/api-gateway/ANALYSIS_SERVICE_URL = http://analysis-service:8001
```

**Analysis Service:**
```
config/analysis-service/PORT = 8001
config/analysis-service/DATABASE_URL = postgresql://...
config/analysis-service/REDIS_URL = redis://...
config/analysis-service/ML_MODEL_PATH = /app/models/sentiment_model
```

**Collector Service:**
```
config/collector-service/PORT = 8002
config/collector-service/DATABASE_URL = postgresql://...
config/collector-service/MAX_CONCURRENT_REQUESTS = 10
config/collector-service/RSS_FEEDS = https://...,...
```

---

## Configuration Loader

### ConsulConfigLoader Class

Located at: `code/shared/consul_config.py`

This shared utility provides:
- Consul KV integration with fallback to environment variables
- Type coercion (bool, int, list, JSON)
- Observability (config source tracking)
- Graceful error handling
- Validation of required keys

### Usage Example

```python
from consul_config import ConsulConfigLoader

# Define required configuration keys
required_keys = ["PORT", "DEBUG", "DATABASE_URL"]

# Initialize loader
loader = ConsulConfigLoader(
    service_name="my-service",
    required_keys=required_keys
)

# Load configuration
config = loader.load_config(validate=True)

# Access values with type coercion
port = loader.coerce_int(config.get("PORT"))
debug = loader.coerce_bool(config.get("DEBUG"))
allowed_hosts = loader.coerce_list(config.get("ALLOWED_HOSTS"))

# Check configuration source
print(f"From Consul: {loader.consul_loaded_keys}")
print(f"From Env: {loader.env_loaded_keys}")
```

### Configuration Precedence

1. **Consul KV** (highest priority)
   - Key path: `config/{service-name}/{KEY}`
   - Example: `config/api-gateway/PORT`

2. **Environment Variables**
   - Full key name: `{SERVICE_PREFIX}_{KEY}`
   - Example: `API_GATEWAY_PORT`

3. **Error** (if required key not found)
   - Service fails to start with clear error message

---

## Migrated Services

### ✅ API Gateway
- **Location**: `code/BACKEND-API-GATEWAY/`
- **Config File**: `code/BACKEND-API-GATEWAY/app/config.py`
- **Health Endpoint**: `GET /health` (includes config source info)
- **Required Keys**: PORT, DEBUG, ANALYSIS_SERVICE_URL, COLLECTOR_SERVICE_URL, JWT settings, CORS settings, rate limits

### ✅ Analysis Service
- **Location**: `code/BACKEND-ANALYSIS-SERVICE/`
- **Config File**: `code/BACKEND-ANALYSIS-SERVICE/app/config.py`
- **Health Endpoint**: `GET /health` (includes config source info)
- **Required Keys**: PORT, DATABASE_URL, REDIS_URL, SECRET_KEY, ML_MODEL_PATH, service URLs

### ✅ Collector Service
- **Location**: `code/BACKEND-COLLECTOR-SERVICE/`
- **Config File**: `code/BACKEND-COLLECTOR-SERVICE/app/config.py`
- **Health Endpoint**: `GET /health` (includes config source info)
- **Required Keys**: PORT, DATABASE_URL, REDIS_URL, ANALYSIS_SERVICE_URL, collection settings, scraping targets

### ⚠️ Web Crawler (Partial)
- **Location**: `code/BACKEND-WEB-CRAWLER/`
- **Status**: Uses existing environment-based configuration
- **Note**: Flask-based third-party project with extensive env vars; kept as-is for now

---

## Deployment Guide

### Prerequisites

- Docker and Docker Compose
- Consul 1.18+ (included in `docker-compose.consul.yml`)
- curl, bash, jq (for seed script)

### Step 1: Prepare Configuration Files

Edit environment-specific configuration files:

```bash
# Development (default)
vim configs/development.env

# Staging
vim configs/staging.env

# Production (replace all placeholder values!)
vim configs/production.env
```

**IMPORTANT**: For production, replace all placeholder secrets:
- `REPLACE_WITH_SECURE_RANDOM_STRING_MIN_32_CHARS`
- Database URLs
- Redis URLs
- API keys and secrets

### Step 2: Start Consul and Seed Configuration

```bash
# Start Consul and seed with development config
docker compose -f docker-compose.consul.yml up consul consul-seed

# Or for staging
ENVIRONMENT=staging docker compose -f docker-compose.consul.yml up consul consul-seed

# Or for production
ENVIRONMENT=production docker compose -f docker-compose.consul.yml up consul consul-seed
```

### Step 3: Verify Configuration in Consul

Access Consul UI at `http://localhost:8500/ui/` and verify:
1. Navigate to Key/Value section
2. Check `config/api-gateway/`, `config/analysis-service/`, etc.
3. Verify all expected keys are present

Alternatively, use the CLI:

```bash
# List all keys for a service
curl http://localhost:8500/v1/kv/config/api-gateway/?keys

# Get a specific value
curl http://localhost:8500/v1/kv/config/api-gateway/PORT | jq -r '.[0].Value' | base64 -d
```

### Step 4: Start All Services

```bash
# Start the full stack
docker compose -f docker-compose.consul.yml up -d

# Check service health
curl http://localhost:8000/health  # API Gateway
curl http://localhost:8001/health  # Analysis Service
curl http://localhost:8002/health  # Collector Service
```

### Step 5: Verify Configuration Sources

Check health endpoints to see where configuration was loaded from:

```bash
# API Gateway health
curl http://localhost:8000/health | jq '.config_source'

# Example output:
# {
#   "consul_keys": ["PORT", "DEBUG", "JWT_SECRET_KEY", ...],
#   "env_keys": [],
#   "total_keys": 15
# }
```

---

## Testing

### Manual Testing

1. **Test Consul KV Loading**:
   ```bash
   # Seed Consul
   ./scripts/consul_seed.sh development
   
   # Start services
   docker compose -f docker-compose.consul.yml up api-gateway
   
   # Check health
   curl http://localhost:8000/health
   ```

2. **Test Environment Variable Fallback**:
   ```bash
   # Start service with env override
   API_GATEWAY_PORT=9000 docker compose -f docker-compose.consul.yml up api-gateway
   
   # Verify port changed
   curl http://localhost:9000/health
   ```

3. **Test Missing Configuration (Fail-Fast)**:
   ```bash
   # Remove a required key from Consul
   curl -X DELETE http://localhost:8500/v1/kv/config/api-gateway/PORT
   
   # Restart service - should fail to start
   docker compose -f docker-compose.consul.yml restart api-gateway
   
   # Check logs - should see clear error message
   docker compose -f docker-compose.consul.yml logs api-gateway
   ```

### Integration Testing

```bash
# Full stack test
docker compose -f docker-compose.consul.yml up -d

# Wait for services to be ready
sleep 10

# Test API Gateway → Analysis Service communication
curl -X POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "Test pension article"}'

# Test API Gateway → Collector Service communication
curl http://localhost:8000/api/sources
```

---

## Troubleshooting

### Service Fails to Start

**Symptom**: Service exits immediately after startup

**Diagnosis**:
```bash
# Check logs
docker compose -f docker-compose.consul.yml logs <service-name>

# Look for error messages like:
# "Missing required configuration keys: DATABASE_URL, REDIS_URL"
```

**Solution**:
1. Verify Consul is running: `curl http://localhost:8500/v1/status/leader`
2. Check if keys exist: `curl http://localhost:8500/v1/kv/config/<service-name>/?keys`
3. Re-seed Consul: `./scripts/consul_seed.sh development`

### Configuration Not Loading from Consul

**Symptom**: Service uses environment variable instead of Consul value

**Diagnosis**:
```bash
# Check health endpoint
curl http://localhost:8000/health | jq '.config_source'

# If key appears in "env_keys" instead of "consul_keys",
# Consul value is not being read
```

**Solution**:
1. Verify key exists in Consul:
   ```bash
   curl http://localhost:8500/v1/kv/config/api-gateway/PORT
   ```
2. Check CONSUL_HTTP_ADDR environment variable:
   ```bash
   docker compose -f docker-compose.consul.yml exec api-gateway env | grep CONSUL
   ```
3. Check ConsulConfigLoader logs for connection errors

### consul-seed Container Fails

**Symptom**: `consul-seed` service exits with error code

**Diagnosis**:
```bash
docker compose -f docker-compose.consul.yml logs consul-seed
```

**Common Issues**:
1. **Missing config file**: Ensure `configs/<environment>.env` exists
2. **Consul not ready**: Increase healthcheck retries in docker-compose
3. **Permission denied**: Ensure seed script is executable (`chmod +x scripts/consul_seed.sh`)

**Solution**:
```bash
# Re-run seed manually
docker compose -f docker-compose.consul.yml run --rm consul-seed

# Or seed from host
CONSUL_HTTP_ADDR=http://localhost:8500 ./scripts/consul_seed.sh development
```

### Consul Connection Refused

**Symptom**: Services can't connect to Consul

**Diagnosis**:
```bash
# Check Consul health
docker compose -f docker-compose.consul.yml ps consul

# Test Consul API from service container
docker compose -f docker-compose.consul.yml exec api-gateway \
  curl http://consul:8500/v1/status/leader
```

**Solution**:
1. Ensure Consul is in `healthy` state before starting services
2. Verify service `depends_on` includes `consul: condition: service_healthy`
3. Check Docker network connectivity:
   ```bash
   docker network inspect pension-net
   ```

---

## Security & ACL Setup

### Production ACL Configuration

For production deployments, enable Consul ACLs to secure configuration access:

#### 1. Enable ACLs in Consul

Update `docker-compose.consul.yml`:
```yaml
consul:
  image: hashicorp/consul:1.18
  command: 
    - agent
    - -server
    - -bootstrap-expect=1
    - -client=0.0.0.0
    - -ui
  environment:
    - CONSUL_LOCAL_CONFIG={"acl":{"enabled":true,"default_policy":"deny"}}
```

#### 2. Bootstrap ACL System

```bash
# Start Consul
docker compose -f docker-compose.consul.yml up -d consul

# Bootstrap ACL and get master token
docker compose -f docker-compose.consul.yml exec consul \
  consul acl bootstrap

# Save the SecretID (master token)
```

#### 3. Create Service Tokens

```bash
# Create policy for each service
cat > api-gateway-policy.hcl <<EOF
key_prefix "config/api-gateway/" {
  policy = "read"
}
EOF

# Apply policy
consul acl policy create \
  -name api-gateway-policy \
  -rules @api-gateway-policy.hcl

# Create token
consul acl token create \
  -description "API Gateway Config Token" \
  -policy-name api-gateway-policy
```

#### 4. Use Tokens in Services

Update `docker-compose.consul.yml`:
```yaml
api-gateway:
  environment:
    - CONSUL_HTTP_TOKEN=<api-gateway-token-here>
```

### Secrets Management

**DO NOT**:
- ❌ Commit production secrets to version control
- ❌ Store secrets in plain text in config files
- ❌ Share ACL tokens across services

**DO**:
- ✅ Use environment-specific `.env` files (gitignored)
- ✅ Use secret management tools (Vault, AWS Secrets Manager, etc.)
- ✅ Rotate tokens regularly
- ✅ Use minimal privilege tokens (per-service policies)
- ✅ Enable TLS for Consul in production

---

## Rollback Strategy

### Quick Rollback (Environment Variables)

If Consul fails, services can fall back to environment variables:

```bash
# Set all required config as environment variables
cat > .env.production <<EOF
API_GATEWAY_PORT=8000
API_GATEWAY_DEBUG=false
# ... all other keys
EOF

# Start services with env file
docker compose --env-file .env.production up
```

### Consul KV Rollback

Consul maintains key history. To rollback:

```bash
# List key versions
consul kv get -detailed config/api-gateway/PORT

# Rollback to previous version
consul kv put -cas=<previous-modify-index> \
  config/api-gateway/PORT <old-value>
```

### Full Stack Rollback

```bash
# Stop Consul-based stack
docker compose -f docker-compose.consul.yml down

# Revert to old docker-compose (if it exists)
docker compose -f docker-compose.old.yml up -d
```

---

## Appendix

### File Structure

```
.
├── code/
│   ├── shared/
│   │   └── consul_config.py          # Shared ConsulConfigLoader
│   ├── BACKEND-API-GATEWAY/
│   │   └── app/
│   │       ├── config.py              # Config using ConsulConfigLoader
│   │       ├── consul_config.py       # Copied loader
│   │       └── main.py                # Health endpoint with config info
│   ├── BACKEND-ANALYSIS-SERVICE/
│   │   └── app/
│   │       ├── config.py
│   │       ├── consul_config.py
│   │       └── main.py
│   ├── BACKEND-COLLECTOR-SERVICE/
│   │   └── app/
│   │       ├── config.py
│   │       ├── consul_config.py
│   │       └── main.py
│   └── BACKEND-WEB-CRAWLER/          # Uses env vars (unchanged)
├── configs/
│   ├── development.env                # Dev config values
│   ├── staging.env                    # Staging config values
│   └── production.env                 # Production config values
├── scripts/
│   └── consul_seed.sh                 # Consul KV seed script
├── docker-compose.consul.yml          # Consul-enabled stack
└── CONSUL_MIGRATION.md                # This document
```

### Useful Commands

```bash
# Seed Consul
./scripts/consul_seed.sh development

# Start full stack
docker compose -f docker-compose.consul.yml up -d

# View Consul KV keys
curl http://localhost:8500/v1/kv/config/?keys | jq

# Get specific value
curl -s http://localhost:8500/v1/kv/config/api-gateway/PORT | jq -r '.[0].Value' | base64 -d

# Update value in Consul
curl -X PUT -d "9000" http://localhost:8500/v1/kv/config/api-gateway/PORT

# Check service health
curl http://localhost:8000/health | jq

# Check service logs
docker compose -f docker-compose.consul.yml logs -f api-gateway
```

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review service logs: `docker compose -f docker-compose.consul.yml logs <service>`
3. Verify Consul KV contains expected keys: Consul UI at `http://localhost:8500/ui/`
4. Consult [Consul documentation](https://www.consul.io/docs)

---

**Last Updated**: November 6, 2025  
**Version**: 1.0.0  
**Migration Status**: Complete (API Gateway, Analysis Service, Collector Service)
