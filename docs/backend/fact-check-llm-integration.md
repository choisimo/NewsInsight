# 팩트체크 LLM 기반 동적 쿼리 확장 및 시맨틱 필터링

## 개요

하드코딩된 키워드 매핑 방식을 **LLM 기반 동적 쿼리 확장**과 **벡터 시맨틱 필터링**으로 대체하여 유지보수성과 확장성을 개선했습니다.

## 아키텍처

### 이전 방식 (하드코딩)
```
사용자 쿼리 → 키워드 사전 매칭 → 학술 검색
문제: "차" → "tea" 잘못된 변환 → 무관한 결과
```

### 개선된 방식 (LLM + 시맨틱)
```
사용자 쿼리 
  ↓
1. LLM 기반 의도 분석 및 쿼리 확장
  ↓
2. 병렬 다중 쿼리 검색 (키워드 + 벡터)
  ↓
3. RRF 융합 (Reciprocal Rank Fusion)
  ↓
4. 시맨틱 필터링 (벡터 유사도)
  ↓
5. URL 검증
  ↓
최종 결과
```

## 주요 컴포넌트

### 1. LlmQueryExpansionService
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/factcheck/LlmQueryExpansionService.java`

**기능**:
- 한국어 쿼리를 영문 학술 키워드로 자동 번역
- 동의어 및 관련 개념 자동 생성
- LLM 폴백 체인 (AI Dove → OpenAI → Perplexity)
- 결과 캐싱 (10분 TTL)

**예시**:
```java
// 입력: "전기차 배터리 수명"
// 출력: [
//   "electric vehicle battery lifespan",
//   "EV battery durability",
//   "lithium-ion battery degradation",
//   "charging cycle longevity"
// ]
```

### 2. SemanticRelevanceFilter
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/factcheck/SemanticRelevanceFilter.java`

**기능**:
- 벡터 임베딩 기반 의미적 유사도 계산
- 키워드 매칭되지만 문맥상 무관한 결과 제거
- 코사인 유사도 기반 필터링

**예시**:
```
쿼리: "전기차 배터리"
- ✅ 통과: "Electric vehicle battery technology" (유사도: 0.85)
- ❌ 필터: "Green tea benefits" (유사도: 0.15)
```

### 3. RRFEvidenceFusionService (개선)
**위치**: `backend/data-collection-service/src/main/java/com/newsinsight/collector/service/factcheck/RRFEvidenceFusionService.java`

**개선사항**:
- 하드코딩된 `convertToAcademicQuery` 메서드 제거
- LLM 기반 쿼리 확장 통합
- 시맨틱 필터링 파이프라인 추가

## 설정

### application.yml 설정

```yaml
collector:
  fact-check:
    rrf:
      # LLM 기반 쿼리 확장 활성화
      llm-expansion-enabled: true
      
      # 시맨틱 필터링 활성화
      semantic-filter-enabled: true
      
      # RRF 파라미터
      k: 60                    # RRF 상수
      max-queries: 5           # 최대 병렬 쿼리 수
      max-results: 50          # 최대 결과 수
      min-relevance: 0.1       # 최소 관련성 점수
      
      # URL 검증
      url-validation-enabled: true
    
    # 시맨틱 필터 설정
    semantic-filter:
      enabled: true
      min-similarity: 0.3      # 최소 시맨틱 유사도 (0-1)
  
  # 임베딩 서비스 설정
  embedding:
    enabled: true
    base-url: http://localhost:8011
    model: intfloat/multilingual-e5-large
    dimension: 1024
    timeout-seconds: 30
```

## 워크플로우

### 1. 쿼리 입력
```
사용자: "전기차 배터리 수명이 5년 이상 가지 않는다"
```

### 2. 의도 분석 (AdvancedIntentAnalyzer)
```java
AnalyzedQuery {
  originalQuery: "전기차 배터리 수명이 5년 이상 가지 않는다"
  keywords: ["전기차", "배터리", "수명", "5년"]
  primaryKeyword: "전기차"
  intentType: FACT_CHECK
  language: "ko"
}
```

### 3. LLM 쿼리 확장
```
LLM Prompt → AI Dove/OpenAI
출력:
- "electric vehicle battery lifespan"
- "EV battery degradation over time"
- "lithium-ion battery longevity"
- "electric car battery warranty duration"
```

### 4. 병렬 검색 실행
```
5개 쿼리 × 8개 소스 = 40개 병렬 검색 태스크
소스: OpenAlex, PubMed, CrossRef, CORE, Wikipedia, News, etc.
```

### 5. RRF 융합
```
각 결과에 대해:
RRF Score = Σ (query_weight × source_weight / (k + rank))

예시:
- "EV battery study" 문서
  - Query 1 (rank 3): 1.0 × 1.3 / (60 + 3) = 0.0206
  - Query 2 (rank 1): 0.95 × 1.3 / (60 + 1) = 0.0202
  - Total RRF Score: 0.0408
```

### 6. 시맨틱 필터링
```
쿼리 임베딩: [0.12, -0.34, 0.56, ...]
각 결과 임베딩과 코사인 유사도 계산

결과:
- "EV battery research" → 유사도 0.82 ✅ 통과
- "Tea brewing methods" → 유사도 0.12 ❌ 제거
```

### 7. 최종 결과
```
30개 관련성 높은 증거 반환
- 학술 논문: 15개
- 뉴스 기사: 8개
- 백과사전: 7개
```

## 성능 최적화

### 캐싱 전략
1. **LLM 쿼리 확장 캐시**: 동일 쿼리 10분간 재사용
2. **임베딩 캐시**: 쿼리 임베딩 100개까지 메모리 캐시
3. **RRF 결과 캐시**: 없음 (실시간 데이터 반영)

### 병렬 처리
- 다중 쿼리 × 다중 소스 병렬 검색
- Reactor 기반 비동기 처리
- Bounded Elastic Scheduler 사용

### 타임아웃 관리
- LLM 호출: 30초
- 각 소스 검색: 15초
- 전체 파이프라인: 180초

## 모니터링

### 로그 예시
```
INFO  LlmQueryExpansionService - LLM expanded '전기차 배터리' into 4 academic queries
INFO  RRFEvidenceFusionService - RRF fusion completed: 5 queries × 8 sources → 47 unique evidences
INFO  SemanticRelevanceFilter - Semantic filter removed 12 irrelevant evidences
INFO  EvidenceValidator - URL validation filtered out 3 invalid evidences
```

### 메트릭
- 쿼리 확장 성공률
- 시맨틱 필터링 제거율
- 평균 응답 시간
- LLM 폴백 발생 횟수

## 장점

### 1. 유지보수성
- ❌ 이전: 새 도메인마다 키워드 사전 수동 업데이트
- ✅ 현재: LLM이 자동으로 관련 키워드 생성

### 2. 확장성
- ❌ 이전: 하드코딩된 매핑 (100개 키워드)
- ✅ 현재: 무한 도메인 지원 (LLM 지식 기반)

### 3. 정확도
- ❌ 이전: "차" → "tea" 오변환
- ✅ 현재: 문맥 이해 후 "electric vehicle" 변환

### 4. 다국어 지원
- ❌ 이전: 한국어→영어 사전만 지원
- ✅ 현재: LLM이 모든 언어 쌍 지원

## 폴백 전략

### LLM 실패 시
1. AI Dove 실패 → OpenAI 시도
2. OpenAI 실패 → Perplexity 시도
3. 모든 LLM 실패 → 규칙 기반 폴백 (기존 AdvancedIntentAnalyzer)

### 임베딩 서비스 실패 시
- 시맨틱 필터링 자동 비활성화
- 키워드 매칭만으로 검색 진행

### 전체 시스템 실패 시
- 원본 쿼리로만 검색
- 최소한의 결과라도 반환

## 비교: 하드코딩 vs LLM 기반

| 항목 | 하드코딩 방식 | LLM 기반 방식 |
|------|--------------|--------------|
| 유지보수 | 수동 업데이트 필요 | 자동 |
| 새 도메인 추가 | 개발자 작업 필요 | 즉시 지원 |
| 정확도 | 키워드 충돌 발생 | 문맥 이해 |
| 다국어 | 사전 필요 | 자동 지원 |
| 초기 비용 | 낮음 | LLM API 비용 |
| 운영 비용 | 높음 (유지보수) | 낮음 (자동화) |

## 예상 결과

### "전기차 배터리 수명" 쿼리

**이전 (하드코딩)**:
- "차" → "tea" 변환
- 차(tea) 관련 논문 검색
- 무관한 결과 반환

**현재 (LLM + 시맨틱)**:
- LLM: "electric vehicle battery lifespan" 생성
- 학술 DB에서 EV 배터리 연구 검색
- 시맨틱 필터: tea 관련 결과 제거
- 관련성 높은 EV 배터리 논문만 반환

## 향후 개선 방향

1. **벡터 DB 통합**: PostgreSQL pgvector 활용
2. **하이브리드 검색 강화**: BM25 + 벡터 검색 결합
3. **LLM 프롬프트 최적화**: Few-shot learning 적용
4. **실시간 피드백**: 사용자 피드백으로 필터 임계값 조정
5. **A/B 테스트**: 하드코딩 vs LLM 성능 비교

## 참고 자료

- [RRF 알고리즘 논문](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- [E5 임베딩 모델](https://huggingface.co/intfloat/multilingual-e5-large)
- [Hybrid Search Best Practices](https://www.pinecone.io/learn/hybrid-search-intro/)
