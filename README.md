# NewsInsight

A microservices-based platform for collecting, analyzing, and delivering news insights.

## Project Structure

```
NewsInsight/
├── backend/                          # Backend microservices
│   ├── api-gateway-service/         # Spring Cloud Gateway for API routing
│   ├── data-collection-service/     # News data collection and RSS feed processing
│   └── shared-libs/                 # Shared libraries and common utilities
│
├── frontend/                        # React-based web application
│
├── docs/                           # Documentation
│   └── backend/                    # Backend service documentation
│       ├── data-collection-service/
│       └── init_document/
│
├── etc/                            # Configuration and infrastructure
│   ├── configs/                    # Environment configurations
│   │   ├── development.env
│   │   ├── staging.env
│   │   └── production.env
│   ├── docker/                     # Docker compose files
│   │   └── docker-compose.consul.yml
│   ├── scripts/                    # Utility scripts
│   └── infra-guides/              # Infrastructure migration guides
│
├── archived-python-backends/       # Legacy Python services (archived)
│
├── build.gradle.kts               # Root Gradle build configuration
├── settings.gradle.kts            # Gradle multi-module settings
└── gradle.properties              # Gradle properties
```

## Technology Stack

### Backend Services
- **Framework**: Spring Boot 3.2.1 with Java 21
- **Service Discovery**: Consul
- **API Gateway**: Spring Cloud Gateway
- **Database**: PostgreSQL
- **Caching**: Redis
- **Build Tool**: Gradle 8.5+

### Frontend
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **UI Components**: shadcn/ui

## Getting Started

### Prerequisites
- Java 21 or higher
- Node.js 18+ and npm/bun
- Docker and Docker Compose
- Consul (for service discovery)
- PostgreSQL (for data persistence)
- Redis (for caching and rate limiting)

### Building the Project

#### Backend Services
```bash
# Build all services
./gradlew clean build

# Build specific service
./gradlew :backend:api-gateway-service:build
./gradlew :backend:data-collection-service:build

# Run tests
./gradlew test
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Running with Docker Compose

The easiest way to run the entire stack:

```bash
cd etc/docker
docker-compose -f docker-compose.consul.yml up
```

This will start:
- Consul (service discovery and configuration)
- PostgreSQL database
- Redis cache
- API Gateway (port 8000)
- Data Collection Service (port 8081)

### Running Services Individually

#### API Gateway
```bash
./gradlew :backend:api-gateway-service:bootRun
```

#### Data Collection Service
```bash
./gradlew :backend:data-collection-service:bootRun
```

Make sure to set required environment variables:
- `CONSUL_HOST`: Consul server host (default: localhost)
- `CONSUL_PORT`: Consul server port (default: 8500)
- `DB_HOST`: PostgreSQL host (default: localhost)
- `DB_PORT`: PostgreSQL port (default: 5432)
- `DB_NAME`: Database name (default: newsinsight)
- `DB_USER`: Database user (default: postgres)
- `DB_PASSWORD`: Database password (default: postgres)

## Service Architecture

### API Gateway (`api-gateway-service`)
- Routes incoming requests to appropriate backend services
- Handles authentication and authorization via JWT
- Implements rate limiting using Redis
- Service discovery through Consul
- Port: 8000

### Data Collection Service (`data-collection-service`)
- Manages news sources and RSS feeds
- Collects and processes news articles
- Performs data validation and quality assurance
- Service discovery through Consul
- Port: 8081

### Shared Libraries (`shared-libs`)
- Common utilities and domain models
- Consul configuration support
- Validation utilities
- JSON processing utilities

## Configuration

Configuration is managed through multiple layers:

1. **Application YAML**: Default configuration in `src/main/resources/application.yml`
2. **Environment Variables**: Override defaults via environment variables
3. **Consul KV Store**: Centralized configuration management
4. **Environment Files**: Located in `etc/configs/` directory

### Consul Configuration

Services automatically register with Consul for service discovery. Configuration can be centrally managed in Consul's KV store under the `config/` prefix.

To seed Consul with initial configuration:
```bash
cd etc/scripts
./consul_seed.sh development
```

## Development

### Code Style
- Java: Follow Spring Boot conventions
- Frontend: ESLint configuration included

### Adding a New Service

1. Create service directory under `backend/`
2. Add service to `settings.gradle.kts`
3. Create `build.gradle.kts` for the service
4. Implement service with Spring Boot
5. Add Dockerfile if needed
6. Update `docker-compose.consul.yml` if deploying via Docker

### Running Tests
```bash
# All tests
./gradlew test

# Specific service tests
./gradlew :backend:api-gateway-service:test
```

## Documentation

Detailed documentation for each service can be found in the `docs/` directory:
- [Data Collection Service](docs/backend/data-collection-service/crawler/en/overview.md)
- API documentation available via Swagger UI when services are running

## Migration Notes

This project has been migrated from Python-based microservices to Spring Boot:
- See [SPRING_BOOT_MIGRATION_PLAN.md](etc/infra-guides/SPRING_BOOT_MIGRATION_PLAN.md) for migration details
- See [CONSUL_MIGRATION.md](etc/infra-guides/CONSUL_MIGRATION.md) for Consul configuration migration
- Legacy Python backends are archived in `archived-python-backends/`

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Run tests and ensure build passes
4. Submit a pull request

## License

[Add your license information here]
