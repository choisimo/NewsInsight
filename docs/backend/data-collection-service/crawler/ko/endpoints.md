# 크롤링 서비스 API 엔드포인트

> ⚠️ **주의 (2025-11-20 기준)**
>
> 이 문서는 changedetection.io 기반 크롤링 서비스의 HTTP 엔드포인트를 설명합니다.
> 현재 `data-collection-service` 구현은 Crawl4AI의 `/crawl` 엔드포인트만 호출하며,
> 아래에 정의된 watch/tag/notification API를 직접 사용하지 않습니다.
> 대체/레거시 설계 참고용으로 활용해 주세요.

모든 엔드포인트는 기본 경로 `/api/v1/` 하위에서 제공되며, 별도 안내가 없는 한 유효한 API 키를 담은 `x-api-key` 헤더가 필요합니다.

## 워치 관리

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/watch` | 등록된 모든 워치 목록을 간단 정보로 조회합니다. `recheck_all=1`로 전체 재검사를 강제하거나 `tag=<name>`으로 태그 필터링 가능. |
| POST | `/watch` | 새로운 워치를 생성합니다. 대상 페이지 URL이 최소 요구 사항입니다. |
| GET | `/watch/{uuid}` | 특정 워치의 상세 정보를 조회합니다. `recheck=1`로 재검사, `paused=<value>`로 일시정지 제어, `muted=<value>`로 알림 음소거 제어 가능. |
| PUT | `/watch/{uuid}` | 워치 전체 스키마 payload를 전달해 기존 워치를 갱신합니다. |
| DELETE | `/watch/{uuid}` | 워치를 영구 삭제합니다. |

### 워치 요청/응답 형식
- **요청 본문 (POST/PUT)**: `CreateWatch`/`Watch` 스키마에 맞는 JSON
  ```json
  {
    "url": "https://example.com",
    "title": "Example Monitor",
    "time_between_check": {"hours": 1}
  }
  ```
- **주요 응답**:
  - `GET /watch` → 200, 워치 객체 맵
  - `POST /watch` → 200, 텍스트 `"OK"`
  - `GET /watch/{uuid}` → 200, 워치 JSON 또는 상태 문자열
  - `PUT /watch/{uuid}` → 200, `"OK"`
  - `DELETE /watch/{uuid}` → 200, `"DELETED"`

## 워치 히스토리 & 자산

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/watch/{uuid}/history` | 해당 워치에 저장된 모든 타임스탬프와 스냅샷 경로를 조회합니다. |
| GET | `/watch/{uuid}/history/{timestamp}` | 특정 시점의 스냅샷 데이터를 텍스트/HTML 형태로 반환합니다. |
| GET | `/watch/{uuid}/favicon` | 워치에 연관된 파비콘 이미지를 바이너리로 다운로드합니다. |

## 태그 / 그룹 관리

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/tags` | 모든 태그/그룹을 알림 설정과 함께 조회합니다. |
| POST | `/tag` | 최소 `title` 값으로 새로운 태그를 생성합니다. |
| GET | `/tag/{uuid}` | 태그 정보를 조회합니다. `muted=<value>` 로 알림 상태 조정, `recheck=1` 로 태그 내 모든 워치 재검사 큐잉 가능. |

## 알림 관리

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/notifications` | 서비스 전역 알림 엔드포인트 목록을 조회합니다. |
| POST | `/notifications` | `notification_urls` 배열을 전달해 전역 알림 엔드포인트를 설정/교체합니다. |

## 검색

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/search` | URL 패턴, 태그, 음소거/일시정지 상태 등으로 워치를 필터링하여 UUID 기반 맵으로 반환합니다. |

## 대량 등록

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/import` | 여러 URL을 한 번에 등록합니다. 개행으로 구분된 텍스트 본문을 사용하며, `tag_uuids`, `tag`, `proxy`, `dedupe`(기본 `true`) 쿼리 파라미터 지원. 응답은 생성된 워치 UUID 배열. |

## 시스템 정보

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/systeminfo` | 워치/태그 수, 가동 시간, 애플리케이션 버전 등 상위 지표를 제공합니다. |
