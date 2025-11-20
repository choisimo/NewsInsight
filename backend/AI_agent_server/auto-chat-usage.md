# Auto-Chat Proxy 사용 가이드

## 개요
세션 생성과 메시지 전송을 한 번의 API 호출로 자동화하는 프록시 서비스입니다.

## 실행 방법
```bash
docker-compose up -d auto-chat-proxy
```

## 엔드포인트
- **URL**: `http://localhost:7016/auto-chat`
- **메서드**: `POST`
- **포트**: 7016 (외부) → 7016 (내부)

## 요청 형식

### Body Parameters
```json
{
  "message": "안녕하세요",           // 필수: 전송할 메시지
  "title": "My Chat Session",      // 선택: 세션 제목 (기본값: "Auto Session")
  "providerID": "openai",          // 선택: AI Provider (기본값: "openai")
  "modelID": "gpt-4.1"             // 선택: 모델 ID (기본값: "gpt-4.1")
}
```

### 허용 모델
- `gpt-4.1`
- `gpt-4o`

## 사용 예시

### 기본 사용
```bash
curl -X POST http://localhost:7016/auto-chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "message": "코드 리뷰 부탁합니다"
  }'
```

### 세션 제목 지정
```bash
curl -X POST http://localhost:7016/auto-chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "Code Review Session",
    "message": "main.py 파일을 검토해주세요",
    "modelID": "gpt-4o"
  }'
```

### 응답 형식
```json
{
  "sessionId": "sess_abc123",
  "response": {
    // OpenCode AI 응답 내용
  }
}
```

## 장점

1. **단일 요청**: 세션 생성 + 메시지 전송을 한 번에 처리
2. **자동 세션 관리**: sessionId를 자동으로 생성하고 반환
3. **간편한 통합**: 외부 애플리케이션에서 쉽게 사용 가능
4. **에러 핸들링**: 세션 생성 실패 시 자동으로 에러 반환

## 기존 API와 비교

### 기존 방식 (2단계)
```bash
# 1단계: 세션 생성
SESSION_ID=$(curl -X POST https://ai-serve.nodove.com/session \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"My Session"}' | jq -r '.id')

# 2단계: 메시지 전송
curl -X POST https://ai-serve.nodove.com/session/$SESSION_ID/message \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "providerID": "openai",
    "modelID": "gpt-4.1",
    "parts": [{"type": "text", "text": "안녕하세요"}]
  }'
```

### 새로운 방식 (1단계)
```bash
curl -X POST http://localhost:7016/auto-chat \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "message": "안녕하세요"
  }'
```

## 환경 변수

docker-compose.yml에서 설정 가능:
- `OPENCODE_BASE`: OpenCode 서버 주소 (기본값: `http://opencode:7012`)
- `PROXY_PORT`: 프록시 포트 (기본값: `7016`)

## 보안 고려사항

- Authorization 헤더를 그대로 전달하므로 기존 인증 방식 유지
- CORS 헤더 포함으로 웹 브라우저에서도 호출 가능
- `no-new-privileges` 보안 옵션 적용
- 읽기 전용(`:ro`) 볼륨 마운트

## 트러블슈팅

### 프록시가 시작되지 않을 때
```bash
docker-compose logs auto-chat-proxy
```

### OpenCode 서버 연결 실패
- `OPENCODE_BASE` 환경 변수 확인
- `depends_on` 설정으로 opencode 서비스가 먼저 시작되는지 확인

### 모델 제한 오류
- `gpt-4.1` 또는 `gpt-4o`만 사용 가능
- api-info.md의 허용 모델 목록 참조
