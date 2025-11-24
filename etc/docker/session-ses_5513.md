# Planning AI Agent Debates, Cold Start RAG, and Debate API Expansion

**Session ID:** ses_5513dea45ffe7p9R1WmSxd38n1
**Created:** 11/23/2025, 12:29:06 PM
**Updated:** 11/23/2025, 12:33:20 PM

---

## User

요청하신 건을 정리하면, 지금 코드베이스에 이미 있는 통계/분석 엔드포인트와 인프라(Kafka, MongoDB 등)를 최대한 활용해서:

- 단일 요약형 Perplexity 응답 → 찬/반/중립 구조화 분석
- Cold Start 시 실시간 크롤링 + AI Agent 토론 구조
- 결과를 대시보드/팩트 중심 뷰로 보여주는 것

까지 이어지는 **구체적인 실행 계획서**를 원하시는 거죠.

이를 위해 먼저 현재 백엔드에 구현돼 있는 분석 관련 컨트롤러/DTO들을 실제 코드에서 확인한 뒤, 각 단계(Agent 개편, RAG/크롤링, 데이터 모델 확장, UI 연동)에 맞춰 “어떤 엔드포인트/서비스를 어떻게 확장할지”를 구체적으로 연결해서 설계안을 드리겠습니다.

아키텍처 문서·현재 코드 기반으로, **지금 있는 엔드포인트/서비스를 그대로 활용하면서** 단계적으로 “구조적 분석 + Factfulness” 쪽으로 확장하는 설계안을 정리하겠습니다.

---

# 1. 현재 분석 파이프라인 정리 (현 코드 기준)

이미 구현된 흐름은 다음과 같습니다.

- `GET /api/v1/analysis` (`AnalysisController#getAnalysis`)
  - `AnalysisService#analyze(query, window)` 호출
  - 내부 동작:
    - `AiMessagingService.sendAnalysisRequest(...)`  
      → Kafka `newsinsight.ai.requests` 로 `AiRequestMessage` 발행 (타입: `"ARTICLE_ANALYSIS"`)
    - `CollectedDataRepository.searchByQueryAndSince(...)` 로 PostgreSQL에서 기사 조회
    - `qualityScore` 기반 간이 감성 집계 → `SentimentDataDto(pos,neg,neu)`
    - `extractTopKeywords(...)` 로 TF 기반 키워드 추출
    - `AnalysisResponseDto` 반환
- `GET /api/v1/articles`  
  - `CollectedData` → `ArticleDto` 로 맵핑 (제목/출처/발행일/url/snippet)
- `GET /api/v1/analysis/live`  
  - [LiveAnalysisController](cci:2://file:///home/nodove/workspace/NewsInsight/backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/LiveAnalysisController.java:12:0-50:1) 에서 Perplexity SSE 스트리밍 (지금은 텍스트 에세이 형태)

즉:
- 통계·키워드·기초 감성은 **`AnalysisService` + `CollectedData`** 쪽에서,
- 고급 요약/에이전트 분석은 **Kafka → AI_agent_server → (아직 활용 미흡)** 구조입니다.

이걸 기반으로, 아래처럼 확장하는 계획을 제안드립니다.

---

# 2. Step 1 – AI Agent 다중 페르소나 구조 (찬/반/중재) 설계

## 2.1 메시지 스키마 확장 (AiRequestMessage / AiResponseMessage)

### AiRequestMessage (producer: `AiMessagingService`)

현재 필드(추정): `requestId, type, query, window, message, context, providerId, modelId`.

**추가 필드 제안:**

- `agentRole`: `"PRO" | "CON" | "MEDIATOR"`
- `outputSchema`: `"DEBATE_V1"` 등 (JSON 스키마 식별자)
- `source`: `"collector-service"` (추후 다른 서비스와 구분)

`AnalysisService#analyze` 에서:

```java
String baseMessage = normalizedQuery != null ? normalizedQuery : "";
Map<String, Object> baseCtx = Map.of("window", effectiveWindow);

String reqPro = aiMessagingService.sendAnalysisRequestWithRole(
    normalizedQuery, effectiveWindow, baseMessage, baseCtx, "PRO");
String reqCon = aiMessagingService.sendAnalysisRequestWithRole(
    normalizedQuery, effectiveWindow, baseMessage, baseCtx, "CON");
String reqMed = aiMessagingService.sendAnalysisRequestWithRole(
    normalizedQuery, effectiveWindow, baseMessage, 
    Map.of("proRequestId", reqPro, "conRequestId", reqCon), "MEDIATOR");
```

→ `AiMessagingService` 에 `sendAnalysisRequestWithRole(...)` 오버로드 추가.

### AiResponseMessage (consumer: AI_agent_server → MongoDB 저장)

새 스키마 예:

```json
{
  "request_id": "uuid",
  "agent_role": "PRO",
  "query": "두더지",
  "window": "7d",
  "created_at": "2025-11-23T...",
  "structured_analysis": {
    "key_points": [
      { "title": "...", "stance": "pro", "summary": "...", "article_ids": [ "...", "..." ] }
    ],
    "claims": [
      {
        "claim_id": "hash",
        "text": "...",
        "stance": "pro",
        "supporting_urls": ["..."],
        "opposing_urls": ["..."],
        "fact_score": 0.82
      }
    ],
    "key_facts": [
      { "text": "...", "source": "통계청", "url": "..." }
    ]
  },
  "raw_text": "LLM 응답 전문"
}
```

- 저장 위치: MongoDB 컬렉션 `ai_analysis_results`
- 인덱스: `query + window`, `request_id`, `agent_role`

AI_agent_server(Go)는:

- Kafka `newsinsight.ai.requests` consume
- 역할별 Prompt:
  - PRO: “주제에 대한 지지/긍정 논리를 JSON 스키마 DEBATE_V1로…”
  - CON: “…우려/비판 논리만…”
  - MEDIATOR: “PRO/CON 응답을 가져와 공통점/불일치/검증 가능한 팩트만 종합…”

---

## 2.2 Collector-service에서 결과 조회용 API 추가

AI_agent_server는 Kafka → Mongo 까지만 책임지고,  
**collector-service** 가 Mongo를 읽어서 REST로 노출합니다.

### 새 엔드포인트

- `GET /api/v1/analysis/debate`
  - 파라미터: `query`, `window` (기본 7d)
  - 반환 DTO (예): `DebateAnalysisResponseDto`

```java
public record DebatePointDto(
    String title,
    String stance,            // "pro" | "con" | "neutral"
    String summary,
    List<String> articleIds,
    List<String> urls
) {}

public record DebateSummaryDto(
    List<DebatePointDto> pros,
    List<DebatePointDto> cons,
    List<DebatePointDto> neutral,
    List<String> keyFacts,             // 자연어 문장 리스트
    double proRatio,
    double conRatio,
    double neutralRatio
) {}
```

- 구현:
  - `DebateAnalysisService` 가 Mongo `ai_analysis_results` 에서
    - 가장 최근 `MEDIATOR` 문서를 기준으로 pros/cons/neutral 집계
    - 필요 시 `PRO`/`CON` 문서에서 보강

- 프론트는 `/analysis` 의 통계 + `/analysis/debate` 의 구조 분석을 함께 사용.

---

# 3. Step 2 – Cold Start Hybrid RAG & 실시간 크롤링

현재:

- `AnalysisService#analyze` 는 기사 개수 0이어도 그냥 감성 0,0,1 로 돌려줍니다.
- 프론트에서는 `article_count === 0` 일 때 Perplexity SSE fallback ([openLiveAnalysisStream](cci:1://file:///home/nodove/workspace/NewsInsight/frontend/src/lib/api.ts:74:0-84:2)) 을 사용.

### 3.1 analyze()에 Cold Start 분기 추가

```java
Page<CollectedData> page = collectedDataRepository.searchByQueryAndSince(...);
long articleCount = page.getTotalElements();

if (articleCount == 0) {
    // 1) Cold-start 크롤링 job 생성
    String crawlJobId = coldStartService.startOnDemandCrawl(normalizedQuery, effectiveWindow);

    // 2) AI Agent Hybrid RAG 요청 (외부 웹 + 향후 로컬 데이터 통합)
    String aiRequestIdPro = aiMessagingService.sendAnalysisRequestWithRole(... "PRO");
    ...

    // 3) Response DTO에 cold-start 상태/참조 ID 포함
    return new AnalysisResponseDto(
        query,
        effectiveWindow,
        0L,
        sentimentsFallback,
        List.of(),
        analyzedAt,
        /* 신규 필드 예: */ coldStart = true,
        crawlJobId,
        List.of(aiRequestIdPro, aiRequestIdCon, aiRequestIdMed)
    );
}
```

> `AnalysisResponseDto` 에 optional 필드 추가:
> - `boolean coldStart`
> - `String crawlJobId`
> - `List<String> aiRequestIds`

### 3.2 On-Demand 크롤링: 기존 CollectionService 재사용

이미 `CollectionController`에:

- `POST /api/v1/collections/jobs`  
- `POST /api/v1/collections/jobs/{id}/cancel`
- `GET /api/v1/collections/stats`

가 있으니, `ColdStartService` 에서:

- 내부적으로 `CollectionService.createJob(query, force=true)` 같은 메서드를 만들거나 확장
- “force 플래그”를 추가해서 스케줄 대신 즉시 실행 큐에 넣도록 구현
- Kafka 토픽 (crawl 요청/결과)이 이미 있다면 그 위에 태웁니다.

### 3.3 프론트 UI 피드백과 RAG 통합

[Index.tsx](cci:7://file:///home/nodove/workspace/NewsInsight/frontend/src/pages/Index.tsx:0:0-0:0) 의 `analysisData.article_count === 0` 분기에서:

- 텍스트:
  - “로컬 데이터가 없습니다” →  
    “**실시간으로 새로운 데이터와 외부 정보를 수집·분석 중입니다 (약 10초 소요).**”
- 상태:
  - `coldStart` 가 true 면
    - “실시간 웹 분석(Perplexity)” 결과
    - + 이후 `/api/v1/analysis/debate` / `/api/v1/articles` 를 주기적으로 재호출하여 로컬 데이터가 생기면 UI 전환

---

# 4. Step 3 – 구조화된 분석/시각화 API 확장

`AnalysisService` 쪽에 이미 통계/키워드/시간정보가 있으므로, 그대로 확장 가능합니다.

## 4.1 타임라인 (Evolution Timeline)

### 백엔드

- `CollectedData` 의 `publishedDate`, `collectedAt` 이미 사용 중.
- `AnalysisService` 또는 별도 `TimelineService` 에:

```java
public List<TimelinePointDto> getSentimentTimeline(String query, String window) {
    // window 범위 내에서 일자별 group by
    // qualityScore → pos/neg/neu 집계
}
```

- 새 엔드포인트:
  - `GET /api/v1/analysis/timeline?query=...&window=7d`

```java
public record TimelinePointDto(
    String date,            // "2025-11-22"
    double pos,
    double neg,
    double neu,
    long articleCount
) {}
```

### 프론트

- 새로운 그래프 컴포넌트 (line chart) 추가
- Perplexity/Agent 결과와는 별도로 “실제 기사 기반 여론 변화”를 시각화

## 4.2 출처 편향 태깅

### 데이터 모델

- `DataSource` 엔티티에 태그 필드 추가:
  - `biasTag`: `"progressive" | "conservative" | "tech" | ...`
- 초기에는 수동 세팅, 이후 AI_agent_server가 자동 태깅 가능

### API

- `ArticleDto` 에 `sourceBias` 필드 추가
- `AnalysisResponseDto` 에 `sourceBiasSummary` 같은 집계 DTO 추가:

```java
public record SourceBiasSummaryDto(
    String biasTag,
    long articleCount,
    double avgQualityScore
) {}
```

- `AnalysisService.analyze` 내에서 group by `DataSource.biasTag`

---

# 5. Step 4 – Claim / Evidence 기반 Factfulness 모델

MongoDB를 활용하면 Claim 중심 구조를 유연하게 설계할 수 있습니다.

## 5.1 Claim 엔티티 (Mongo)

컬렉션: `news_claims`

```json
{
  "claim_id": "hash-of-text",
  "text": "두더지는 농작물 피해를 일으키는 유해동물이다",
  "topic": "두더지",
  "stance": "con",
  "first_seen_at": "...",
  "last_seen_at": "...",
  "occurrences": [
    {
      "article_id": "...",
      "url": "...",
      "source_name": "...",
      "published_at": "...",
      "quoted_as": "headline|body|opinion"
    }
  ],
  "evidence_summary": "여러 기사에서는 ...",
  "fact_check_score": 0.73
}
```

AI_agent_server:

- 각 기사나 debate 결과에서 Claim 후보를 추출
- `claim_id` (e.g. SHA256(text normalized)) 기반으로 upsert
- “인용 횟수”는 `occurrences[].length` 로 쉽게 계산

## 5.2 API & UI 활용

- `GET /api/v1/analysis/claims?query=...`
  - 주요 Claim 리스트 + 인용 횟수 + fact_check_score 제공
- UI:
  - “핵심 주장 카드” 리스트
  - 각 카드에:
    - 주장 텍스트
    - 인용한 매체 수
    - 찬/반 기사의 비율
    - Factfulness 게이지 (score 시각화)

---

# 6. Step 5 – 실행 로드맵 (우선순위)

1. **프롬프트 & AI 메시징 구조 개편 (가장 즉각적인 효과)**
   - `AiRequestMessage` 에 persona/role 추가
   - AI_agent_server 에 PRO/CON/MEDIATOR 프롬프트 및 JSON 스키마 도입
   - Mongo `ai_analysis_results` 저장
2. **Debate API & 프론트 통합**
   - `GET /api/v1/analysis/debate` 구현
   - 프론트에서 찬/반/중립 카드 + 요약 UI 추가
3. **Cold Start Hybrid RAG**
   - `AnalysisService.analyze` 에 article_count==0 분기 + `ColdStartService` 도입
   - 기존 CollectionService와 force 플래그 연동
   - UI 로딩 메시지 개선 및 이후 재분석 트리거
4. **Timeline / Bias / Claim 스키마 확장**
   - 타임라인/출처 편향 요약 API
   - Claim Mongo 컬렉션 및 Claim 기반 UI

이 순서대로 가면, **현재 /api/v1/analysis 와 기존 DTO를 깨지 않으면서**  
점진적으로 “단순 요약 → 구조화된 찬·반·팩트 분석”으로 진화시킬 수 있습니다.

원하시면 다음 단계로,  
1) `AiRequestMessage` 확장, 2) `DebateAnalysisResponseDto`, 3) `/api/v1/analysis/debate` 컨트롤러 골격  
까지 실제 코드 레벨로 함께 작성해 보겠습니다. 

---

## Assistant

먼저 실제 코드 구조와 관련 클래스들을 확인한 뒤, 말씀하신 3가지를 (AiRequestMessage 확장, Debate DTO, debate 컨트롤러 골격) 코드 수준 설계/초안으로 잡겠습니다.

```
Tool: list
```

```
Tool: glob
```

---

## Assistant

이제 backend 실제 코드를 살펴보고, AiRequestMessage/DTO/컨트롤러 구조를 확인한 뒤 요청하신 세 부분을 코드 수준 설계/예제로 정리하겠습니다.

```
Tool: grep
```

```
Tool: grep
```

```
Tool: grep
```

---

## Assistant

```
Tool: read
```

```
Tool: read
```

```
Tool: read
```

```
Tool: read
```

---

## Assistant

지금 구조를 기준으로, AiRequestMessage 확장과 Debate DTO/컨트롤러 골격을 “실제 코드 스케치” 형태로 정리해 드릴게요.

```
Tool: read
```

---

## Assistant

바로 이어서, 말씀하신 3가지(1. AiRequestMessage 확장, 2. Debate DTO, 3. `/api/v1/analysis/debate` 컨트롤러 골격)를 **현재 코드 스타일 기준**으로 “실제 코드 스케치”로 정리하겠습니다.

---

**1. AiRequestMessage + AiMessagingService 확장**

현재 `AiRequestMessage` (`backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiRequestMessage.java:5`) 는:

```java
public record AiRequestMessage(
        String requestId,
        String type,
        String query,
        String window,
        String message,
        Map<String, Object> context,
        String providerId,
        String modelId
) {
}
```

여기에 다음 3필드를 추가하는 방향을 제안드립니다.

- `agentRole` : `"PRO" | "CON" | "MEDIATOR"` 등
- `outputSchema` : `"DEBATE_V1"` 처럼, 응답 JSON 스키마 버전
- `source` : `"collector-service"` (요청 발신 서비스 식별)

```java
// backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiRequestMessage.java
public record AiRequestMessage(
        String requestId,
        String type,
        String query,
        String window,
        String message,
        Map<String, Object> context,
        String providerId,
        String modelId,
        String agentRole,
        String outputSchema,
        String source
) {
}
```

JSON 직렬화 기준으로는 **기존 필드 유지 + 새 필드 추가**라서,  
AI_agent_server 쪽에서 “모르는 필드는 무시”하도록 되어 있다면 하위호환성이 유지됩니다.

`AiMessagingService` (`backend/data-collection-service/src/main/java/com/newsinsight/collector/service/AiMessagingService.java`) 에서는:

```java
@Service
@RequiredArgsConstructor
@Slf4j
public class AiMessagingService {

    private final KafkaTemplate<String, AiRequestMessage> aiRequestKafkaTemplate;

    @Value("${collector.ai.topic.request:newsinsight.ai.requests}")
    private String requestTopic;

    @Value("${collector.ai.default-provider-id:openai}")
    private String defaultProviderId;

    @Value("${collector.ai.default-model-id:gpt-4.1}")
    private String defaultModelId;

    public String sendAnalysisRequest(String query, String window, String message, Map<String, Object> context) {
        String requestId = UUID.randomUUID().toString();
        String type = "ARTICLE_ANALYSIS";
        String effectiveWindow = (window == null || window.isBlank()) ? "7d" : window;

        AiRequestMessage payload = new AiRequestMessage(
                requestId,
                type,
                query,
                effectiveWindow,
                message,
                context,
                defaultProviderId,
                defaultModelId,
                null,                // agentRole (기존 호출은 단일 에세이)
                null,                // outputSchema
                "collector-service"  // source
        );
        aiRequestKafkaTemplate.send(requestTopic, requestId, payload);
        log.info("Sent AI analysis request {} to topic {} at {}", requestId, requestTopic, OffsetDateTime.now());
        return requestId;
    }

    public String sendAnalysisRequestWithRole(
            String query,
            String window,
            String message,
            Map<String, Object> context,
            String agentRole,
            String outputSchema
    ) {
        String requestId = UUID.randomUUID().toString();
        String type = "ARTICLE_ANALYSIS";
        String effectiveWindow = (window == null || window.isBlank()) ? "7d" : window;

        AiRequestMessage payload = new AiRequestMessage(
                requestId,
                type,
                query,
                effectiveWindow,
                message,
                context,
                defaultProviderId,
                defaultModelId,
                agentRole,
                outputSchema,
                "collector-service"
        );
        aiRequestKafkaTemplate.send(requestTopic, requestId, payload);
        log.info("Sent AI analysis request {} (role={}) to topic {} at {}",
                requestId, agentRole, requestTopic, OffsetDateTime.now());
        return requestId;
    }
}
```

이제 `AnalysisService.analyze` (`backend/data-collection-service/src/main/java/com/newsinsight/collector/service/AnalysisService.java:40`) 에서,  
향후 다중 에이전트 호출을 하고 싶다면 예시는 다음과 같이 갈 수 있습니다(당장 적용은 선택):

```java
// 기존 단일 요청 유지:
aiMessagingService.sendAnalysisRequest(normalizedQuery, window, message, Map.of());

// (확장 예시: PRO/CON/MEDIATOR)
String baseMessage = normalizedQuery != null ? normalizedQuery : "";
String outputSchema = "DEBATE_V1";

String reqPro = aiMessagingService.sendAnalysisRequestWithRole(
        normalizedQuery, window, baseMessage, Map.of(), "PRO", outputSchema);
String reqCon = aiMessagingService.sendAnalysisRequestWithRole(
        normalizedQuery, window, baseMessage, Map.of(), "CON", outputSchema);
String reqMed = aiMessagingService.sendAnalysisRequestWithRole(
        normalizedQuery, window, baseMessage,
        Map.of("proRequestId", reqPro, "conRequestId", reqCon),
        "MEDIATOR",
        outputSchema
);
```

---

**2. DebateAnalysisResponseDto 설계**

현재 `AnalysisResponseDto` (`backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AnalysisResponseDto.java:7`) 가 `record` + `@JsonProperty` 패턴이므로, 같은 스타일로 debate용 DTO를 두어 개 정의하는 게 자연스럽습니다.

예: `DebatePointDto`, `DebateAnalysisResponseDto` 두 개의 record.

```java
// backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DebatePointDto.java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record DebatePointDto(
        String title,
        String stance, // "pro" | "con" | "neutral"
        String summary,
        @JsonProperty("article_ids") List<String> articleIds,
        List<String> urls
) {
}
```

```java
// backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DebateAnalysisResponseDto.java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record DebateAnalysisResponseDto(
        String query,
        String window,
        @JsonProperty("analyzed_at") String analyzedAt,
        List<DebatePointDto> pros,
        List<DebatePointDto> cons,
        List<DebatePointDto> neutral,
        @JsonProperty("key_facts") List<String> keyFacts,
        @JsonProperty("pro_ratio") double proRatio,
        @JsonProperty("con_ratio") double conRatio,
        @JsonProperty("neutral_ratio") double neutralRatio
) {
}
```

- Mongo `ai_analysis_results` 에서 MEDIATOR 문서를 기준으로:
  - `pros`, `cons`, `neutral` 리스트를 그대로 매핑하거나,
  - 없다면 PRO/CON 응답에서 추출해 merge.
- `ratio` 는 기사 수/Claim 수 기반으로 단순 비율 산출(구체 로직은 `DebateAnalysisService` 에서).

---

**3. `/api/v1/analysis/debate` 컨트롤러 + 서비스 골격**

현재 `AnalysisController` (`backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/AnalysisController.java`) 는:

- `GET /api/v1/analysis`
- `GET /api/v1/articles`

만 제공하고 있습니다.

구조를 깔끔하게 유지하려면, debate 전용으로  
`DebateAnalysisController` + `DebateAnalysisService` 를 새로 두는 구성이 보기 좋습니다.

```java
// backend/data-collection-service/src/main/java/com/newsinsight/collector/service/DebateAnalysisService.java
package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.DebateAnalysisResponseDto;
import org.springframework.stereotype.Service;

@Service
public class DebateAnalysisService {

    // 예: MongoTemplate 또는 전용 Repository 주입
    // private final MongoTemplate mongoTemplate;

    public DebateAnalysisService(/* MongoTemplate mongoTemplate */) {
        // this.mongoTemplate = mongoTemplate;
    }

    public DebateAnalysisResponseDto getDebateAnalysis(String query, String window) {
        // 1) window 정규화 (1d/7d/30d 등)
        // 2) MongoDB ai_analysis_results 에서
        //    - query + window + agentRole == "MEDIATOR" 인 최신 문서 하나 조회
        // 3) 없는 경우: PRO/CON 문서 조합하거나, 빈 리스트/ratio 0 으로 리턴
        // 4) 조회 결과를 DebateAnalysisResponseDto 로 매핑

        // TODO: 실제 Mongo 쿼리/매핑 구현
        return new DebateAnalysisResponseDto(
                query,
                window,
                null,
                java.util.List.of(),
                java.util.List.of(),
                java.util.List.of(),
                java.util.List.of(),
                0.0,
                0.0,
                0.0
        );
    }
}
```

```java
// backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/DebateAnalysisController.java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.DebateAnalysisResponseDto;
import com.newsinsight.collector.service.DebateAnalysisService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class DebateAnalysisController {

    private final DebateAnalysisService debateAnalysisService;

    @GetMapping("/analysis/debate")
    public ResponseEntity<DebateAnalysisResponseDto> getDebateAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        return ResponseEntity.ok(debateAnalysisService.getDebateAnalysis(query, window));
    }
}
```

이렇게 하면:

- 기존 `/api/v1/analysis` / `/api/v1/articles` 는 그대로 유지
- Debate 관련 기능은 Mongo 연동까지 포함해 `DebateAnalysisService` 에 고립
- 프론트는 기존 통계용 `AnalysisResponseDto` 와 별도로  
  `GET /api/v1/analysis/debate` 를 호출해 찬/반/중립 카드/팩트 뷰를 그릴 수 있습니다.

---

원하시면 다음 단계로는:

- AI_agent_server 쪽에서 `agentRole`/`outputSchema` 를 읽어 실제 PRO/CON/MEDIATOR 프롬프트를 어떻게 짤지,
- Mongo `ai_analysis_results` 스키마 초안과, `DebateAnalysisService` 에서의 Mongo 쿼리/매핑 예시

까지 구체적으로 풀어보겠습니다. 어느 부분부터 먼저 더 깊게 들어가고 싶으신가요?

---

## User

ahen

---

## Assistant

아마 오타이신 것 같은데, 어디부터 이어갈까요?

지금까지 정리한 건:

1. `AiRequestMessage`/`AiMessagingService` 확장 설계
2. `DebateAnalysisResponseDto`/`DebatePointDto` 설계
3. `/api/v1/analysis/debate` 컨트롤러·서비스 골격

다음 중 어떤 걸 먼저 더 구체화하면 좋을까요?

- AI_agent_server 쪽:
  - `agentRole`별(PRO/CON/MEDIATOR) 프롬프트 예시
  - `ai_analysis_results` Mongo 컬렉션 스키마/인덱스 설계
- collector-service 쪽:
  - `DebateAnalysisService` 내부 Mongo 쿼리/매핑 로직 예시
  - cold start 분기(`articleCount == 0`) + on-demand 크롤링 연동 설계
- 프론트:
  - `/analysis` + `/analysis/debate` 통합해서 보여주는 UI 구조(카드/그래프) 가이드

희망하시는 영역/우선순위만 말씀해 주시면, 그 부분부터 코드 수준으로 더 파고들겠습니다.

---

