# 통합검색과 Deep Search 동시 사용 개선 방안

## 📊 현재 상황

### 문제점
- 통합검색 실행 중 Deep Search 버튼이 비활성화됨
- 사용자가 여러 검색을 동시에 실행할 수 없음
- 백그라운드 작업임에도 불구하고 순차 실행만 가능

### 현재 동작
```typescript
// 통합검색 시작
setIsSearching(true);

// Deep Search 버튼 비활성화
<Button disabled={isSearching}>Deep Search</Button>

// 통합검색 완료 후에만 Deep Search 가능
```

---

## 🎯 개선 목표

### 1. 독립적인 작업 관리
- 각 검색 작업을 독립적으로 관리
- 작업 ID 기반 상태 추적
- 동시 실행 제한 없음

### 2. 백그라운드 작업 활용
- SSE 스트리밍으로 실시간 업데이트
- 알림으로 완료 통지
- 작업 큐 관리

### 3. UI/UX 개선
- 진행 중인 작업 목록 표시
- 각 작업별 진행률 표시
- 완료된 작업 알림

---

## 🔧 구현 방안

### 1. 백엔드: 작업 큐 관리 서비스

```java
/**
 * 검색 작업 큐 관리 서비스
 * 
 * 여러 검색 작업을 동시에 처리하고 상태를 관리합니다.
 */
@Service
@Slf4j
public class SearchJobQueueService {
    
    private final Map<String, SearchJob> activeJobs = new ConcurrentHashMap<>();
    private final ExecutorService executorService = Executors.newFixedThreadPool(10);
    
    /**
     * 검색 작업 시작
     */
    public String startSearchJob(SearchJobRequest request) {
        String jobId = UUID.randomUUID().toString();
        
        SearchJob job = SearchJob.builder()
            .jobId(jobId)
            .type(request.getType())
            .query(request.getQuery())
            .status(JobStatus.RUNNING)
            .startedAt(LocalDateTime.now())
            .build();
        
        activeJobs.put(jobId, job);
        
        // 비동기 실행
        executorService.submit(() -> executeJob(job));
        
        return jobId;
    }
    
    /**
     * 작업 상태 조회
     */
    public Optional<SearchJob> getJobStatus(String jobId) {
        return Optional.ofNullable(activeJobs.get(jobId));
    }
    
    /**
     * 활성 작업 목록
     */
    public List<SearchJob> getActiveJobs(String userId) {
        return activeJobs.values().stream()
            .filter(job -> userId.equals(job.getUserId()))
            .collect(Collectors.toList());
    }
}
```

### 2. 프론트엔드: 작업 관리 Context

```typescript
/**
 * 검색 작업 관리 Context
 */
interface SearchJob {
  jobId: string;
  type: 'UNIFIED' | 'DEEP_SEARCH' | 'FACT_CHECK';
  query: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  startedAt: number;
  completedAt?: number;
}

interface SearchJobContextType {
  jobs: Map<string, SearchJob>;
  startJob: (type: string, query: string) => Promise<string>;
  getJob: (jobId: string) => SearchJob | undefined;
  cancelJob: (jobId: string) => Promise<void>;
  clearCompleted: () => void;
}

export const SearchJobProvider = ({ children }: { children: React.ReactNode }) => {
  const [jobs, setJobs] = useState<Map<string, SearchJob>>(new Map());
  
  const startJob = async (type: string, query: string) => {
    const response = await fetch('/api/v1/search/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, query }),
    });
    
    const { jobId } = await response.json();
    
    // 작업 추가
    setJobs(prev => new Map(prev).set(jobId, {
      jobId,
      type: type as any,
      query,
      status: 'RUNNING',
      progress: 0,
      startedAt: Date.now(),
    }));
    
    // SSE 연결
    connectToJobStream(jobId);
    
    return jobId;
  };
  
  const connectToJobStream = (jobId: string) => {
    const eventSource = new EventSource(`/api/v1/search/jobs/${jobId}/stream`);
    
    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      updateJobProgress(jobId, data.progress);
    });
    
    eventSource.addEventListener('complete', (e) => {
      updateJobStatus(jobId, 'COMPLETED');
      showNotification(`검색 완료: ${jobs.get(jobId)?.query}`);
      eventSource.close();
    });
    
    eventSource.addEventListener('error', (e) => {
      updateJobStatus(jobId, 'FAILED');
      eventSource.close();
    });
  };
  
  return (
    <SearchJobContext.Provider value={{ jobs, startJob, getJob, cancelJob, clearCompleted }}>
      {children}
    </SearchJobContext.Provider>
  );
};
```

### 3. UI 컴포넌트: 작업 진행 상황 표시

```typescript
/**
 * 활성 작업 목록 컴포넌트
 */
export function ActiveJobsList() {
  const { jobs } = useSearchJobs();
  const activeJobs = Array.from(jobs.values()).filter(j => j.status === 'RUNNING');
  
  if (activeJobs.length === 0) return null;
  
  return (
    <Card className="fixed bottom-4 right-4 w-96 max-h-96 overflow-auto">
      <CardHeader>
        <CardTitle className="text-sm">진행 중인 작업 ({activeJobs.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {activeJobs.map(job => (
          <div key={job.jobId} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{job.query}</span>
              <Badge variant="outline">{job.type}</Badge>
            </div>
            <Progress value={job.progress} className="h-1" />
            <div className="text-xs text-muted-foreground">
              {Math.round(job.progress)}% 완료
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

### 4. 검색 버튼 개선

```typescript
/**
 * 개선된 검색 버튼
 * 
 * 작업 실행 중에도 새로운 검색 시작 가능
 */
export function SearchButtons() {
  const { startJob } = useSearchJobs();
  const [query, setQuery] = useState('');
  
  const handleUnifiedSearch = async () => {
    if (!query) return;
    
    const jobId = await startJob('UNIFIED', query);
    toast.success(`통합검색 시작: ${query}`);
    
    // 입력창 초기화 (선택사항)
    // setQuery('');
  };
  
  const handleDeepSearch = async () => {
    if (!query) return;
    
    const jobId = await startJob('DEEP_SEARCH', query);
    toast.success(`Deep Search 시작: ${query}`);
  };
  
  return (
    <div className="flex gap-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="검색어 입력..."
      />
      <Button onClick={handleUnifiedSearch}>
        통합검색
      </Button>
      <Button onClick={handleDeepSearch} variant="outline">
        Deep Search
      </Button>
    </div>
  );
}
```

---

## 🔔 알림 시스템

### 1. 완료 알림

```typescript
/**
 * 검색 완료 알림
 */
function showSearchCompleteNotification(job: SearchJob) {
  // 브라우저 알림 (권한 필요)
  if (Notification.permission === 'granted') {
    new Notification('검색 완료', {
      body: `"${job.query}" 검색이 완료되었습니다.`,
      icon: '/favicon.ico',
      tag: job.jobId,
    });
  }
  
  // Toast 알림
  toast.success(`검색 완료: ${job.query}`, {
    action: {
      label: '결과 보기',
      onClick: () => navigateToResult(job.jobId),
    },
  });
}
```

### 2. 진행 상황 알림

```typescript
/**
 * 주요 단계 알림
 */
eventSource.addEventListener('milestone', (e) => {
  const data = JSON.parse(e.data);
  
  toast.info(data.message, {
    description: `${job.query} - ${data.phase}`,
  });
});
```

---

## 📊 작업 이력 관리

### 1. 완료된 작업 보관

```typescript
/**
 * 완료된 작업을 이력에 저장
 */
const archiveCompletedJob = (job: SearchJob) => {
  const history = {
    jobId: job.jobId,
    type: job.type,
    query: job.query,
    completedAt: job.completedAt,
    resultCount: job.resultCount,
  };
  
  // localStorage에 저장
  const existing = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  existing.unshift(history);
  localStorage.setItem('searchHistory', JSON.stringify(existing.slice(0, 50)));
};
```

### 2. 이력에서 재실행

```typescript
/**
 * 이전 검색 재실행
 */
const rerunSearch = async (historyItem: SearchHistory) => {
  const jobId = await startJob(historyItem.type, historyItem.query);
  toast.info(`재실행: ${historyItem.query}`);
};
```

---

## 🎨 UI 개선 사항

### 1. 메인 화면

```
┌─────────────────────────────────────┐
│  검색어 입력                         │
│  [통합검색] [Deep Search] [팩트체크] │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  진행 중인 작업 (2)                  │
│  ├─ "AI 반도체" - 통합검색 (75%)    │
│  └─ "경제 전망" - Deep Search (30%) │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  최근 완료된 검색                    │
│  ├─ "메모리 가격" - 5분 전           │
│  └─ "주식 시장" - 1시간 전           │
└─────────────────────────────────────┘
```

### 2. 알림 센터

```
┌─────────────────────────────────────┐
│  🔔 알림                             │
│  ├─ ✅ "AI 반도체" 검색 완료         │
│  ├─ 🔄 "경제 전망" 분석 중...        │
│  └─ ❌ "오류 발생" 검색 실패         │
└─────────────────────────────────────┘
```

---

## 🚀 구현 단계

### Phase 1: 백엔드 작업 큐 (1주)
1. SearchJobQueueService 구현
2. 작업 상태 API 엔드포인트
3. SSE 스트리밍 개선

### Phase 2: 프론트엔드 Context (1주)
1. SearchJobContext 구현
2. 작업 관리 훅 (useSearchJobs)
3. SSE 연결 관리

### Phase 3: UI 컴포넌트 (1주)
1. ActiveJobsList 컴포넌트
2. 알림 시스템 통합
3. 검색 버튼 개선

### Phase 4: 테스트 및 최적화 (1주)
1. 동시 실행 테스트
2. 메모리 누수 확인
3. 성능 최적화

---

## 📈 예상 효과

### 사용자 경험
- ✅ 여러 검색 동시 실행 가능
- ✅ 백그라운드 작업으로 다른 작업 가능
- ✅ 실시간 진행 상황 확인
- ✅ 완료 알림으로 놓치지 않음

### 시스템 효율
- ✅ 리소스 효율적 활용
- ✅ 작업 큐 관리로 과부하 방지
- ✅ 독립적인 작업 실패 처리

### 개발 편의성
- ✅ 작업 상태 추적 용이
- ✅ 디버깅 개선
- ✅ 확장 가능한 구조
