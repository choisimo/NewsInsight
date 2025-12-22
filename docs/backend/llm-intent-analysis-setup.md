# LLM 기반 의도 분석 설정 가이드

## 개요

`QueryIntentAnalyzer`가 이제 LLM 기반 동적 의도 분석을 지원합니다. 하드코딩된 키워드 매핑 대신 LLM이 문맥을 이해하여 검색 의도를 판단합니다.

## 아키텍처

### 이전 (규칙 기반)
```
사용자 쿼리 → 키워드 매칭 → 의도 분류
- "팩트체크" 포함 → FACT_CHECK
- "오늘" 포함 → LATEST_NEWS
```

### 현재 (LLM + 폴백)
```
사용자 쿼리
  ↓
1. LLM 분석 시도 (우선)
  ↓
2. 신뢰도 >= 0.5 → LLM 결과 사용
  ↓
3. 실패 시 → 규칙 기반 폴백
  ↓
최종 의도 반환
```

## 설정 방법

### application.yml 설정

```yaml
collector:
  # LLM 기반 의도 분석
  intent-analysis:
    use-llm: true                    # LLM 사용 여부 (기본: true)
    llm-enabled: true                # LlmIntentAnalyzer 활성화
    llm-timeout-seconds: 10          # LLM 응답 대기 시간
    timeout-seconds: 10              # 전체 분석 타임아웃
  
  # AI Dove 설정 (우선순위 1)
  ai-dove:
    enabled: true
    base-url: ${COLLECTOR_AIDOVE_BASE_URL:https://workflow.nodove.com/webhook/aidove}
    timeout-seconds: 180
  
  # OpenAI 설정 (우선순위 2, AI Dove 실패 시)
  openai:
    enabled: true
    api-key: ${OPENAI_API_KEY}
    model: gpt-4o-mini
```

### 환경 변수

```bash
# AI Dove (권장)
export COLLECTOR_AIDOVE_BASE_URL=https://workflow.nodove.com/webhook/aidove

# OpenAI (폴백)
export OPENAI_API_KEY=sk-...
```

## 동작 방식

### 1. LLM 프롬프트

```
Query: "전기차 배터리 수명이 5년 이상 가지 않는다"

LLM 응답:
{
  "intentType": "FACT_CHECK",
  "confidence": 0.92,
  "keywords": ["전기차", "배터리", "수명"],
  "suggestedCategories": ["TECH"],
  "timeRange": null,
  "reasoning": "The query contains verification language and asks about factual claims"
}
```

### 2. 폴백 체인

```
1. AI Dove 시도 (10초 타임아웃)
   ↓ 실패
2. OpenAI 시도 (10초 타임아웃)
   ↓ 실패
3. 규칙 기반 분석 (하드코딩 키워드)
```

### 3. 신뢰도 임계값

- **LLM 신뢰도 >= 0.5**: LLM 결과 사용
- **LLM 신뢰도 < 0.5**: 규칙 기반 폴백
- **LLM 실패**: 자동으로 규칙 기반 사용

## 사용 예시

### Java 코드

```java
@Autowired
private QueryIntentAnalyzer intentAnalyzer;

public void analyzeQuery(String query) {
    // LLM 우선, 실패 시 자동 폴백
    QueryIntent intent = intentAnalyzer.analyzeIntent(query);
    
    System.out.println("Intent: " + intent.getType());
    System.out.println("Confidence: " + intent.getConfidence());
    System.out.println("Keywords: " + intent.getKeywords());
}
```

### 테스트 케이스

```java
@Test
void testLlmIntentAnalysis_FactCheck() {
    // Given
    String query = "전기차 배터리 수명이 5년 이상 가지 않는다";
    
    // When
    QueryIntent intent = intentAnalyzer.analyzeIntent(query);
    
    // Then
    assertEquals(IntentType.FACT_CHECK, intent.getType());
    assertTrue(intent.getConfidence() >= 0.5);
    assertTrue(intent.getKeywords().contains("전기차"));
}

@Test
void testLlmIntentAnalysis_NewDomain() {
    // Given - 하드코딩되지 않은 신규 도메인
    String query = "양자컴퓨터 상용화 전망";
    
    // When
    QueryIntent intent = intentAnalyzer.analyzeIntent(query);
    
    // Then
    assertEquals(IntentType.DEEP_ANALYSIS, intent.getType());
    // LLM이 자동으로 "양자컴퓨터"를 TECH 카테고리로 인식
}
```

## 로그 확인

### LLM 성공 시

```
INFO  LlmIntentAnalyzer - LLM intent analysis: '전기차 배터리' → FACT_CHECK (confidence: 0.92)
INFO  QueryIntentAnalyzer - LLM intent analysis succeeded: query='전기차 배터리', type=FACT_CHECK, confidence=0.92
```

### LLM 실패 → 폴백 시

```
WARN  LlmIntentAnalyzer - LLM intent analysis failed for '전기차 배터리': timeout
WARN  QueryIntentAnalyzer - LLM intent analysis failed for '전기차 배터리', using rule-based fallback: timeout
DEBUG QueryIntentAnalyzer - Rule-based intent analysis: query='전기차 배터리', type=FACT_CHECK, confidence=0.85, keywords=[전기차, 배터리]
```

### 캐시 히트 시

```
DEBUG LlmIntentAnalyzer - Cache hit for intent analysis: 전기차 배터리
```

## 성능 최적화

### 캐싱

- **캐시 크기**: 200개 쿼리
- **TTL**: 5분
- **키**: 소문자 정규화된 쿼리

```java
// 동일 쿼리 반복 시 LLM 호출 없이 캐시에서 반환
intentAnalyzer.analyzeIntent("전기차 배터리");  // LLM 호출
intentAnalyzer.analyzeIntent("전기차 배터리");  // 캐시 사용
```

### 타임아웃 설정

```yaml
collector:
  intent-analysis:
    llm-timeout-seconds: 10    # 빠른 응답 필요 시 5초로 단축
```

## 마이그레이션 전략

### Phase 1: 병렬 운영 (현재)

```yaml
collector:
  intent-analysis:
    use-llm: true    # LLM 우선, 실패 시 규칙 기반
```

**장점**:
- 안전한 전환 (폴백 보장)
- 점진적 검증 가능

### Phase 2: LLM 전용 (향후)

```yaml
collector:
  intent-analysis:
    use-llm: true
    # 규칙 기반 코드는 제거 가능 (충분한 검증 후)
```

### Phase 3: 하드코딩 제거 (최종)

- `INTENT_KEYWORDS` 맵 삭제
- `analyzeIntentRuleBased` 메서드 제거
- 코드 정리 및 단순화

## 비교: 규칙 기반 vs LLM

### 쿼리: "전기차 배터리 수명"

**규칙 기반**:
```
- "전기차" 키워드 없음 (하드코딩 안됨)
- "배터리" 키워드 없음
- "수명" 키워드 없음
→ GENERAL (신뢰도: 0.5)
```

**LLM 기반**:
```
- 문맥 이해: "전기차 배터리의 수명에 대한 질문"
- 의도: 기술적 정보 검색
→ DEEP_ANALYSIS (신뢰도: 0.85)
```

### 쿼리: "양자컴퓨터 상용화"

**규칙 기반**:
```
- "양자컴퓨터" 키워드 없음 (신규 도메인)
→ GENERAL (신뢰도: 0.5)
```

**LLM 기반**:
```
- 자동 인식: "양자컴퓨터"는 TECH 카테고리
- 의도: 미래 전망 분석
→ DEEP_ANALYSIS (신뢰도: 0.88)
```

## 문제 해결

### LLM이 항상 실패함

**원인**: AI Dove/OpenAI 설정 오류

**해결**:
```bash
# AI Dove 연결 확인
curl https://workflow.nodove.com/webhook/aidove

# OpenAI API 키 확인
echo $OPENAI_API_KEY
```

### 응답이 너무 느림

**원인**: LLM 타임아웃 설정이 너무 김

**해결**:
```yaml
collector:
  intent-analysis:
    llm-timeout-seconds: 5    # 10초 → 5초로 단축
```

### 규칙 기반만 사용됨

**원인**: `use-llm: false` 설정

**해결**:
```yaml
collector:
  intent-analysis:
    use-llm: true    # false → true로 변경
```

## 모니터링

### 메트릭

추적해야 할 주요 지표:

1. **LLM 성공률**: `LLM 성공 / 전체 분석`
2. **평균 응답 시간**: LLM 호출 시간
3. **캐시 히트율**: `캐시 히트 / 전체 요청`
4. **폴백 발생률**: `규칙 기반 사용 / 전체 분석`

### 로그 분석

```bash
# LLM 성공 건수
grep "LLM intent analysis succeeded" logs/app.log | wc -l

# LLM 실패 건수
grep "LLM intent analysis failed" logs/app.log | wc -l

# 캐시 히트 건수
grep "Cache hit for intent analysis" logs/app.log | wc -l
```

## 다음 단계

1. **AdvancedIntentAnalyzer 리팩토링**
   - 하드코딩된 산업별 키워드 제거
   - LlmQueryExpansionService 통합

2. **A/B 테스트**
   - 규칙 기반 vs LLM 성능 비교
   - 사용자 만족도 측정

3. **하드코딩 완전 제거**
   - 충분한 검증 후 `INTENT_KEYWORDS` 삭제
   - 코드 단순화

## 참고 자료

- [LlmIntentAnalyzer 소스](../../../backend/data-collection-service/src/main/java/com/newsinsight/collector/service/search/LlmIntentAnalyzer.java)
- [QueryIntentAnalyzer 소스](../../../backend/data-collection-service/src/main/java/com/newsinsight/collector/service/search/QueryIntentAnalyzer.java)
- [하드코딩 로직 감사](./hardcoded-logic-audit.md)
- [LLM 쿼리 확장 가이드](./fact-check-llm-integration.md)
