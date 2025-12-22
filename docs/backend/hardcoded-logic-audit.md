# 하드코딩된 규칙 기반 로직 감사 및 리팩토링 가이드

## 개요

프로젝트 전반에 걸쳐 분산된 규칙 기반(Rule-based) 로직을 식별하고, LLM 기반 동적 시스템으로 전환하기 위한 체계적인 가이드입니다.

## 🔍 식별된 하드코딩 영역

### 1. 검색 의도 분석 (Intent Analysis)

#### QueryIntentAnalyzer.java ⚠️ **HIGH PRIORITY**
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/search/QueryIntentAnalyzer.java`

**하드코딩 내용**:
```java
private static final Map<IntentType, List<String>> INTENT_KEYWORDS = Map.of(
    IntentType.FACT_CHECK, List.of(
        "사실", "진짜", "가짜", "팩트체크", "검증", ...
    ),
    IntentType.LATEST_NEWS, List.of(
        "오늘", "최근", "속보", "긴급", ...
    ),
    // ... 총 50+ 하드코딩된 키워드
);
```

**문제점**:
- 새로운 의도 유형 추가 시 코드 수정 필요
- 다국어 지원 제한적 (한국어/영어만)
- 문맥 이해 불가 ("차" 단독 vs "전기차" 구분 못함)
- 동의어/유사어 처리 불가

**리팩토링 방안**:
```java
// 기존 (하드코딩)
if (query.contains("팩트체크")) return IntentType.FACT_CHECK;

// 개선 (LLM 기반)
AnalyzedQuery analyzed = llmIntentAnalyzer.analyze(query);
return analyzed.getIntentType(); // LLM이 문맥 이해 후 판단
```

#### AdvancedIntentAnalyzer.java
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/search/AdvancedIntentAnalyzer.java`

**하드코딩 내용**:
- 라인 74-100: 의도별 키워드 패턴 (INTENT_PATTERNS)
- 라인 184-192: 불용어 목록 (KOREAN_STOPWORDS, ENGLISH_STOPWORDS)
- 라인 515-550: 산업별 동의어 확장 (하드코딩된 반도체 관련 키워드)

**개선 필요**:
```java
// 라인 516-526 (하드코딩 예시)
if (lowerQuery.contains("반도체") || lowerQuery.contains("메모리")) {
    variants.add("DRAM 가격");
    variants.add("낸드플래시 시장");
    variants.add("반도체 업황");
    // ...
}
```

**리팩토링 후**:
```java
// LLM이 도메인 지식 기반으로 자동 확장
List<String> variants = llmQueryExpansionService
    .expandForDomain(query, detectedDomain);
```

### 2. 데이터 소스 어댑터 (Source Adapters)

#### NaverNewsSource.java
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/factcheck/NaverNewsSource.java`

**하드코딩 내용**:
```java
@Value("${collector.naver-news.display:10}")  // 고정된 결과 수
private int displayCount;

// 라인 100-105: 고정된 API 파라미터
String url = UriComponentsBuilder.fromUriString(NAVER_NEWS_API_URL)
    .queryParam("query", encodedQuery)
    .queryParam("display", displayCount)  // 하드코딩
    .queryParam("sort", "sim")            // 하드코딩: 유사도순 고정
    .build().toUriString();
```

**문제점**:
- 검색 의도에 따라 정렬 방식 변경 불가
- 결과 수가 고정되어 품질 vs 속도 트레이드오프 조정 불가

**리팩토링 방안**:
```java
// 의도 기반 동적 파라미터
SearchStrategy strategy = intentAnalyzer.determineStrategy(query, intent);
.queryParam("display", strategy.getResultCount())  // 동적
.queryParam("sort", strategy.getSortMethod())      // 동적
```

#### GoogleFactCheckSource.java
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/factcheck/GoogleFactCheckSource.java`

**하드코딩 내용**:
- 고정된 언어 코드 매핑
- 하드코딩된 페이지 크기 (pageSize=10)

### 3. 필터링 로직 (Filters)

#### URL 필터 (Python)
**위치**: `backend/autonomous-crawler-service/src/crawler/url_filter.py`

**하드코딩 예상 내용**:
```python
# 예상 코드 (실제 확인 필요)
BLOCKED_EXTENSIONS = ['.pdf', '.jpg', '.png', '.zip']
BLOCKED_DOMAINS = ['facebook.com', 'twitter.com']

def should_crawl(url):
    for ext in BLOCKED_EXTENSIONS:
        if url.endswith(ext):
            return False
    # ...
```

**리팩토링 방안**:
- 벡터 임베딩 기반 콘텐츠 유형 판단
- 동적 차단 목록 (DB 또는 설정 파일)

### 4. 검색 템플릿 (Search Templates)

#### SearchTemplate.java
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchTemplate.java`

**현재 구조**:
- 사용자가 저장한 검색 설정 (쿼리, 모드, 선택 항목)
- 정적 템플릿 (재사용 시 동일한 검색 수행)

**개선 방향**:
- 템플릿 실행 시 LLM이 현재 문맥에 맞게 쿼리 재해석
- "반도체 시장 분석" 템플릿 → 최신 트렌드 반영한 동적 쿼리 생성

### 5. Enum 기반 카테고리 (Static Categories)

#### SourceCategory.java / SourceType.java
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/`

**하드코딩 내용**:
```java
public enum SourceCategory {
    TECH,
    FINANCE,
    POLITICS,
    HEALTH,
    // 새 카테고리 추가 시 코드 수정 필요
}
```

**문제점**:
- 양자컴퓨팅, 메타버스 등 신규 도메인 추가 시 재배포 필요
- 카테고리 간 경계가 모호한 경우 처리 불가

**리팩토링 방안**:
```java
// 동적 카테고리 (LLM 기반)
String category = llmCategorizer.categorize(content);
// "Quantum Computing" → 자동으로 TECH 하위 신규 카테고리 생성
```

## 🔄 리팩토링 우선순위

### Phase 1: 핵심 의도 분석 (완료 ✅)
1. ~~LlmQueryExpansionService 생성~~ ✅
2. ~~SemanticRelevanceFilter 생성~~ ✅
3. ~~RRFEvidenceFusionService에 통합~~ ✅

### Phase 2: 의도 분석기 통합 (진행 중 🔄)
**목표**: QueryIntentAnalyzer의 하드코딩 제거

**작업 항목**:
1. **LlmIntentAnalyzer 생성**
   - LLM에게 쿼리 전송하여 의도 분석
   - JSON 형태로 구조화된 응답 수신
   - 폴백: 기존 QueryIntentAnalyzer 사용

2. **AdvancedIntentAnalyzer 개선**
   - 하드코딩된 산업별 키워드 제거 (라인 515-550)
   - LlmQueryExpansionService 활용

3. **통합 테스트**
   - "전기차 배터리" → LLM이 TECH 의도 + 관련 키워드 자동 생성
   - "오늘 주가" → LLM이 LATEST_NEWS + FINANCE 복합 의도 인식

### Phase 3: 소스 어댑터 동적화
**목표**: API 파라미터를 의도 기반으로 동적 조정

**작업 항목**:
1. **SearchStrategy 클래스 생성**
   ```java
   public class SearchStrategy {
       private int resultCount;      // 의도별 동적 조정
       private String sortMethod;    // sim, date, accuracy 등
       private List<String> filters; // 동적 필터
   }
   ```

2. **NaverNewsSource 리팩토링**
   ```java
   // 기존
   .queryParam("display", 10)
   .queryParam("sort", "sim")
   
   // 개선
   SearchStrategy strategy = getStrategy(intent);
   .queryParam("display", strategy.getResultCount())
   .queryParam("sort", strategy.getSortMethod())
   ```

3. **모든 Source 어댑터에 적용**
   - GoogleFactCheckSource
   - PubMedSource
   - CrossRefSource
   - 기타 소스들

### Phase 4: 필터링 통합
**목표**: 분산된 필터링 로직을 RRF 파이프라인으로 통합

**작업 항목**:
1. **개별 소스의 필터링 제거**
   - 각 소스는 원본(Raw) 결과만 반환
   - 필터링은 RRF 파이프라인에서 일괄 처리

2. **SemanticRelevanceFilter 강화**
   - URL 패턴 필터링 추가
   - 콘텐츠 유형 자동 감지

3. **통합 필터 파이프라인**
   ```
   Raw Results → RRF Fusion → Semantic Filter → URL Validation → Final Results
   ```

### Phase 5: 동적 카테고리 시스템
**목표**: Enum 기반 카테고리를 동적 시스템으로 전환

**작업 항목**:
1. **Category 테이블 생성**
   - 동적으로 카테고리 추가/수정 가능
   - 계층 구조 지원 (TECH → Quantum Computing)

2. **LlmCategorizer 서비스**
   - 콘텐츠를 분석하여 카테고리 자동 할당
   - 신규 카테고리 자동 제안

## 📊 리팩토링 효과 예측

### 코드 복잡도
| 항목 | 이전 | 이후 | 개선율 |
|------|------|------|--------|
| 하드코딩 키워드 수 | 150+ | 0 | 100% |
| 의도 분석 로직 (LOC) | 230 | 50 | 78% |
| 유지보수 포인트 | 15개 파일 | 3개 파일 | 80% |

### 기능 확장성
| 기능 | 이전 | 이후 |
|------|------|------|
| 새 의도 추가 | 코드 수정 + 재배포 | 설정 변경만 |
| 새 언어 지원 | 키워드 사전 작성 | 자동 지원 |
| 새 도메인 추가 | 개발자 작업 | LLM 자동 학습 |

### 검색 품질
| 쿼리 | 이전 (하드코딩) | 이후 (LLM) |
|------|----------------|------------|
| "전기차 배터리" | "차" → tea 오변환 | 문맥 이해 후 정확한 변환 |
| "양자컴퓨터" | 카테고리 없음 (미정의) | TECH 자동 할당 |
| "오늘 주가" | LATEST_NEWS만 인식 | LATEST_NEWS + FINANCE 복합 |

## 🛠️ 구현 가이드

### 1. LlmIntentAnalyzer 생성

```java
@Service
@RequiredArgsConstructor
public class LlmIntentAnalyzer {
    
    private final AIDoveClient aiDoveClient;
    
    public Mono<IntentAnalysisResult> analyzeIntent(String query) {
        String prompt = buildIntentPrompt(query);
        
        return aiDoveClient.chat(prompt, null)
            .map(response -> parseIntentResponse(response.reply()))
            .onErrorResume(e -> {
                // 폴백: 기존 규칙 기반 분석기 사용
                return Mono.just(fallbackAnalysis(query));
            });
    }
    
    private String buildIntentPrompt(String query) {
        return """
            Analyze the search intent of the following query and return a JSON response.
            
            Query: "%s"
            
            Return format:
            {
              "intentType": "FACT_CHECK|LATEST_NEWS|DEEP_ANALYSIS|OPINION_SEARCH|GENERAL",
              "confidence": 0.0-1.0,
              "keywords": ["keyword1", "keyword2"],
              "suggestedCategories": ["TECH", "FINANCE"],
              "timeRange": "1d|7d|30d|null",
              "reasoning": "brief explanation"
            }
            """.formatted(query);
    }
}
```

### 2. QueryIntentAnalyzer 마이그레이션

```java
@Service
@RequiredArgsConstructor
public class QueryIntentAnalyzer {
    
    private final LlmIntentAnalyzer llmAnalyzer;
    
    @Value("${collector.intent-analysis.use-llm:true}")
    private boolean useLlm;
    
    public QueryIntent analyzeIntent(String query) {
        if (useLlm && llmAnalyzer != null) {
            try {
                // LLM 기반 분석 시도
                IntentAnalysisResult result = llmAnalyzer
                    .analyzeIntent(query)
                    .block(Duration.ofSeconds(10));
                
                if (result != null) {
                    return convertToQueryIntent(result);
                }
            } catch (Exception e) {
                log.warn("LLM intent analysis failed, using rule-based: {}", e.getMessage());
            }
        }
        
        // 폴백: 기존 규칙 기반 분석
        return analyzeIntentRuleBased(query);
    }
    
    // 기존 로직은 private 메서드로 보존 (폴백용)
    private QueryIntent analyzeIntentRuleBased(String query) {
        // 기존 하드코딩 로직 유지 (폴백 전용)
        // ...
    }
}
```

### 3. 점진적 마이그레이션 전략

**Week 1-2**: LLM 기반 시스템 구축
- LlmIntentAnalyzer 구현
- A/B 테스트 프레임워크 구축

**Week 3-4**: 병렬 운영 및 검증
- 설정 플래그로 LLM/규칙 기반 전환 가능
- 로그 비교 분석

**Week 5-6**: 완전 전환
- LLM 기반을 기본값으로 설정
- 규칙 기반은 폴백으로만 유지

**Week 7+**: 하드코딩 제거
- 검증 완료 후 하드코딩된 키워드 맵 삭제
- 코드 정리 및 문서화

## 🧪 테스트 케이스

### 의도 분석 테스트

```java
@Test
void testIntentAnalysis_ElectricVehicle() {
    // Given
    String query = "전기차 배터리 수명이 5년 이상 가지 않는다";
    
    // When
    QueryIntent intent = analyzer.analyzeIntent(query);
    
    // Then
    assertEquals(IntentType.FACT_CHECK, intent.getType());
    assertTrue(intent.getKeywords().contains("전기차"));
    assertTrue(intent.getKeywords().contains("배터리"));
    assertFalse(intent.getKeywords().contains("차")); // "차" 단독 제외
}

@Test
void testIntentAnalysis_QuantumComputing() {
    // Given
    String query = "양자컴퓨터 상용화 전망";
    
    // When
    QueryIntent intent = analyzer.analyzeIntent(query);
    
    // Then
    assertEquals(IntentType.DEEP_ANALYSIS, intent.getType());
    // LLM이 "양자컴퓨터"를 TECH 카테고리로 자동 분류
    assertTrue(intent.getSuggestedCategories().contains("TECH"));
}
```

### 쿼리 확장 테스트

```java
@Test
void testQueryExpansion_NoHardcoding() {
    // Given
    String query = "메타버스 투자";
    
    // When
    List<String> expanded = expansionService
        .expandForAcademicSearch(query, List.of("메타버스", "투자"), "ko")
        .block();
    
    // Then
    assertNotNull(expanded);
    assertTrue(expanded.size() >= 3);
    // LLM이 생성한 영문 학술 키워드 확인
    assertTrue(expanded.stream().anyMatch(q -> q.contains("metaverse")));
    assertTrue(expanded.stream().anyMatch(q -> q.contains("investment")));
}
```

## 📝 체크리스트

### Phase 2 완료 조건
- [ ] LlmIntentAnalyzer 구현 완료
- [ ] QueryIntentAnalyzer에 LLM 통합
- [ ] AdvancedIntentAnalyzer 하드코딩 제거
- [ ] A/B 테스트 결과 LLM 우수성 검증
- [ ] 폴백 메커니즘 동작 확인
- [ ] 문서화 완료

### Phase 3 완료 조건
- [ ] SearchStrategy 클래스 구현
- [ ] NaverNewsSource 동적 파라미터 적용
- [ ] 모든 Source 어댑터 리팩토링
- [ ] 의도별 검색 전략 최적화
- [ ] 성능 테스트 통과

### Phase 4 완료 조건
- [ ] 개별 소스 필터링 제거
- [ ] RRF 파이프라인 통합 필터링
- [ ] SemanticRelevanceFilter 강화
- [ ] URL 패턴 필터링 추가
- [ ] 통합 테스트 통과

## 🎯 최종 목표

**"Zero Hardcoded Rules"** - 모든 규칙을 LLM과 벡터 검색으로 대체

- ✅ 키워드 매핑: LLM 기반 동적 확장
- ✅ 의도 분석: LLM 기반 문맥 이해
- ✅ 필터링: 벡터 유사도 기반
- 🔄 카테고리: 동적 생성 및 할당 (진행 중)
- 🔄 검색 전략: 의도 기반 동적 조정 (진행 중)

## 참고 자료

- [LLM 기반 쿼리 확장 구현](./fact-check-llm-integration.md)
- [RRF 알고리즘 상세](../overview/rrf-algorithm.md)
- [시맨틱 검색 가이드](./semantic-search-guide.md)
