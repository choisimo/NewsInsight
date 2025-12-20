# 데이터베이스 저장 누락 분석 보고서

## 📊 현재 상태 분석

### ✅ 저장되는 데이터

#### 1. **검색 이력 (SearchHistory)**
- **위치**: `SearchHistoryService.saveFromMessage()`
- **저장 방식**: Kafka → Consumer → PostgreSQL
- **저장 내용**:
  - 검색 쿼리, 검색 타입, 시간 범위
  - 결과 개수, 결과 데이터
  - AI 요약 (aiSummary)
  - 발견된 URL (discoveredUrls)
  - 팩트체크 결과 (factCheckResults)
  - 신뢰도 점수, 입장 분포
  - 메타데이터, 실행 시간, 성공 여부

#### 2. **검색 템플릿 (SearchTemplate)**
- **위치**: `SearchTemplateService.create()`
- **저장 방식**: 동기 저장 → PostgreSQL
- **저장 내용**:
  - 템플릿 이름, 쿼리, 모드
  - 검색 항목 (items)
  - 설명, 태그, 메타데이터

#### 3. **팩트체크 챗봇 세션 (FactCheckChatSession)**
- **위치**: `FactCheckChatService.saveSession()`
- **저장 방식**: 실시간 → MongoDB
- **저장 내용**:
  - 세션 정보, 메시지 목록
  - 사용자 입력, 어시스턴트 응답
  - 팩트체크 결과, 증거, 검증 정보

#### 4. **채팅 이력 (ChatHistory)**
- **위치**: `ChatSyncService.syncSessionToRdb()`
- **저장 방식**: 백그라운드 동기화 → PostgreSQL
- **저장 내용**:
  - MongoDB 세션의 메시지들
  - 메타데이터, 임베딩 ID

---

## ❌ 저장되지 않는 데이터

### 1. **통합검색 (Unified Search) 중간 결과**

#### 문제점:
- **DB 검색 결과**: 실시간 스트리밍만 되고 저장 안 됨
- **웹 크롤링 결과**: 실시간 스트리밍만 되고 저장 안 됨
- **AI 분석 중간 과정**: 스트리밍만 되고 저장 안 됨

#### 현재 저장되는 것:
- ✅ 최종 AI 보고서 (persistAiReportToSearchHistory)
- ✅ 수집된 전체 결과 (persistAllResultsToSearchHistory)

#### 저장되지 않는 것:
- ❌ 개별 DB 검색 결과 (event: db_result)
- ❌ 개별 웹 크롤링 결과 (event: web_result)
- ❌ AI 분석 진행 상황 (event: ai_progress)
- ❌ 발견된 URL 상세 정보

**영향**:
- 검색 과정 추적 불가
- 디버깅 어려움
- 부분 실패 시 재시도 불가

---

### 2. **Deep Search 결과**

#### 문제점:
- **증거 수집 결과**: MongoDB에만 저장 (RDB 미동기화)
- **검증 결과**: MongoDB에만 저장
- **신뢰도 평가**: MongoDB에만 저장

#### 현재 상태:
```java
// DeepSearchService.java
// MongoDB에 저장하는 코드가 없음!
// 결과가 메모리에만 존재하고 SSE로만 전송됨
```

**영향**:
- Deep Search 결과 영구 저장 안 됨
- 검색 이력에서 조회 불가
- 재분석 불가

---

### 3. **사용자 입력 (미실행 검색)**

#### 문제점:
사용자가 검색어를 입력했지만 실행하지 않은 경우 저장 안 됨

#### 현재 동작:
```
사용자 입력 → 프론트엔드 상태 → (검색 실행 안 함) → 저장 안 됨
```

**영향**:
- 사용자 의도 파악 불가
- 검색 제안 개선 불가
- "이어서 하기" 기능에서 누락

---

### 4. **실패한 검색 요청**

#### 문제점:
검색 실행 중 오류 발생 시 부분적으로만 저장됨

#### 현재 동작:
```java
// UnifiedSearchService.java
// 오류 발생 시 errorMessage만 저장
// 어디까지 진행되었는지, 어떤 결과가 나왔는지 저장 안 됨
```

**영향**:
- 실패 원인 분석 어려움
- 부분 결과 복구 불가
- 재시도 시 처음부터 다시 시작

---

### 5. **Browser-Use 작업 결과**

#### 문제점:
브라우저 자동화 작업 결과가 저장되지 않음

#### 현재 상태:
- ✅ 작업 상태는 메모리에 저장 (BrowserJobStatusResponse)
- ❌ 작업 이력 DB 저장 안 됨
- ❌ 스크린샷 저장 안 됨
- ❌ 추출된 데이터 저장 안 됨

**영향**:
- 작업 이력 조회 불가
- 재사용 불가
- 감사 추적 불가

---

### 6. **검색 분석 보고서 (PDF)**

#### 문제점:
생성된 PDF 보고서가 저장되지 않음

#### 현재 동작:
```
PDF 생성 → 다운로드 → (서버에 저장 안 됨)
```

**영향**:
- 재다운로드 불가
- 보고서 이력 관리 불가
- 공유 기능 제한

---

### 7. **사용자 피드백**

#### 문제점:
사용자가 검색 결과에 대한 피드백을 제공할 수 있는 기능이 없음

#### 필요한 데이터:
- 검색 결과 유용성 평가 (좋아요/싫어요)
- 결과 정확도 피드백
- 개선 제안

**영향**:
- 검색 품질 개선 불가
- 사용자 만족도 측정 불가

---

## 🔧 개선 방안

### 1. **통합검색 중간 결과 저장**

```java
// UnifiedSearchEventService.java 개선
public void saveIntermediateResult(String jobId, SearchEvent event) {
    // MongoDB에 중간 결과 저장
    IntermediateSearchResult result = IntermediateSearchResult.builder()
        .jobId(jobId)
        .eventType(event.getEventType())
        .source(event.getSource())
        .data(event.getData())
        .timestamp(System.currentTimeMillis())
        .build();
    
    intermediateResultRepository.save(result);
}
```

### 2. **Deep Search 결과 저장**

```java
// DeepSearchService.java 개선
private void saveDeepSearchResult(String jobId, DeepSearchJob job) {
    SearchHistoryMessage message = SearchHistoryMessage.builder()
        .externalId(jobId)
        .searchType(SearchType.DEEP_SEARCH)
        .query(job.getTopic())
        .resultCount(job.getEvidenceCount())
        .results(convertEvidenceToResults(job.getEvidence()))
        .success(job.getStatus() == JobStatus.COMPLETED)
        .build();
    
    searchHistoryService.saveFromMessage(message);
}
```

### 3. **미실행 검색 저장**

```java
// 새로운 엔티티: DraftSearch
@Entity
public class DraftSearch {
    private String query;
    private String userId;
    private LocalDateTime createdAt;
    private boolean executed;
}
```

### 4. **실패한 검색 상세 저장**

```java
// SearchHistory에 필드 추가
private String failurePhase;  // db_search, web_crawl, ai_analysis
private Map<String, Object> partialResults;  // 부분 결과
private List<String> errorDetails;  // 상세 오류 정보
```

### 5. **Browser-Use 이력 저장**

```java
// 새로운 엔티티: BrowserJobHistory
@Entity
public class BrowserJobHistory {
    private String jobId;
    private String task;
    private String status;
    private String result;
    private List<String> screenshots;
    private LocalDateTime createdAt;
}
```

### 6. **PDF 보고서 저장**

```java
// 새로운 엔티티: GeneratedReport
@Entity
public class GeneratedReport {
    private String searchHistoryId;
    private String reportType;  // PDF, JSON, Markdown
    private String filePath;
    private Long fileSize;
    private LocalDateTime generatedAt;
}
```

### 7. **사용자 피드백 저장**

```java
// 새로운 엔티티: SearchFeedback
@Entity
public class SearchFeedback {
    private Long searchHistoryId;
    private String userId;
    private Integer rating;  // 1-5
    private String comment;
    private LocalDateTime createdAt;
}
```

---

## 📋 우선순위

### 🔴 높음 (즉시 구현 필요)
1. Deep Search 결과 저장
2. 실패한 검색 상세 저장
3. 미실행 검색 저장 (이어서 하기 기능용)

### 🟡 중간 (단기 구현)
4. 통합검색 중간 결과 저장
5. Browser-Use 이력 저장

### 🟢 낮음 (장기 구현)
6. PDF 보고서 저장
7. 사용자 피드백 저장

---

## 📊 예상 효과

### 데이터 완전성
- ✅ 모든 검색 활동 추적 가능
- ✅ 부분 실패 시 복구 가능
- ✅ 재분석 및 재사용 가능

### 사용자 경험
- ✅ "이어서 하기" 기능 정확도 향상
- ✅ 검색 이력 완전성 보장
- ✅ 보고서 재다운로드 가능

### 시스템 개선
- ✅ 디버깅 용이성 향상
- ✅ 성능 분석 가능
- ✅ 품질 개선 데이터 확보
