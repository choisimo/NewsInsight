# NewsInsight Production Deployment Guide (pmx-102-2)

이 문서는 NewsInsight를 pmx-102-2 원격 서버에 배포하고 `newsinsight.nodove.com`으로 접근할 수 있도록 설정하는 방법을 설명합니다.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Cloudflare Edge                                │
├─────────────────────────────────────────────────────────────────────────┤
│  news.nodove.com (로컬 개발)      newsinsight.nodove.com (프로덕션)      │
│         │                                    │                           │
│         ▼                                    ▼                           │
│   Tunnel: ed317942-...              Tunnel: [NEW_TUNNEL_ID]             │
│         │                                    │                           │
└─────────┼────────────────────────────────────┼───────────────────────────┘
          │                                    │
          ▼                                    ▼
   ┌──────────────┐                    ┌──────────────┐
   │  Local Dev   │                    │  pmx-102-2   │
   │  (news.*)    │                    │(newsinsight*)│
   └──────────────┘                    └──────────────┘
```

## Prerequisites

### 1. GitHub Repository Secrets 설정

GitHub Repository → Settings → Secrets and variables → Actions에서 다음 시크릿을 추가합니다:

#### 서버 접속 정보
| Secret Name | Description | Example |
|-------------|-------------|---------|
| `PMX102_HOST` | 서버 IP 또는 hostname | `192.168.1.100` |
| `PMX102_USER` | SSH 접속 사용자 | `deploy` |
| `PMX102_SSH_PRIVATE_KEY` | SSH Private Key (전체 내용) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

#### 데이터베이스 credentials
| Secret Name | Description | Example |
|-------------|-------------|---------|
| `PROD_POSTGRES_PASSWORD` | PostgreSQL 비밀번호 | `secure_postgres_password_123` |
| `PROD_MONGO_PASSWORD` | MongoDB 비밀번호 | `secure_mongo_password_123` |
| `PROD_REDIS_PASSWORD` | Redis 비밀번호 | `secure_redis_password_123` |

#### API Keys
| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AIDOVE_API_KEY` | AI Dove API 키 | `your-aidove-api-key` |
| `CRAWL4AI_API_TOKEN` | Crawl4AI API 토큰 | `newsinsight-crawler` |
| `CLOUDFLARE_TUNNEL_TOKEN_PROD` | Cloudflare Tunnel 토큰 | `eyJhIjoiZjZmMT...` |

### 2. pmx-102-2 서버 준비

```bash
# 1. SSH 접속
ssh user@pmx-102-2

# 2. Docker 설치 확인
docker --version
docker compose version

# 3. 배포 디렉토리 생성
mkdir -p ~/newsinsight/etc/docker

# 4. Deploy 사용자 생성 (선택사항)
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG docker deploy

# 5. SSH 키 설정
sudo mkdir -p /home/deploy/.ssh
sudo cp ~/.ssh/authorized_keys /home/deploy/.ssh/
sudo chown -R deploy:deploy /home/deploy/.ssh
```

## Cloudflare Tunnel 설정

### 1. 새 터널 생성

Cloudflare Dashboard에서:

1. **Zero Trust** → **Networks** → **Tunnels** 이동
2. **Create a tunnel** 클릭
3. **Tunnel name**: `newsinsight-production`
4. **Connector type**: `cloudflared`
5. 토큰을 복사하여 GitHub Secrets에 `CLOUDFLARE_TUNNEL_TOKEN_PROD`로 저장

### 2. 터널 라우팅 설정

Tunnel 설정에서 Public Hostname 추가:

| Hostname | Service | Path |
|----------|---------|------|
| `newsinsight.nodove.com` | `http://172.20.0.20:8000` | `/api/*` |
| `newsinsight.nodove.com` | `http://172.20.0.30:80` | `*` |

또는 CLI로 설정:

```bash
# 터널 라우팅 설정
cloudflared tunnel route dns newsinsight-production newsinsight.nodove.com
```

### 3. DNS 설정 확인

Cloudflare Dashboard → DNS에서:

```
Type: CNAME
Name: newsinsight
Content: [TUNNEL_ID].cfargotunnel.com
Proxied: Yes (Orange Cloud)
```

## Deployment

### 자동 배포 (GitHub Actions)

main 브랜치에 push하면 자동으로 배포됩니다:

```bash
git add .
git commit -m "Deploy to production"
git push origin main
```

### 수동 배포 트리거

1. GitHub → Actions → **Deploy to Production (pmx-102-2)** 선택
2. **Run workflow** 클릭
3. 옵션 선택:
   - `services`: 배포할 서비스 (예: `frontend,api-gateway` 또는 `all`)
   - `force_rebuild`: 캐시 없이 빌드

### 특정 서비스만 배포

```bash
# workflow_dispatch로 특정 서비스만 배포
# GitHub Actions UI에서:
# services: frontend,api-gateway
```

## 서버에서 직접 관리

### 서비스 상태 확인

```bash
ssh user@pmx-102-2
cd ~/newsinsight/etc/docker
docker compose -f docker-compose.production.yml ps
```

### 로그 확인

```bash
# 모든 로그
docker compose -f docker-compose.production.yml logs -f

# 특정 서비스 로그
docker compose -f docker-compose.production.yml logs -f api-gateway
```

### 서비스 재시작

```bash
# 전체 재시작
docker compose -f docker-compose.production.yml restart

# 특정 서비스 재시작
docker compose -f docker-compose.production.yml restart api-gateway
```

### 수동 배포

```bash
cd ~/newsinsight/etc/docker

# 최신 이미지 풀
docker compose -f docker-compose.production.yml pull

# 서비스 업데이트
docker compose -f docker-compose.production.yml up -d
```

## Environment Files

### 서버의 .env 파일 위치

```
~/newsinsight/etc/docker/.env
```

### .env 파일 구조

```env
# Docker Registry
REGISTRY=ghcr.io/[owner]
TAG=latest

# Cloudflare
CLOUDFLARE_TUNNEL_TOKEN_PROD=eyJhIjoiZjZm...

# Database
POSTGRES_DB=newsinsight
POSTGRES_USER=newsinsight
POSTGRES_PASSWORD=...

MONGO_USER=newsinsight
MONGO_PASSWORD=...

REDIS_PASSWORD=...

# API Keys
AIDOVE_API_KEY=...
AIDOVE_API_BASE_URL=https://ai.nodove.com
CRAWL4AI_API_TOKEN=...
```

## Network Configuration

### 내부 IP 할당

| Service | IP Address |
|---------|------------|
| cloudflared | 172.20.0.2 |
| postgres | 172.20.0.10 |
| mongo | 172.20.0.11 |
| redis | 172.20.0.12 |
| consul | 172.20.0.13 |
| redpanda | 172.20.0.14 |
| api-gateway | 172.20.0.20 |
| collector-service | 172.20.0.21 |
| browser-use-api | 172.20.0.22 |
| web-crawler | 172.20.0.23 |
| autonomous-crawler | 172.20.0.24 |
| frontend | 172.20.0.30 |
| sentiment-addon | 172.20.0.40 |
| factcheck-addon | 172.20.0.41 |
| bias-addon | 172.20.0.42 |

### 포트 매핑

프로덕션 환경에서는 외부 포트를 노출하지 않습니다. 모든 접근은 Cloudflare Tunnel을 통해 이루어집니다.

## Troubleshooting

### 1. 서비스가 시작되지 않음

```bash
# 로그 확인
docker compose -f docker-compose.production.yml logs [service-name]

# 컨테이너 상태 확인
docker ps -a

# 리소스 확인
docker stats
```

### 2. Cloudflare Tunnel 연결 문제

```bash
# 터널 로그 확인
docker logs newsinsight-prod-cloudflared

# 터널 상태 확인 (Cloudflare Dashboard에서)
# Zero Trust → Networks → Tunnels → [tunnel-name]
```

### 3. 데이터베이스 연결 실패

```bash
# PostgreSQL 확인
docker exec newsinsight-prod-postgres pg_isready -U newsinsight

# MongoDB 확인
docker exec newsinsight-prod-mongo mongosh --eval "db.adminCommand('ping')"

# Redis 확인
docker exec newsinsight-prod-redis redis-cli -a $REDIS_PASSWORD ping
```

### 4. 이미지 풀 실패

```bash
# GHCR 로그인 확인
docker login ghcr.io

# 수동으로 이미지 풀
docker pull ghcr.io/[owner]/newsinsight/frontend:latest
```

## Rollback

### 이전 버전으로 롤백

```bash
# 특정 버전으로 롤백
export TAG=[previous-commit-sha]
docker compose -f docker-compose.production.yml up -d

# 또는 특정 run number로
export TAG=[run-number]
docker compose -f docker-compose.production.yml up -d
```

## Monitoring

### Health Check Endpoints

| Service | Endpoint |
|---------|----------|
| API Gateway | `http://localhost:8000/actuator/health` |
| Collector | `http://localhost:8081/actuator/health` |
| Browser-Use | `http://localhost:8500/health` |
| Crawler | `http://localhost:9090/health` |

### 외부 접근 테스트

```bash
# Frontend
curl -I https://newsinsight.nodove.com

# API Health
curl https://newsinsight.nodove.com/api/actuator/health

# API Config
curl https://newsinsight.nodove.com/api/v1/config/frontend
```

## ML Addons (Optional)

ML Addons를 활성화하려면:

```bash
docker compose -f docker-compose.production.yml --profile ml-addons up -d
```

## Security Notes

1. **SSH Keys**: 배포 전용 SSH 키 사용 권장
2. **Secrets**: 절대 코드에 하드코딩하지 않음
3. **Network**: 모든 서비스는 내부 네트워크에서만 통신
4. **Tunnel**: 외부 접근은 Cloudflare Tunnel을 통해서만 허용
5. **Passwords**: 강력한 비밀번호 사용 (최소 20자, 특수문자 포함)

## Related Files

- `.github/workflows/deploy-pmx102.yml` - GitHub Actions 워크플로우
- `etc/docker/docker-compose.production.yml` - Docker Compose 설정
- `etc/docker/cloudflared-config.yml` - Cloudflare Tunnel 설정 (로컬)
