# Scripts Directory

This directory contains operational scripts for the NewsInsight project.

## consul_seed.sh

Loads configuration from environment-specific files into Consul KV store. Supports both `.env` files and JSON configuration.

### Usage

```bash
./consul_seed.sh [environment] [options]
```

**Arguments:**
- `environment` - Optional. One of: `development` (default), `staging`, `production`

**Options:**
- `--env` - Load configuration from `.env` file (default, legacy behavior)
- `--json` - Load configuration from `services.json` (service definitions + env-specific settings)
- `--both` - Load both JSON service config and `.env` secrets
- `--help`, `-h` - Show help message

**Environment Variables:**
- `CONSUL_HTTP_ADDR` - Consul HTTP API address (default: `http://localhost:8500`)
- `CONSUL_HTTP_TOKEN` - Consul ACL token (optional, for secured Consul)
- `CONFIG_MODE` - Alternative to flags: `json`, `env`, or `both`

### Configuration Modes

#### Mode: `--env` (Default)
Loads from `etc/configs/{environment}.env`:
- Secrets and sensitive configuration
- API keys, database credentials
- Service-specific environment variables

#### Mode: `--json`
Loads from `etc/configs/services.json`:
- Service definitions (ports, healthchecks, dependencies)
- Environment-specific profiles (replicas, resources)
- ML addon configuration
- Infrastructure settings

#### Mode: `--both` (Recommended for Production)
Combines both sources:
1. First loads service structure from JSON
2. Then loads secrets from `.env`

### Examples

```bash
# Seed development configuration (default mode: --env)
./consul_seed.sh development

# Seed production with JSON config only
./consul_seed.sh production --json

# Seed staging with both JSON and .env (recommended)
./consul_seed.sh staging --both

# Seed with custom Consul address
CONSUL_HTTP_ADDR=http://consul:8500 ./consul_seed.sh production --both

# Seed with ACL token
CONSUL_HTTP_TOKEN=secret ./consul_seed.sh production --both

# Using environment variable for config mode
CONFIG_MODE=json ./consul_seed.sh production
```

### Consul KV Structure

#### From `.env` files:
```
config/api-gateway/PORT = 8000
config/api-gateway/JWT_SECRET_KEY = <secret>
config/collector-service/DATABASE_URL = jdbc:postgresql://...
config/collector-service/PERPLEXITY_API_KEY = <api-key>
```

#### From `services.json`:
```
config/version = 1.0.0
config/api-gateway/PORT = 8000
config/api-gateway/HEALTHCHECK = /actuator/health
config/api-gateway/DEPENDENCIES = postgres,mongo,redis,consul,redpanda
config/api-gateway/REPLICAS = 3
config/api-gateway/MEMORY = 2Gi
config/api-gateway/CPU = 1000m
config/api-gateway/SPRING_PROFILES_ACTIVE = production
config/ml-addons/sentiment-addon/ENABLED = true
config/ml-addons/sentiment-addon/PORT = 8100
config/infrastructure/postgres/IMAGE = postgres:15-alpine
config/infrastructure/postgres/PORT = 5432
```

### Prerequisites

- `curl` - For Consul API calls
- `bash` - Shell interpreter
- `jq` - Required for JSON mode, optional for .env mode

### Configuration Files

| File | Purpose |
|------|---------|
| `etc/configs/services.json` | Service definitions, profiles, resources |
| `etc/configs/services.schema.json` | JSON schema for validation |
| `etc/configs/.env.example` | Template for environment files |
| `etc/configs/{env}.env` | Environment-specific secrets (not in git) |

### Output Example

```
╔════════════════════════════════════════════════════════════╗
║           Consul KV Configuration Seed Script              ║
╚════════════════════════════════════════════════════════════╝

[INFO] Environment: production
[INFO] Config Mode: both
[INFO] Consul Address: http://localhost:8500
[INFO] Env Config File: /path/to/configs/production.env
[INFO] JSON Config File: /path/to/configs/services.json

[INFO] Checking prerequisites...
[SUCCESS] Prerequisites check passed
[INFO] Waiting for Consul to be ready at http://localhost:8500...
[SUCCESS] Consul is ready
[INFO] Loading both JSON and .env configurations...

[INFO] Loading configuration from services.json (environment: production)...

=== Service: api-gateway ===
  ✓ config/api-gateway/PORT = 8000
  ✓ config/api-gateway/HEALTHCHECK = /actuator/health
  ✓ config/api-gateway/DEPENDENCIES = postgres,mongo,redis,consul,redpanda
  ✓ config/api-gateway/REPLICAS = 3
  ✓ config/api-gateway/MEMORY = 2Gi
  ✓ config/api-gateway/CPU = 1000m

[INFO] Loading ML addon configurations...
✓ config/ml-addons/sentiment-addon (ENABLED, port: 8100)
...

[INFO] Loading configuration from production.env...
[SUCCESS] ✓ config/api-gateway/JWT_SECRET_KEY = ***
[SUCCESS] ✓ config/collector-service/DATABASE_URL = ***
...

[SUCCESS] All configurations loaded successfully!
```

### GitHub Actions Integration

The script is used in `.github/workflows/deploy-consul-secrets.yml`:

```yaml
- name: Deploy secrets to Consul
  run: |
    ./scripts/consul_seed.sh ${{ env.DEPLOY_ENVIRONMENT }} --${{ env.CONFIG_MODE }}
```

Workflow inputs:
- `environment`: development, staging, production
- `config_mode`: env, json, both
- `skip_validation`: Skip pre-deployment validation

### Docker Compose Integration

```yaml
consul-seed:
  image: alpine:3.18
  depends_on:
    consul:
      condition: service_healthy
  volumes:
    - ./etc/scripts:/scripts:ro
    - ./etc/configs:/configs:ro
  environment:
    - CONSUL_HTTP_ADDR=http://consul:8500
    - CONSUL_HTTP_TOKEN=${CONSUL_HTTP_TOKEN:-}
    - CONFIG_MODE=both
  command: >
    sh -c "
      apk add --no-cache curl bash jq &&
      /scripts/consul_seed.sh ${ENVIRONMENT:-development} --both
    "
  restart: "no"
```

### Troubleshooting

**Error: Configuration file not found**
```
[ERROR] Configuration file not found: etc/configs/production.env
```
- Ensure the config file exists in `etc/configs/`
- Check spelling of environment name
- For `--json` mode, ensure `services.json` exists

**Error: jq is required**
```
[ERROR] jq is required for JSON config mode. Please install jq.
```
- Install jq: `apt-get install jq` or `brew install jq`
- jq is required for `--json` and `--both` modes

**Error: Invalid JSON**
```
[ERROR] Invalid JSON in services.json
```
- Run: `jq empty etc/configs/services.json` to check for syntax errors
- Validate against schema: `ajv validate -s services.schema.json -d services.json`

**Error: Consul not ready**
```
[ERROR] Consul did not become ready after 30 attempts
```
- Verify Consul is running
- Check Consul health: `curl http://localhost:8500/v1/status/leader`

---

For more information, see:
- [CONSUL_MIGRATION.md](../infra-guides/CONSUL_MIGRATION.md)
- [services.json](../configs/services.json)
- [.env.example](../configs/.env.example)
