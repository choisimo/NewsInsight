# NewsInsight Scripts

이 디렉터리에는 NewsInsight 프로젝트의 배포, 빌드, 정리를 위한 스크립트들이 포함되어 있습니다.

## 스크립트 목록

| 스크립트 | 용도 |
|----------|------|
| `start.sh` | 로컬/zerotrust 환경 선택 후 Docker 빌드 및 기동 |
| `deploy-remote.sh` | 원격 서버(production) 배포 |
| `clean-docker.sh` | Docker 컨테이너/볼륨 정리 |
| `clean-artifacts.sh` | 로컬 빌드 아티팩트 정리 (Docker 제외) |
| `build-and-push.sh` | Docker 이미지 빌드 및 GCP Artifact Registry 푸시 |
| `setup-cloudflare-dns.sh` | Cloudflare DNS 설정 |
| `status.sh` | 현재 실행 중인 컨테이너 상태 확인 |

---

## 1. `start.sh` - 환경 선택 및 기동

로컬 또는 zerotrust 환경을 선택하여 Docker Compose로 전체 스택을 빌드하고 기동합니다.

### 사용법

```bash
./scripts/start.sh
```

### 환경 선택 메뉴

```
==== NewsInsight Docker 환경 선택 ====
  1) zerotrust (Cloudflare Tunnel)
  2) consul (로컬 개발환경)
  3) production (원격 서버 배포용)
```

zerotrust 선택 시 추가 메뉴:

```
==== Zerotrust 배포 대상 선택 ====
  1) 기본(내부 테스트용)          - docker-compose.zerotrust.yml
  2) newsinsight.nodove.com     - docker-compose.zerotrust-newsinsight.yml
  3) news.nodove.com            - docker-compose.zerotrust-news.yml
  4) preview (zerotrust-preview) - docker-compose.zerotrust-preview.yml
```

### 풀 클린업 옵션

기동 전 "풀 클린업" 선택 시:
- 기존 컨테이너 중지
- 볼륨(데이터베이스 포함) 삭제
- Docker 빌드 캐시 정리
- 사용하지 않는 이미지/볼륨 정리

---

## 2. `deploy-remote.sh` - 원격 서버 배포

로컬에서 Docker 이미지를 빌드하고 GCP Artifact Registry에 푸시한 뒤,
원격 리눅스 서버에서 `docker-compose.production.yml`로 배포합니다.

### 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `DEPLOY_HOST` | ✅ | - | 원격 서버 호스트명 또는 IP |
| `DEPLOY_USER` | | `ubuntu` | SSH 사용자 |
| `DEPLOY_PATH` | | `/home/$DEPLOY_USER/NewsInsight` | 원격 서버의 프로젝트 경로 |

### 사용법

```bash
# 환경 변수 설정 후 실행
export DEPLOY_HOST=pmx-102-2
export DEPLOY_USER=ubuntu
export DEPLOY_PATH=/opt/NewsInsight

# 빌드 + 푸시 + 배포
./scripts/deploy-remote.sh

# 이미 빌드/푸시 완료된 경우, 배포만
./scripts/deploy-remote.sh --skip-build
```

### 옵션

- `--skip-build`: 로컬 빌드 및 이미지 푸시 생략
- `--host HOST`: DEPLOY_HOST 대신 직접 지정
- `--user USER`: DEPLOY_USER 대신 직접 지정
- `--path PATH`: DEPLOY_PATH 대신 직접 지정

---

## 3. `clean-docker.sh` - Docker 리소스 정리

NewsInsight 관련 Docker Compose 스택을 정리합니다.

### 대상 compose 파일

- `docker-compose.consul.yml`
- `docker-compose.zerotrust.yml`
- `docker-compose.zerotrust-preview.yml`
- `docker-compose.zerotrust-news.yml`
- `docker-compose.zerotrust-newsinsight.yml`
- `docker-compose.production.yml`

### 사용법

```bash
# NewsInsight 관련 컨테이너/볼륨만 정리
./scripts/clean-docker.sh

# + Docker 전역 리소스(builder cache, dangling images 등)까지 정리
./scripts/clean-docker.sh --full-prune
```

> ⚠️ `--full-prune` 옵션은 다른 Docker 프로젝트에도 영향을 줄 수 있습니다.

---

## 4. `clean-artifacts.sh` - 로컬 빌드 아티팩트 정리

Docker 리소스는 건드리지 않고, 리포지토리 내부의 빌드 산출물만 삭제합니다.

### 삭제 대상

- `frontend/node_modules`, `frontend/dist`
- `backend/*/build` (Gradle 출력물)
- `backend/**/__pycache__` (Python 캐시)
- `backend/admin-dashboard/web/node_modules`, `.next`

### 사용법

```bash
./scripts/clean-artifacts.sh
```

---

## 5. `build-and-push.sh` - Docker 이미지 빌드/푸시

모든 서비스의 Docker 이미지를 빌드하고 GCP Artifact Registry에 푸시합니다.

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GCP_PROJECT_ID` | `newsinsight-prod` | GCP 프로젝트 ID |
| `GCP_REGION` | `asia-northeast3` | Artifact Registry 리전 |
| `IMAGE_TAG` | `latest` | Docker 이미지 태그 |

### 사용법

```bash
# GCP 인증 필요
gcloud auth login
gcloud auth configure-docker asia-northeast3-docker.pkg.dev

# 빌드 및 푸시
./scripts/build-and-push.sh

# 특정 태그로 빌드
IMAGE_TAG=v1.0.0 ./scripts/build-and-push.sh
```

---

## 6. `status.sh` - 컨테이너 상태 확인

현재 실행 중인 NewsInsight 컨테이너 상태를 확인합니다.

```bash
./scripts/status.sh
```

---

## 일반적인 워크플로우

### 로컬 개발 환경 시작

```bash
./scripts/start.sh
# 2) consul 선택
```

### news.nodove.com 배포

```bash
./scripts/start.sh
# 1) zerotrust 선택
# 3) news.nodove.com 선택
```

### 클린 재시작

```bash
# Docker 리소스 정리
./scripts/clean-docker.sh

# 로컬 빌드 아티팩트 정리 (선택)
./scripts/clean-artifacts.sh

# 새로 시작
./scripts/start.sh
```

### 원격 프로덕션 배포

```bash
export DEPLOY_HOST=pmx-102-2
./scripts/deploy-remote.sh
```
