# 메인화면 '이어서 하기' 로직 개선

## 📊 현재 상황 분석

### 문제점
1. **완료된 검색도 표시됨**: 결과가 나온 검색이 '이어서 하기'에 계속 표시
2. **중복 표시**: 메인화면과 '내 작업' 페이지에 동일한 항목 표시
3. **우선순위 없음**: 실제로 이어서 해야 할 작업과 완료된 작업 구분 없음

### 현재 동작
```typescript
// useContinueWork.ts
// 모든 검색 기록을 '이어서 하기'로 표시
const items = searchHistory.map(item => ({
  title: item.query,
  status: 'ready',
  continueUrl: `/search?q=${item.query}`,
}));
```

---

## 🎯 개선 목표

### 1. 명확한 분류
- **이어서 하기**: 미완료, 실패, 초안 작업만
- **내 작업**: 완료된 검색 결과 및 보고서

### 2. 상태 기반 필터링
```
✅ 표시해야 할 항목:
- 검색 입력만 하고 실행 안 함
- 검색 실행 중 (진행 중)
- 검색 실패
- 부분 완료 (일부 소스만 성공)

❌ 제외해야 할 항목:
- 완료된 검색 (결과 있음)
- 저장된 보고서
- 북마크된 결과
```

### 3. 우선순위 정렬
1. 진행 중인 작업 (가장 높음)
2. 실패한 작업
3. 초안 (입력만 한 검색)
4. 오래된 미완료 작업

---

## 🔧 구현 방안

### 1. SearchHistory 엔티티 개선

```java
@Entity
@Table(name = "search_history")
public class SearchHistory {
    
    // 기존 필드...
    
    /**
     * 검색 완료 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "completion_status")
    private CompletionStatus completionStatus;
    
    /**
     * 사용자가 결과를 확인했는지 여부
     */
    @Column(name = "viewed")
    private boolean viewed = false;
    
    /**
     * 결과 확인 시간
     */
    @Column(name = "viewed_at")
    private LocalDateTime viewedAt;
    
    /**
     * 북마크 여부
     */
    @Column(name = "bookmarked")
    private boolean bookmarked = false;
    
    /**
     * 보고서 생성 여부
     */
    @Column(name = "report_generated")
    private boolean reportGenerated = false;
    
    public enum CompletionStatus {
        DRAFT,           // 입력만 함
        IN_PROGRESS,     // 실행 중
        PARTIAL,         // 부분 완료
        COMPLETED,       // 완료
        FAILED,          // 실패
        CANCELLED        // 취소됨
    }
}
```

### 2. 백엔드 API: 이어서 하기 전용 엔드포인트

```java
/**
 * 이어서 하기 항목 조회
 */
@GetMapping("/api/v1/search-history/continue")
public ResponseEntity<List<ContinueWorkItem>> getContinueWorkItems(
        @RequestParam(required = false) String userId,
        @RequestParam(defaultValue = "10") int limit
) {
    List<SearchHistory> items = searchHistoryService.findContinueWorkItems(userId, limit);
    
    List<ContinueWorkItem> response = items.stream()
            .map(this::toContinueWorkItem)
            .sorted(Comparator.comparing(ContinueWorkItem::getPriority).reversed())
            .collect(Collectors.toList());
    
    return ResponseEntity.ok(response);
}

/**
 * 이어서 하기 항목 조회 (서비스)
 */
public List<SearchHistory> findContinueWorkItems(String userId, int limit) {
    // 조건:
    // 1. 완료되지 않았거나
    // 2. 완료되었지만 확인하지 않았거나
    // 3. 실패했거나
    // 4. 북마크/보고서 생성되지 않음
    
    return searchHistoryRepository.findAll(
        Specification.where(
            hasUserId(userId)
                .and(isNotCompleted()
                    .or(isCompletedButNotViewed())
                    .or(isFailed()))
                .and(isNotBookmarked())
                .and(hasNoReport())
        ),
        PageRequest.of(0, limit, Sort.by("createdAt").descending())
    ).getContent();
}
```

### 3. 프론트엔드: 개선된 useContinueWork 훅

```typescript
/**
 * 이어서 하기 항목 조회
 */
export function useContinueWork() {
  const [items, setItems] = useState<ContinueWorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    const fetchContinueWork = async () => {
      try {
        // 새로운 전용 API 사용
        const response = await fetch('/api/v1/search-history/continue?limit=10');
        const data = await response.json();
        
        // 우선순위별 정렬
        const sorted = data.sort((a, b) => {
          // 1. 진행 중 > 실패 > 초안 > 부분 완료
          const priorityOrder = {
            'in_progress': 4,
            'failed': 3,
            'draft': 2,
            'partial': 1,
          };
          
          return (priorityOrder[b.status] || 0) - (priorityOrder[a.status] || 0);
        });
        
        setItems(sorted);
      } catch (error) {
        console.error('Failed to fetch continue work items:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchContinueWork();
  }, []);
  
  return { items, isLoading };
}
```

### 4. ContinueCard 컴포넌트 개선

```typescript
/**
 * 이어서 하기 카드
 */
export function ContinueCard() {
  const { items, isLoading } = useContinueWork();
  
  // 이어서 할 작업이 없으면 표시 안 함
  if (!isLoading && items.length === 0) {
    return null;
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5" />
          이어서 하기
          <Badge variant="secondary">{items.length}</Badge>
        </CardTitle>
        <CardDescription>
          완료하지 못한 작업을 계속 진행하세요
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map(item => (
          <ContinueWorkItem key={item.id} item={item} />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * 이어서 하기 항목
 */
function ContinueWorkItem({ item }: { item: ContinueWorkItem }) {
  const statusConfig = {
    in_progress: {
      icon: Loader2,
      label: '진행 중',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    failed: {
      icon: AlertCircle,
      label: '실패',
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    draft: {
      icon: FileEdit,
      label: '초안',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
    },
    partial: {
      icon: AlertTriangle,
      label: '부분 완료',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
  };
  
  const config = statusConfig[item.status];
  const Icon = config.icon;
  
  return (
    <Link
      to={item.continueUrl}
      className="block p-3 rounded-lg border hover:bg-accent transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded', config.bgColor)}>
          <Icon className={cn('h-4 w-4', config.color)} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium truncate">{item.title}</h4>
            <Badge variant="outline" className="text-xs">
              {config.label}
            </Badge>
          </div>
          
          <p className="text-sm text-muted-foreground truncate">
            {item.description}
          </p>
          
          {item.progress !== undefined && (
            <Progress value={item.progress} className="h-1 mt-2" />
          )}
          
          <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(item.lastUpdated)}
          </div>
        </div>
        
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </Link>
  );
}
```

### 5. 검색 결과 확인 시 viewed 플래그 업데이트

```typescript
/**
 * 검색 결과 페이지에서 viewed 플래그 업데이트
 */
useEffect(() => {
  if (searchHistoryId) {
    // 결과를 확인했음을 서버에 알림
    fetch(`/api/v1/search-history/${searchHistoryId}/mark-viewed`, {
      method: 'POST',
    }).catch(console.error);
  }
}, [searchHistoryId]);
```

```java
/**
 * 검색 결과 확인 표시
 */
@PostMapping("/api/v1/search-history/{id}/mark-viewed")
public ResponseEntity<Void> markAsViewed(@PathVariable Long id) {
    searchHistoryService.markAsViewed(id);
    return ResponseEntity.ok().build();
}

public void markAsViewed(Long id) {
    searchHistoryRepository.findById(id).ifPresent(history -> {
        history.setViewed(true);
        history.setViewedAt(LocalDateTime.now());
        searchHistoryRepository.save(history);
    });
}
```

---

## 📋 상태 전이 다이어그램

```
DRAFT (초안)
  ↓ 검색 실행
IN_PROGRESS (진행 중)
  ↓ 완료
COMPLETED (완료)
  ↓ 사용자 확인
[이어서 하기에서 제거]

DRAFT (초안)
  ↓ 검색 실행
IN_PROGRESS (진행 중)
  ↓ 오류 발생
FAILED (실패)
  ↓ 재시도
IN_PROGRESS (진행 중)

IN_PROGRESS (진행 중)
  ↓ 일부 소스만 성공
PARTIAL (부분 완료)
  ↓ 재시도 또는 확인
COMPLETED 또는 [이어서 하기에서 제거]
```

---

## 🎨 UI 개선

### 메인화면 레이아웃

```
┌─────────────────────────────────────┐
│  이어서 하기 (3)                     │
│  ├─ 🔄 "AI 반도체" - 진행 중 (75%)  │
│  ├─ ❌ "경제 전망" - 실패            │
│  └─ 📝 "주식 시장" - 초안            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  내 작업 (5)                         │
│  ├─ ✅ "메모리 가격" - 완료 (50개)   │
│  ├─ 📊 "반도체 산업" - 보고서 생성   │
│  └─ ⭐ "기술 트렌드" - 북마크        │
└─────────────────────────────────────┘
```

### 내 작업 페이지

```
┌─────────────────────────────────────┐
│  필터: [전체] [완료] [보고서] [북마크]│
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  검색 결과 (완료)                    │
│  ├─ "AI 반도체" - 50개 결과          │
│  │   [결과 보기] [보고서 생성]        │
│  └─ "경제 전망" - 30개 결과          │
│      [결과 보기] [북마크]             │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  생성된 보고서                       │
│  ├─ "메모리 가격 분석" - PDF         │
│  │   [다운로드] [공유]                │
│  └─ "반도체 산업 동향" - PDF         │
│      [다운로드] [공유]                │
└─────────────────────────────────────┘
```

---

## 🚀 구현 단계

### Phase 1: 데이터베이스 스키마 (1주)
1. SearchHistory 테이블에 필드 추가
   - completion_status
   - viewed, viewed_at
   - bookmarked
   - report_generated
2. 마이그레이션 스크립트 작성
3. 기존 데이터 상태 업데이트

### Phase 2: 백엔드 API (1주)
1. 이어서 하기 전용 API 구현
2. 상태 업데이트 API (mark-viewed, mark-completed)
3. 필터링 로직 구현
4. 테스트 작성

### Phase 3: 프론트엔드 (1주)
1. useContinueWork 훅 개선
2. ContinueCard 컴포넌트 리팩토링
3. 상태별 아이콘 및 스타일링
4. 결과 페이지에서 viewed 플래그 업데이트

### Phase 4: 통합 및 테스트 (1주)
1. 전체 플로우 테스트
2. 엣지 케이스 처리
3. 성능 최적화
4. 사용자 피드백 수집

---

## 📊 예상 효과

### 사용자 경험
- ✅ 실제로 이어서 해야 할 작업만 표시
- ✅ 완료된 작업은 '내 작업'에서 확인
- ✅ 우선순위에 따른 정렬로 중요한 작업 먼저
- ✅ 진행 상황 명확히 파악

### 시스템 효율
- ✅ 불필요한 중복 표시 제거
- ✅ 명확한 상태 관리
- ✅ 데이터베이스 쿼리 최적화

### 개발 편의성
- ✅ 상태 기반 로직으로 유지보수 용이
- ✅ 확장 가능한 구조
- ✅ 테스트 가능한 코드
