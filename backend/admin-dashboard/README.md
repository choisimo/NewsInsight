# NewsInsight Admin Dashboard

통합 TUI/Web Admin 대시보드 - 다양한 환경의 설정, 배포, 문서를 한 곳에서 관리합니다.

## 🎯 주요 기능

### Phase 1 (MVP) - 현재 구현됨
- **환경 관리**: zerotrust/local/production/staging 환경 조회 및 상태 확인
- **스크립트 실행**: 등록된 스크립트를 선택하여 실행, 실시간 로그 스트리밍
- **문서 뷰어**: Markdown 문서 조회 및 검색
- **인증/권한**: JWT 기반 인증, RBAC (Viewer/Operator/Admin)
- **감사 로그**: 모든 작업 이력 기록 및 조회

### Phase 2 (예정)
- 환경 변수 CRUD (마스킹, diff, 이력)
- 스크립트/워크플로우 등록/편집 UI
- 권한/역할 시스템 고도화

### Phase 3 (예정)
- TUI 클라이언트
- 롤백 지원
- 모니터링 연동 (Prometheus, Loki)

## 🚀 빠른 시작

### 1. Docker Compose로 실행 (권장)

```bash
cd backend/admin-dashboard
docker compose up -d
```

- **Web UI**: http://localhost:3001
- **API**: http://localhost:8888
- **API Docs**: http://localhost:8888/api/v1/admin/docs

### 2. 로컬 개발 환경

#### API 서버
```bash
cd backend/admin-dashboard
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn api.main:app --reload --port 8888
```

#### Web UI
```bash
cd backend/admin-dashboard/web
npm install
npm run dev
```

## 🔐 기본 계정

| 사용자명 | 비밀번호 | 역할 |
|---------|---------|------|
| admin | admin123 | Admin |

⚠️ **운영 환경에서는 반드시 비밀번호를 변경하세요!**

## 📁 프로젝트 구조

```
backend/admin-dashboard/
├── api/                    # FastAPI 백엔드
│   ├── main.py            # 앱 엔트리포인트
│   ├── dependencies.py    # 의존성 주입
│   ├── models/            # Pydantic 스키마
│   ├── routers/           # API 라우터
│   └── services/          # 비즈니스 로직
├── web/                    # React 프론트엔드
│   ├── src/
│   │   ├── api/           # API 클라이언트
│   │   ├── components/    # 공통 컴포넌트
│   │   ├── contexts/      # React Context
│   │   ├── pages/         # 페이지 컴포넌트
│   │   └── types/         # TypeScript 타입
│   └── package.json
├── config/                 # 설정 파일 (자동 생성)
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## 🔧 환경 변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `PORT` | API 서버 포트 | 8888 |
| `PROJECT_ROOT` | 프로젝트 루트 경로 | 자동 감지 |
| `ADMIN_CONFIG_DIR` | 설정 파일 디렉토리 | ./config |
| `ADMIN_SECRET_KEY` | JWT 시크릿 키 | 랜덤 생성 |
| `CORS_ORIGINS` | 허용된 CORS 오리진 | localhost |

## 📡 API 엔드포인트

### 인증
- `POST /api/v1/admin/auth/token` - 로그인
- `GET /api/v1/admin/auth/me` - 현재 사용자 정보

### 환경
- `GET /api/v1/admin/environments` - 환경 목록
- `GET /api/v1/admin/environments/{id}/status` - 환경 상태
- `POST /api/v1/admin/environments/{id}/up` - 서비스 시작
- `POST /api/v1/admin/environments/{id}/down` - 서비스 중지
- `POST /api/v1/admin/environments/{id}/restart` - 서비스 재시작

### 스크립트
- `GET /api/v1/admin/scripts` - 스크립트 목록
- `POST /api/v1/admin/scripts/execute` - 스크립트 실행
- `POST /api/v1/admin/scripts/execute/stream` - 스크립트 실행 (스트리밍)

### 문서
- `GET /api/v1/admin/documents` - 문서 목록
- `GET /api/v1/admin/documents/{id}` - 문서 상세

### 감사 로그
- `GET /api/v1/admin/audit/logs` - 감사 로그 조회
- `GET /api/v1/admin/audit/statistics` - 통계

## 🔒 권한 체계

| 역할 | 권한 |
|------|------|
| **Viewer** | 조회만 가능 |
| **Operator** | 조회 + 배포/재시작 실행 |
| **Admin** | 모든 권한 (설정 변경, 사용자 관리, 위험 작업) |

## 🛡️ 보안 고려사항

1. **비밀번호 변경**: 기본 admin 계정 비밀번호를 반드시 변경
2. **시크릿 키**: `ADMIN_SECRET_KEY` 환경 변수를 안전한 값으로 설정
3. **네트워크 제한**: 내부 네트워크/VPN에서만 접근 가능하도록 설정
4. **HTTPS**: 프로덕션에서는 반드시 HTTPS 사용

## 📝 라이선스

MIT License
