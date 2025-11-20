# AI 쌀먹 API 문서

본 문서는 `api-gui.html`에 정의된 API 기능을 기준으로 정리되었습니다. 실제 호출 시 Base URL, 인증 헤더, 허용 모델 강제 등을 유의하세요.

---

## 기본 정보
- Base URL: 기본값 `https://ai-serve.nodove.com`
- 인증: 선택
  - 헤더 `Authorization: Bearer <YOUR_TOKEN>` (입력값에 `Bearer `가 없으면 자동으로 접두사 추가)
- 공통 헤더: `Content-Type: application/json`
- 허용 모델(강제 제한): `gpt-4.1`, `gpt-4o`
  - 모든 요청의 QueryString `model|modelId` 및 Body 내 `model|modelId`(대소문자/하이픈/언더스코어 변형 포함) 혹은 객체의 `id|name|model|modelId|modelID`에 대해 허용 모델만 사용 가능
  - 위 제한에 걸리면 요청이 클라이언트에서 차단됨
- 편의 동작: `/experimental/tool` 호출 시 Query에 `model`이 없으면 상단 선택 모델이 자동 추가됨
- 스트리밍: 채팅 스트리밍 시 `Accept: text/event-stream, text/plain;q=0.9, */*;q=0.1`

---

## 엔드포인트 개요

### Project
- GET `/project`
  - 설명: 프로젝트 목록 조회
- GET `/project/current`
  - 설명: 현재 프로젝트 조회

### Config
- GET `/config`
  - 설명: 서버 설정 조회
- PATCH `/config`
  - 설명: 서버 설정 부분 업데이트
  - Body: 유효한 JSON만 허용 (예: `{"key": "value"}`)

### Tools (Experimental)
- GET `/experimental/tool/ids`
  - 설명: 사용 가능한 도구 ID 목록
- GET `/experimental/tool`
  - 설명: 도구 목록 조회
  - Query:
    - `provider` (string) 예: `openai` (기본값 openai)
    - `model` (enum) `gpt-4.1 | gpt-4o` (미지정 시 상단 선택 모델 자동 적용)

### Path
- GET `/path`
  - 설명: 서버의 기본 서비스 경로 정보 조회

### Sessions
- GET `/session`
  - 설명: 세션 목록 조회
- POST `/session`
  - 설명: 세션 생성
  - Body: `{ "title": "..." }`
- GET `/session/{id}`
  - 설명: 특정 세션 조회
- DELETE `/session/{id}`
  - 설명: 특정 세션 삭제

### Chat
- POST `/session/{id}/message`
  - 설명: 세션에 메시지 전송 및 응답 수신
  - Body 예시:
    ```json
    {
      "providerID": "openai",
      "modelID": "gpt-4.1", // 또는 "gpt-4o"
      "parts": [
        { "type": "text", "text": "메시지 내용" }
      ]
    }
    ```
  - 비고:
    - 모델은 허용된 값(`gpt-4.1`, `gpt-4o`)만 가능
    - 스트리밍 모드(실험적): 동일 엔드포인트, `Accept` 헤더로 `text/event-stream` 지정하여 서버 전송

### Other
- GET `/command`
  - 설명: 사용 가능한 서버 명령 목록
- GET `/config/providers`
  - 설명: 등록된 AI Provider 목록
- GET `/agent`
  - 설명: 사용 가능한 에이전트 목록

### Advanced(템플릿 전용 포함)
- GET `/app`
  - 설명: 고급 요청 빌더 템플릿에 정의된 엔드포인트(상태/헬스 점검 용도 추정)
- 기타 템플릿: 위 섹션들의 엔드포인트를 빠르게 설정하기 위한 프리셋 제공

---

## 요청/응답 공통 규칙
- 요청 프리뷰: 클라이언트에서 `{ method, url, headers, body }`를 미리보기로 확인 가능
- 응답 표시: JSON 파싱 가능 시 들여쓰기된 JSON, 불가 시 원문 텍스트 표시
- 상태 표기: `Status: <code> <text> • <ms> ms`
- 오류 처리: 네트워크/파싱 오류 시 응답 영역에 에러 메시지 출력, 모델 제한 위반은 사전 차단

---

## 예시

### 세션 생성
```bash
curl -X POST "$BASE_URL/session" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"My Session"}'
```

### 채팅(비스트리밍)
```bash
curl -X POST "$BASE_URL/session/$SESSION_ID/message" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "providerID": "openai",
    "modelID": "gpt-4.1",
    "parts": [ { "type": "text", "text": "안녕하세요" } ]
  }'
```

### 도구 목록 조회
```bash
curl "$BASE_URL/experimental/tool?provider=openai&model=gpt-4.1" \
  -H "Authorization: Bearer $TOKEN"
```