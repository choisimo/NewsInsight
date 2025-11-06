# 크롤링 서비스 데이터 계약

## 워치 스키마

### WatchBase
워치 생성 및 수정 요청에서 공통으로 사용하는 필드입니다.
- `url` (string, uri, 필수): 모니터링 대상 URL, 최대 5000자
- `title` (string, 선택): 표시용 이름, 최대 5000자
- `tag` (string, 선택): 단일 태그 UUID
- `tags` (array[string], 선택): 여러 태그 UUID
- `paused` (boolean): 모니터링 일시정지 여부
- `muted` (boolean): 알림 음소거 여부
- `method` (string, enum: GET/POST/DELETE/PUT): 콘텐츠를 가져올 HTTP 메서드
- `fetch_backend` (string, enum: `html_requests`, `html_webdriver`): 수집 방식
- `headers` (object[string]): 사용자 정의 HTTP 헤더
- `body` (string, 선택): 요청 본문, 최대 5000자
- `proxy` (string, 선택): 프록시 식별자 또는 설정
- `webdriver_delay` (integer): webdriver 사용 시 지연(초)
- `webdriver_js_execute_code` (string): webdriver가 실행할 JS 코드, 최대 5000자
- `time_between_check` (object): 재검사 간격 설정 (`weeks`, `days`, `hours`, `minutes`, `seconds`)
- `notification_urls` (array[string]): 워치 전용 알림 엔드포인트 목록
- `notification_title` (string): 알림 제목, 최대 5000자
- `notification_body` (string): 알림 내용, 최대 5000자
- `notification_format` (string, enum: `Text`, `HTML`, `Markdown`): 알림 포맷
- `track_ldjson_price_data` (boolean): JSON-LD 기반 가격 추적 여부
- `browser_steps` (array[object]): 사전 브라우저 자동화 스텝. 각 스텝은 다음 필드 필수
  - `operation` (string)
  - `selector` (string)
  - `optional_value` (string)

### CreateWatch
- `WatchBase`를 상속하며 `url` 필드가 필수입니다.

### Watch
- `WatchBase` 확장 스키마로 다음 읽기 전용 필드가 추가됩니다.
  - `uuid` (string, uuid)
  - `last_checked` (integer): 마지막 점검 Unix 타임스탬프
  - `last_changed` (integer): 마지막 변경 Unix 타임스탬프
  - `last_error` (string): 마지막 오류 메시지
  - `last_viewed` (integer): 마지막 열람 시간 (0 이상)

## 태그 스키마
- `uuid` (string, uuid, 읽기 전용)
- `title` (string, 필수)
- `notification_urls` (array[string], 선택)
- `notification_muted` (boolean, 선택)

## NotificationUrls 스키마
- `notification_urls` (array[string uri], 필수): 완전 대체용 엔드포인트 목록

## SystemInfo 스키마
- `watch_count` (integer)
- `tag_count` (integer)
- `uptime` (string)
- `version` (string)

## SearchResult 스키마
- `watches` (object): UUID를 키로 하는 Watch 객체 맵

## WatchHistory 스키마
- 타임스탬프를 키로 하며 스냅샷 파일 경로(string)를 값으로 갖는 객체

## Error 스키마
- `message` (string): 오류 설명
