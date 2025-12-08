# NewsInsight GCP 배포 가이드

이 문서는 NewsInsight를 Google Cloud Platform에 배포하기 위한 설정 가이드입니다.

## 📋 목차

1. [사전 준비](#사전-준비)
2. [GCP 프로젝트 설정](#gcp-프로젝트-설정)
3. [GitHub Secrets 설정](#github-secrets-설정)
4. [GCP Secret Manager 설정](#gcp-secret-manager-설정)
5. [초기 배포](#초기-배포)
6. [도메인 및 SSL 설정](#도메인-및-ssl-설정)
7. [문제 해결](#문제-해결)

---

## 사전 준비

### 필요한 도구

```bash
# Google Cloud SDK 설치
curl https://sdk.cloud.google.com | bash
exec -l $SHELL
gcloud init

# kubectl 설치
gcloud components install kubectl

# kustomize 설치
curl -sfLo kustomize https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv5.3.0/kustomize_v5.3.0_linux_amd64.tar.gz
tar xzf kustomize
chmod +x kustomize
sudo mv kustomize /usr/local/bin/
```

---

## GCP 프로젝트 설정

### 1. 프로젝트 생성 및 설정

```bash
# 프로젝트 ID 설정 (고유해야 함)
export PROJECT_ID="newsinsight-prod"
export REGION="asia-northeast3"

# 프로젝트 생성
gcloud projects create ${PROJECT_ID} --name="NewsInsight Production"
gcloud config set project ${PROJECT_ID}

# 결제 계정 연결 (GCP Console에서 수동으로 설정 권장)
# gcloud billing accounts list
# gcloud billing projects link ${PROJECT_ID} --billing-account=BILLING_ACCOUNT_ID
```

### 2. 필수 API 활성화

```bash
gcloud services enable \
  container.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com \
  servicenetworking.googleapis.com \
  iam.googleapis.com
```

### 3. Artifact Registry 생성

```bash
gcloud artifacts repositories create newsinsight-repo \
  --repository-format=docker \
  --location=${REGION} \
  --description="NewsInsight Docker images"
```

### 4. 서비스 계정 생성

```bash
# CI/CD용 서비스 계정
gcloud iam service-accounts create github-actions-sa \
  --display-name="GitHub Actions Service Account"

# 필요한 역할 부여
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/container.developer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 키 파일 생성
gcloud iam service-accounts keys create gcp-sa-key.json \
  --iam-account=github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com

echo "⚠️  gcp-sa-key.json 파일을 GitHub Secrets에 GCP_SA_KEY로 저장하세요!"
```

### 5. GKE 클러스터 생성

```bash
# GKE Autopilot 클러스터 생성 (권장)
gcloud container clusters create-auto newsinsight-cluster \
  --region=${REGION} \
  --release-channel=regular

# kubectl 설정
gcloud container clusters get-credentials newsinsight-cluster \
  --region=${REGION}

# 네임스페이스 생성
kubectl create namespace newsinsight
kubectl create namespace newsinsight-staging
```

### 6. Cloud SQL (PostgreSQL) 설정

```bash
# Cloud SQL 인스턴스 생성
gcloud sql instances create newsinsight-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-4096 \
  --region=${REGION} \
  --storage-type=SSD \
  --storage-size=20GB \
  --backup-start-time=03:00 \
  --availability-type=REGIONAL

# 데이터베이스 생성
gcloud sql databases create newsinsight --instance=newsinsight-db

# 사용자 생성
gcloud sql users create newsinsight_user \
  --instance=newsinsight-db \
  --password=YOUR_SECURE_PASSWORD

# 연결 이름 확인
gcloud sql instances describe newsinsight-db --format='value(connectionName)'
```

### 7. Memorystore (Redis) 설정

```bash
gcloud redis instances create newsinsight-redis \
  --size=2 \
  --region=${REGION} \
  --tier=BASIC \
  --redis-version=redis_7_0

# Redis IP 확인
gcloud redis instances describe newsinsight-redis \
  --region=${REGION} \
  --format='value(host)'
```

### 8. 정적 IP 및 도메인 설정

```bash
# 글로벌 정적 IP 예약
gcloud compute addresses create newsinsight-ip \
  --global

# IP 주소 확인
gcloud compute addresses describe newsinsight-ip \
  --global --format='value(address)'

echo "이 IP를 도메인 DNS A 레코드에 설정하세요: news.nodove.com"
```

---

## GitHub Secrets 설정

GitHub 저장소 Settings > Secrets and variables > Actions에서 다음 시크릿들을 설정합니다:

### 필수 시크릿

| Secret 이름 | 설명 | 예시 값 |
|------------|------|---------|
| `GCP_PROJECT_ID` | GCP 프로젝트 ID | `newsinsight-prod` |
| `GCP_SA_KEY` | 서비스 계정 키 (JSON) | `gcp-sa-key.json` 파일 내용 전체 |
| `PRODUCTION_API_URL` | 프로덕션 API URL | `https://news.nodove.com` |

### 선택적 시크릿 (Consul 원격 시딩용)

| Secret 이름 | 설명 |
|------------|------|
| `REMOTE_HOST` | 원격 서버 호스트 |
| `REMOTE_USER` | SSH 사용자 |
| `REMOTE_SSH_PRIVATE_KEY` | SSH 개인키 |
| `REMOTE_DEPLOY_PATH` | 배포 경로 |
| `CONSUL_HTTP_ADDR` | Consul 주소 |
| `CONSUL_HTTP_TOKEN` | Consul 토큰 |

### 서비스 시크릿 (Consul 설정용)

| Secret 이름 | 설명 |
|------------|------|
| `API_GATEWAY_JWT_SECRET_KEY` | JWT 서명 키 |
| `COLLECTOR_SERVICE_DATABASE_URL` | PostgreSQL URL |
| `COLLECTOR_SERVICE_MONGODB_URI` | MongoDB URI |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `PERPLEXITY_API_KEY` | Perplexity API 키 |

---

## GCP Secret Manager 설정

### 시크릿 생성 스크립트

```bash
#!/bin/bash
# scripts/setup-gcp-secrets.sh

PROJECT_ID="newsinsight-prod"

# 시크릿 생성 함수
create_secret() {
  local name=$1
  local value=$2
  
  echo "Creating secret: $name"
  echo -n "$value" | gcloud secrets create $name \
    --replication-policy="automatic" \
    --data-file=- \
    --project=$PROJECT_ID 2>/dev/null || \
  echo -n "$value" | gcloud secrets versions add $name \
    --data-file=- \
    --project=$PROJECT_ID
}

# 데이터베이스
create_secret "newsinsight-db-password" "YOUR_DB_PASSWORD"
create_secret "newsinsight-mongodb-uri" "mongodb://mongo.example.com:27017/newsinsight"
create_secret "newsinsight-redis-password" ""

# 인증
create_secret "newsinsight-jwt-secret" "YOUR_JWT_SECRET_KEY"
create_secret "consul-token" ""

# AI API 키
create_secret "openai-api-key" "sk-YOUR_OPENAI_KEY"
create_secret "anthropic-api-key" "sk-ant-YOUR_ANTHROPIC_KEY"
create_secret "perplexity-api-key" "YOUR_PERPLEXITY_KEY"

# 검색 API 키 (선택)
create_secret "brave-search-api-key" "YOUR_BRAVE_KEY"
create_secret "tavily-api-key" "YOUR_TAVILY_KEY"

echo "✅ All secrets created!"
```

### Workload Identity 설정 (권장)

```bash
# GKE 서비스 계정과 GCP 서비스 계정 연결
gcloud iam service-accounts create newsinsight-workload \
  --display-name="NewsInsight Workload Identity"

# Secret Manager 접근 권한 부여
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:newsinsight-workload@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Cloud SQL 접근 권한 부여
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:newsinsight-workload@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

# Workload Identity 바인딩
gcloud iam service-accounts add-iam-policy-binding \
  newsinsight-workload@${PROJECT_ID}.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[newsinsight/newsinsight-sa]"
```

---

## 초기 배포

### 1. 수동 초기 배포

```bash
# 프로젝트 클론
cd /path/to/NewsInsight

# PROJECT_ID 치환 (실제 프로젝트 ID로 변경)
find k8s/ -type f -name "*.yaml" -exec sed -i 's/PROJECT_ID/newsinsight-prod/g' {} \;
find k8s/ -type f -name "*.yaml" -exec sed -i 's/\${PROJECT_ID}/newsinsight-prod/g' {} \;
find k8s/ -type f -name "*.yaml" -exec sed -i 's/\${REGION}/asia-northeast3/g' {} \;

# Docker 인증
gcloud auth configure-docker asia-northeast3-docker.pkg.dev

# 이미지 빌드 및 푸시
./scripts/build-and-push.sh

# Kubernetes 배포
cd k8s/overlays/staging
kustomize build . | kubectl apply -f -

# 상태 확인
kubectl get pods -n newsinsight-staging
kubectl get services -n newsinsight-staging
```

### 2. GitHub Actions를 통한 자동 배포

main 브랜치에 푸시하면 자동으로 배포됩니다:

```bash
git add .
git commit -m "feat: Deploy to GCP"
git push origin main
```

수동 배포 트리거:
1. GitHub 저장소 > Actions > "Deploy to GCP"
2. "Run workflow" 클릭
3. 환경(staging/production) 선택
4. 실행

---

## 도메인 및 SSL 설정

### 1. DNS 설정

도메인 관리자(예: Cloudflare, Route53)에서:

```
Type: A
Name: news (또는 @)
Value: [newsinsight-ip의 IP 주소]
TTL: Auto
```

### 2. SSL 인증서 확인

```bash
# Managed Certificate 상태 확인
kubectl describe managedcertificate newsinsight-cert -n newsinsight

# 상태가 "Active"가 될 때까지 대기 (최대 20분)
kubectl get managedcertificate newsinsight-cert -n newsinsight -w
```

### 3. Ingress 확인

```bash
# Ingress 상태 확인
kubectl describe ingress newsinsight-ingress -n newsinsight

# 외부 IP 확인
kubectl get ingress newsinsight-ingress -n newsinsight
```

---

## 문제 해결

### 일반적인 문제들

#### Pod가 시작되지 않음
```bash
# Pod 상태 확인
kubectl describe pod <pod-name> -n newsinsight

# 로그 확인
kubectl logs <pod-name> -n newsinsight

# 이벤트 확인
kubectl get events -n newsinsight --sort-by='.lastTimestamp'
```

#### 이미지 풀 실패
```bash
# Artifact Registry 권한 확인
gcloud artifacts repositories get-iam-policy newsinsight-repo \
  --location=asia-northeast3

# 서비스 계정에 권한 추가
gcloud artifacts repositories add-iam-policy-binding newsinsight-repo \
  --location=asia-northeast3 \
  --member="serviceAccount:${PROJECT_ID}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

#### Cloud SQL 연결 실패
```bash
# Cloud SQL 연결 이름 확인
gcloud sql instances describe newsinsight-db --format='value(connectionName)'

# Cloud SQL Proxy 로그 확인
kubectl logs <collector-pod> -c cloud-sql-proxy -n newsinsight
```

#### SSL 인증서가 발급되지 않음
```bash
# 도메인 DNS 확인
nslookup news.nodove.com

# 인증서 상태 확인
kubectl describe managedcertificate newsinsight-cert -n newsinsight
```

### 유용한 명령어

```bash
# 모든 리소스 상태 확인
kubectl get all -n newsinsight

# 로그 스트리밍
kubectl logs -f deployment/api-gateway -n newsinsight

# Pod 내부 접속
kubectl exec -it deployment/api-gateway -n newsinsight -- /bin/sh

# 리소스 재시작
kubectl rollout restart deployment/api-gateway -n newsinsight

# 이전 버전으로 롤백
kubectl rollout undo deployment/api-gateway -n newsinsight
```

---

## 비용 모니터링

```bash
# 예상 비용 확인
gcloud billing budgets list --billing-account=BILLING_ACCOUNT_ID

# 리소스 사용량 확인
gcloud monitoring metrics list --filter="resource.type=k8s_container"
```

---

## 참고 링크

- [GKE 문서](https://cloud.google.com/kubernetes-engine/docs)
- [Cloud SQL 문서](https://cloud.google.com/sql/docs)
- [Secret Manager 문서](https://cloud.google.com/secret-manager/docs)
- [Artifact Registry 문서](https://cloud.google.com/artifact-registry/docs)
