# NewsInsight Service Endpoints

Complete reference for all service endpoints in the NewsInsight platform.

## Quick Start

```bash
# Start all services
cd /home/nodove/workspace/newsinsight/etc/docker
docker-compose -f docker-compose.consul.yml up -d

# Verify all endpoints
cd /home/nodove/workspace/newsinsight
./etc/scripts/verify_endpoints.sh --verbose
```

## Infrastructure Services

### Consul (Service Discovery & Configuration)
- **Port**: 8505 (external), 8500 (internal)
- **UI**: http://localhost:8505/ui
- **API**: http://localhost:8505/v1/
- **Health**: http://localhost:8505/v1/status/leader
- **Container**: `consul`

### PostgreSQL (Primary Database)
- **Port**: 5432 (internal only)
- **Database**: newsinsight
- **User**: postgres
- **Container**: `postgres`

### MongoDB (Document Store)
- **Port**: 27017 (internal only)
- **Database**: newsinsight
- **Container**: `mongo`

### Redis (Cache & Rate Limiting)
- **Port**: 6379 (internal only)
- **Container**: `redis`

### Redpanda (Kafka-compatible Event Streaming)
- **Kafka Port**: 19093 (external), 9092 (internal)
- **Admin Port**: 19644 (external), 9644 (internal)
- **Container**: `redpanda-dev`

## Core Backend Services

### API Gateway
- **Port**: 8112 (external), 8000 (internal)
- **Health**: http://localhost:8112/actuator/health
- **Actuator**: http://localhost:8112/actuator
- **Container**: `api-gateway`
- **Routes**:
  - `/api/v1/data/**` → Collector Service
  - `/api/v1/articles/**` → Collector Service
  - `/api/v1/search/**` → Collector Service
  - `/api/v1/admin/**` → Admin Dashboard
  - `/api/v1/crawler/**` → Autonomous Crawler
  - `/api/browser-use/**` → Browser-Use API
  - `/api/ml-addons/**` → ML Add-ons
  - `/api/ml-trainer/**` → ML Trainer

### Data Collector Service
- **Port**: 8081 (internal only)
- **Health**: http://localhost:8081/actuator/health (via port forward)
- **Container**: `collector-service`
- **Endpoints**:
  - `/api/v1/data/**` - Data management
  - `/api/v1/sources/**` - Source management
  - `/api/v1/collections/**` - Collection jobs
  - `/api/v1/articles/**` - Article queries
  - `/api/v1/search/**` - Search API (SSE streaming)
  - `/api/v1/jobs/**` - Search jobs
  - `/api/v1/autocrawl/**` - Auto-crawl management
  - `/api/v1/factcheck-chat/**` - Fact-check chatbot

### Admin Dashboard
- **Port**: 8888
- **Health**: http://localhost:8888/health
- **API**: http://localhost:8888/api/v1/admin
- **Container**: `admin-dashboard`
- **Features**:
  - User authentication
  - Environment management
  - Docker-compose operations

## Crawler Services

### Web Crawler (Crawl4AI)
- **Port**: 11235
- **Health**: http://localhost:11235/health
- **Playground**: http://localhost:11235
- **Container**: `web-crawler`

### Autonomous Crawler
- **Metrics Port**: 9190 (external), 9090 (internal)
- **API Port**: 8030
- **Metrics**: http://localhost:9190
- **API**: http://localhost:8030
- **Container**: `autonomous-crawler`
- **Features**:
  - Kafka consumer for crawl tasks
  - REST API for direct crawling
  - Prometheus metrics

### Browser-Use API
- **Port**: 8501 (external), 8500 (internal)
- **Health**: http://localhost:8501/health
- **API**: http://localhost:8501
- **WebSocket**: ws://localhost:8501/ws
- **Container**: `browser-use-api`

### IP Rotation Service
- **Port**: 8050
- **Health**: http://localhost:8050/health
- **API**: http://localhost:8050
- **Container**: `ip-rotation`
- **Endpoints**:
  - `GET /proxy` - Get next proxy
  - `GET /proxies` - List all proxies
  - `POST /proxies` - Add proxy
  - `POST /proxy/report` - Report proxy status

### Crawl Worker
- **Port**: 8040
- **Health**: http://localhost:8040/health
- **API**: http://localhost:8040
- **Container**: `crawl-worker`

### Maigret Worker (OSINT)
- **Port**: 8020
- **Health**: http://localhost:8020/health
- **API**: http://localhost:8020
- **Container**: `maigret-worker`

## ML Add-ons

### Sentiment Analysis Addon
- **Port**: 8100
- **Health**: http://localhost:8100/health
- **API**: http://localhost:8100
- **Container**: `sentiment-addon`

### Fact Check Addon
- **Port**: 8101
- **Health**: http://localhost:8101/health
- **API**: http://localhost:8101
- **Container**: `factcheck-addon`

### Bias Detection Addon
- **Port**: 8102
- **Health**: http://localhost:8102/health
- **API**: http://localhost:8102
- **Container**: `bias-addon`

### Bot Detector
- **Port**: 8041
- **Health**: http://localhost:8041/health
- **API**: http://localhost:8041
- **Container**: `bot-detector`

### ML Trainer Service
- **Port**: 8090
- **Health**: http://localhost:8090/health
- **API**: http://localhost:8090
- **Container**: `ml-trainer`
- **Endpoints**:
  - `POST /jobs` - Create training job
  - `GET /jobs` - List training jobs
  - `GET /jobs/{id}` - Get job details
  - `GET /jobs/{id}/stream` - SSE stream for job progress
  - `GET /models` - List trained models

## MCP Servers (Model Context Protocol)

### NewsInsight MCP
- **Port**: 5000
- **Health**: http://localhost:5000/health
- **Container**: `newsinsight-mcp`
- **Database**: PostgreSQL + MongoDB

### Bias MCP
- **Port**: 5001
- **Health**: http://localhost:5001/health
- **Container**: `bias-mcp`
- **Database**: PostgreSQL + MongoDB

### Factcheck MCP
- **Port**: 5002
- **Health**: http://localhost:5002/health
- **Container**: `factcheck-mcp`
- **Database**: PostgreSQL + MongoDB

### Topic MCP
- **Port**: 5003
- **Health**: http://localhost:5003/health
- **Container**: `topic-mcp`
- **Database**: PostgreSQL + MongoDB

### AIAgent MCP
- **Port**: 5004
- **Health**: http://localhost:5004/health
- **Container**: `aiagent-mcp`
- **Database**: PostgreSQL

### HuggingFace MCP
- **Port**: 5011
- **Health**: http://localhost:5011/health
- **Container**: `huggingface-mcp`
- **Features**: Model download, inference

### Kaggle MCP
- **Port**: 5012
- **Health**: http://localhost:5012/health
- **Container**: `kaggle-mcp`
- **Features**: Dataset download, competition access

### MLTraining MCP
- **Port**: 5013
- **Health**: http://localhost:5013/health
- **Container**: `mltraining-mcp`
- **Database**: PostgreSQL

### Roboflow MCP
- **Port**: 5014
- **Health**: http://localhost:5014/health
- **Container**: `roboflow-mcp`
- **Features**: Computer vision datasets

## Frontend

### React/Vite Frontend
- **Port**: 8810 (external), 8080 (internal)
- **Dev Server**: http://localhost:8810
- **Container**: `frontend`
- **Environment**:
  - `VITE_API_BASE_URL`: http://api-gateway:8000

## Service Dependencies

```
api-gateway
├── consul (healthy)
├── consul-seed (completed)
├── collector-service (started)
├── browser-use-api (started)
├── sentiment-addon (started)
├── factcheck-addon (started)
├── bias-addon (started)
├── bot-detector (started)
├── admin-dashboard (started)
├── ml-trainer (started)
└── autonomous-crawler (started)

collector-service
├── consul (healthy)
├── consul-seed (completed)
├── postgres (healthy)
├── mongo (healthy)
├── web-crawler (started)
├── redpanda-dev (started)
└── autonomous-crawler (started)

autonomous-crawler
├── consul (healthy)
├── consul-seed (completed)
├── redpanda-dev (started)
├── redis (healthy)
├── newsinsight-mcp (started)
├── bias-mcp (started)
├── factcheck-mcp (started)
├── topic-mcp (started)
├── aiagent-mcp (started)
├── huggingface-mcp (started)
├── kaggle-mcp (started)
├── mltraining-mcp (started)
└── roboflow-mcp (started)

ml-trainer
├── postgres (healthy)
├── mongo (healthy)
├── redis (healthy)
├── kaggle-mcp (started)
├── mltraining-mcp (started)
├── roboflow-mcp (started)
└── huggingface-mcp (started)
```

## Network Configuration

### newsinsight-net (default)
- **Type**: bridge
- **Services**: All services except those requiring shared network

### newsinsight-shared-net
- **Type**: bridge
- **Services**:
  - redpanda-dev
  - collector-service
  - autonomous-crawler
  - browser-use-api
  - bot-detector

## Environment Variables

### Required API Keys
```bash
# LLM Providers
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=

# Search APIs
SEARCH_BRAVE_API_KEY=
SEARCH_TAVILY_API_KEY=
SEARCH_PERPLEXITY_API_KEY=
PERPLEXITY_API_KEY=

# CAPTCHA Solvers
CAPTCHA_CAPSOLVER_API_KEY=
CAPTCHA_TWOCAPTCHA_API_KEY=

# ML/Data Services
HF_TOKEN=
KAGGLE_USERNAME=
KAGGLE_KEY=
ROBOFLOW_API_KEY=

# External Services
AIDOVE_WEBHOOK_URL=
```

### Optional Configuration
```bash
# Consul
CONSUL_HOST=consul
CONSUL_PORT=8500
CONSUL_ENABLED=true

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=newsinsight
DB_USER=postgres
DB_PASSWORD=postgres

# MongoDB
MONGODB_URI=mongodb://mongo:27017/newsinsight

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Kafka
KAFKA_BOOTSTRAP_SERVERS=redpanda-dev:9092
```

## Troubleshooting

### Check Service Health
```bash
# Check all services
./etc/scripts/verify_endpoints.sh --verbose

# Check specific service
curl http://localhost:8112/actuator/health

# Check Consul service registry
curl http://localhost:8505/v1/catalog/services
```

### View Logs
```bash
# All services
docker-compose -f etc/docker/docker-compose.consul.yml logs -f

# Specific service
docker-compose -f etc/docker/docker-compose.consul.yml logs -f api-gateway
```

### Restart Services
```bash
# Restart all
docker-compose -f etc/docker/docker-compose.consul.yml restart

# Restart specific service
docker-compose -f etc/docker/docker-compose.consul.yml restart api-gateway
```

## API Gateway Routes Reference

| Route Pattern | Target Service | Port | Strip Prefix |
|--------------|----------------|------|--------------|
| `/api/v1/data/**` | collector-service | 8081 | No |
| `/api/v1/sources/**` | collector-service | 8081 | No |
| `/api/v1/collections/**` | collector-service | 8081 | No |
| `/api/v1/articles/**` | collector-service | 8081 | No |
| `/api/v1/search/**` | collector-service | 8081 | No |
| `/api/v1/jobs/**` | collector-service | 8081 | No |
| `/api/v1/autocrawl/**` | collector-service | 8081 | No |
| `/api/v1/factcheck-chat/**` | collector-service | 8081 | No |
| `/api/v1/admin/**` | admin-dashboard | 8888 | No |
| `/api/v1/crawler/**` | autonomous-crawler | 8030 | Yes (3) |
| `/api/browser-use/**` | browser-use-api | 8500 | Yes (2) |
| `/api/ml-addons/sentiment/**` | sentiment-addon | 8100 | Yes (3) |
| `/api/ml-addons/factcheck/**` | factcheck-addon | 8101 | Yes (3) |
| `/api/ml-addons/bias/**` | bias-addon | 8102 | Yes (3) |
| `/api/ml-addons/bot-detector/**` | bot-detector | 8041 | Yes (3) |
| `/api/ml-trainer/**` | ml-trainer | 8090 | Yes (2) |

## Changes Made

### Fixed Issues
1. ✅ **API Gateway Route Mismatch**: Fixed factcheck-chat route pointing to wrong service URL
2. ✅ **Missing MCP Servers**: Added kaggle-mcp, mltraining-mcp, roboflow-mcp
3. ✅ **Missing ML Trainer**: Added ml-trainer service with full configuration
4. ✅ **Service URLs**: Updated services.json with all service endpoints
5. ✅ **Dependencies**: Updated api-gateway and autonomous-crawler dependencies
6. ✅ **Environment Variables**: Added all MCP server URLs to autonomous-crawler
7. ✅ **Volumes**: Added persistent volumes for new services

### New Services Added
- `ml-trainer` (Port 8090)
- `kaggle-mcp` (Port 5012)
- `mltraining-mcp` (Port 5013)
- `roboflow-mcp` (Port 5014)

### Total Services: 30
- Infrastructure: 5
- Core Backend: 3
- Crawlers: 6
- ML Add-ons: 5
- MCP Servers: 9
- Frontend: 1
- Workers: 1
