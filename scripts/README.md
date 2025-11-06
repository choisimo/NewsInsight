# Scripts Directory

This directory contains operational scripts for the Cloud Computing Project.

## consul_seed.sh

Loads configuration from environment-specific files into Consul KV store.

### Usage

```bash
./consul_seed.sh [environment]
```

**Arguments:**
- `environment` - Optional. One of: `development` (default), `staging`, `production`

**Environment Variables:**
- `CONSUL_HTTP_ADDR` - Consul HTTP API address (default: `http://localhost:8500`)
- `CONSUL_HTTP_TOKEN` - Consul ACL token (optional, for secured Consul)

### Examples

```bash
# Seed development configuration (default)
./consul_seed.sh development

# Seed staging configuration
./consul_seed.sh staging

# Seed production configuration
./consul_seed.sh production

# Seed with custom Consul address
CONSUL_HTTP_ADDR=http://consul:8500 ./consul_seed.sh development

# Seed with ACL token
CONSUL_HTTP_TOKEN=secret ./consul_seed.sh production
```

### What It Does

1. Reads configuration from `configs/{environment}.env`
2. Parses key-value pairs from the file
3. Maps keys to appropriate service prefixes:
   - `API_GATEWAY_*` → `config/api-gateway/*`
   - `ANALYSIS_SERVICE_*` → `config/analysis-service/*`
   - `COLLECTOR_SERVICE_*` → `config/collector-service/*`
   - `WEB_CRAWLER_*` → `config/web-crawler/*`
4. Stores each key-value pair in Consul KV
5. Reports success/failure for each key

### Prerequisites

- `curl` - For Consul API calls
- `bash` - Shell interpreter
- `jq` - Optional, for pretty output formatting
- Consul server running and accessible

### Output Example

```
╔════════════════════════════════════════════════════════════╗
║           Consul KV Configuration Seed Script              ║
╚════════════════════════════════════════════════════════════╝

[INFO] Environment: development
[INFO] Consul Address: http://localhost:8500
[INFO] Config File: /path/to/configs/development.env

[INFO] Checking prerequisites...
[SUCCESS] Prerequisites check passed
[INFO] Waiting for Consul to be ready at http://localhost:8500...
[SUCCESS] Consul is ready
[INFO] Loading configuration from /path/to/configs/development.env...

[SUCCESS] ✓ config/api-gateway/PORT = 8000
[SUCCESS] ✓ config/api-gateway/DEBUG = true
[SUCCESS] ✓ config/api-gateway/LOG_LEVEL = DEBUG
...

[INFO] ════════════════════════════════════════════════════════════
[INFO] Configuration loading completed
[INFO] Total keys: 45
[SUCCESS] Successful: 45
[INFO] ════════════════════════════════════════════════════════════
```

### Troubleshooting

**Error: Configuration file not found**
```
[ERROR] Configuration file not found: configs/production.env
```
- Ensure the config file exists in the `configs/` directory
- Check spelling of environment name

**Error: Consul not ready**
```
[ERROR] Consul did not become ready after 30 attempts
```
- Verify Consul is running: `docker compose -f docker-compose.consul.yml ps consul`
- Check Consul health: `curl http://localhost:8500/v1/status/leader`

**Error: Failed to set key**
```
[ERROR] ✗ Failed to set config/api-gateway/PORT
```
- Check Consul ACL token if using ACLs
- Verify Consul is writable (not in maintenance mode)
- Check network connectivity to Consul

### Integration with Docker Compose

This script is automatically run by the `consul-seed` init container in `docker-compose.consul.yml`:

```yaml
consul-seed:
  image: alpine:3.18
  depends_on:
    consul:
      condition: service_healthy
  volumes:
    - ./scripts:/scripts:ro
    - ./configs:/configs:ro
  environment:
    - CONSUL_HTTP_ADDR=http://consul:8500
    - CONSUL_HTTP_TOKEN=${CONSUL_HTTP_TOKEN:-}
  command: >
    sh -c "
      apk add --no-cache curl bash jq &&
      /scripts/consul_seed.sh ${ENVIRONMENT:-development}
    "
  restart: "no"
```

All microservices depend on `consul-seed` completing successfully before they start, ensuring configuration is available.

---

For more information, see [CONSUL_MIGRATION.md](../CONSUL_MIGRATION.md)
