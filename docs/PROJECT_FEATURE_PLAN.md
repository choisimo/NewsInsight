# 프로젝트 기능 구현 계획서

## 📋 개요

### 비전
NewsInsight의 **프로젝트 기능**은 사용자가 특정 주제나 이슈에 대한 장기적인 조사 및 분석을 체계적으로 관리할 수 있는 워크스페이스를 제공합니다.

### 핵심 가치
- **지속적 모니터링**: 특정 주제에 대한 뉴스를 자동으로 수집하고 분석
- **협업**: 팀원들과 함께 프로젝트를 공유하고 작업
- **통합 관리**: 검색, 분석, 보고서를 하나의 프로젝트로 통합
- **시계열 분석**: 시간에 따른 트렌드 변화 추적

---

## 🎯 주요 기능

### 1. 프로젝트 생성 및 관리

#### 1.1 프로젝트 생성
```typescript
interface Project {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  category: ProjectCategory;
  status: ProjectStatus;
  visibility: 'private' | 'team' | 'public';
  
  // 소유자 및 멤버
  ownerId: string;
  members: ProjectMember[];
  
  // 설정
  settings: ProjectSettings;
  
  // 메타데이터
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  
  // 통계
  stats: ProjectStats;
}

enum ProjectCategory {
  RESEARCH = 'research',           // 조사/연구
  MONITORING = 'monitoring',       // 모니터링
  FACT_CHECK = 'fact_check',       // 팩트체크
  TREND_ANALYSIS = 'trend_analysis', // 트렌드 분석
  CUSTOM = 'custom'                // 사용자 정의
}

enum ProjectStatus {
  ACTIVE = 'active',       // 활성
  PAUSED = 'paused',       // 일시정지
  COMPLETED = 'completed', // 완료
  ARCHIVED = 'archived'    // 아카이브
}

interface ProjectSettings {
  // 자동 수집 설정
  autoCollect: boolean;
  collectInterval: 'hourly' | 'daily' | 'weekly';
  collectSources: string[];
  
  // 알림 설정
  notifications: {
    newArticles: boolean;
    importantUpdates: boolean;
    weeklyDigest: boolean;
  };
  
  // AI 분석 설정
  aiAnalysis: {
    enabled: boolean;
    autoSummarize: boolean;
    sentimentTracking: boolean;
    trendDetection: boolean;
  };
}
```

#### 1.2 프로젝트 대시보드
- **개요 섹션**
  - 프로젝트 정보 (이름, 설명, 키워드)
  - 진행 상황 (수집된 기사 수, 분석 완료율)
  - 최근 활동 타임라인
  
- **통계 섹션**
  - 시간대별 기사 수집 그래프
  - 출처별 분포
  - 감정 분석 트렌드
  - 주요 키워드 클라우드

- **빠른 액션**
  - 새 검색 실행
  - 보고서 생성
  - 멤버 초대
  - 설정 변경

### 2. 자동 뉴스 수집

#### 2.1 수집 파이프라인
```java
/**
 * 프로젝트 자동 수집 서비스
 */
@Service
public class ProjectAutoCollectService {
    
    @Scheduled(cron = "0 0 * * * *") // 매시간
    public void collectForActiveProjects() {
        List<Project> activeProjects = projectRepository
            .findByStatusAndAutoCollectEnabled(ProjectStatus.ACTIVE, true);
        
        for (Project project : activeProjects) {
            if (shouldCollect(project)) {
                collectNewsForProject(project);
            }
        }
    }
    
    private void collectNewsForProject(Project project) {
        // 1. 키워드 기반 검색
        for (String keyword : project.getKeywords()) {
            UnifiedSearchRequest request = UnifiedSearchRequest.builder()
                .query(keyword)
                .window(project.getSettings().getTimeWindow())
                .projectId(project.getId())
                .build();
            
            unifiedSearchService.searchAsync(request);
        }
        
        // 2. 결과를 프로젝트에 연결
        // 3. AI 분석 트리거 (설정된 경우)
        // 4. 알림 발송 (새 기사 발견 시)
    }
}
```

#### 2.2 수집 전략
- **증분 수집**: 마지막 수집 이후 새로운 기사만
- **중복 제거**: 동일 기사 필터링
- **우선순위**: 신뢰도 높은 출처 우선
- **스케줄링**: 사용자 정의 수집 주기

### 3. 프로젝트 컬렉션

#### 3.1 데이터 구조
```java
/**
 * 프로젝트 아이템 (수집된 기사/분석 결과)
 */
@Entity
@Table(name = "project_items")
public class ProjectItem {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "project_id")
    private String projectId;
    
    @Enumerated(EnumType.STRING)
    private ItemType type; // ARTICLE, SEARCH_RESULT, REPORT, NOTE
    
    // 원본 데이터 참조
    @Column(name = "source_id")
    private String sourceId; // SearchHistory ID, Article ID 등
    
    @Column(name = "source_type")
    private String sourceType;
    
    // 메타데이터
    private String title;
    private String summary;
    private String url;
    private LocalDateTime publishedAt;
    
    // 분류
    @ElementCollection
    private List<String> tags;
    
    @Column(name = "category")
    private String category;
    
    // 사용자 액션
    @Column(name = "bookmarked")
    private boolean bookmarked;
    
    @Column(name = "importance")
    private Integer importance; // 1-5
    
    @Column(name = "notes")
    @Lob
    private String notes;
    
    // 타임스탬프
    @Column(name = "added_at")
    private LocalDateTime addedAt;
    
    @Column(name = "added_by")
    private String addedBy;
}
```

#### 3.2 컬렉션 관리
- **필터링**: 날짜, 출처, 태그, 중요도
- **정렬**: 최신순, 중요도순, 관련도순
- **그룹화**: 날짜별, 주제별, 출처별
- **검색**: 전문 검색, 키워드 검색

### 4. 협업 기능

#### 4.1 멤버 관리
```typescript
interface ProjectMember {
  userId: string;
  role: MemberRole;
  permissions: Permission[];
  joinedAt: Date;
  invitedBy: string;
}

enum MemberRole {
  OWNER = 'owner',       // 소유자
  ADMIN = 'admin',       // 관리자
  EDITOR = 'editor',     // 편집자
  VIEWER = 'viewer'      // 조회자
}

enum Permission {
  // 프로젝트 관리
  MANAGE_PROJECT = 'manage_project',
  DELETE_PROJECT = 'delete_project',
  
  // 멤버 관리
  INVITE_MEMBERS = 'invite_members',
  REMOVE_MEMBERS = 'remove_members',
  CHANGE_ROLES = 'change_roles',
  
  // 컨텐츠 관리
  ADD_ITEMS = 'add_items',
  EDIT_ITEMS = 'edit_items',
  DELETE_ITEMS = 'delete_items',
  
  // 검색 및 분석
  RUN_SEARCH = 'run_search',
  GENERATE_REPORT = 'generate_report',
  
  // 설정
  CHANGE_SETTINGS = 'change_settings',
}
```

#### 4.2 활동 로그
```java
/**
 * 프로젝트 활동 로그
 */
@Entity
@Table(name = "project_activity_log")
public class ProjectActivityLog {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "project_id")
    private String projectId;
    
    @Column(name = "user_id")
    private String userId;
    
    @Enumerated(EnumType.STRING)
    private ActivityType type;
    
    @Column(name = "description")
    private String description;
    
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    public enum ActivityType {
        PROJECT_CREATED,
        PROJECT_UPDATED,
        MEMBER_ADDED,
        MEMBER_REMOVED,
        ITEM_ADDED,
        ITEM_UPDATED,
        ITEM_DELETED,
        SEARCH_EXECUTED,
        REPORT_GENERATED,
        SETTINGS_CHANGED
    }
}
```

#### 4.3 실시간 협업
- **동시 편집**: WebSocket 기반 실시간 동기화
- **활동 피드**: 팀원들의 최근 활동 표시
- **댓글 및 토론**: 아이템별 댓글 스레드
- **멘션**: @username으로 팀원 호출

### 5. 시계열 분석

#### 5.1 트렌드 추적
```typescript
interface TrendAnalysis {
  projectId: string;
  keyword: string;
  timeRange: {
    start: Date;
    end: Date;
  };
  
  // 시계열 데이터
  timeline: TimelinePoint[];
  
  // 통계
  stats: {
    totalArticles: number;
    peakDate: Date;
    peakCount: number;
    averagePerDay: number;
    growthRate: number; // %
  };
  
  // 감정 분석
  sentiment: {
    positive: number;
    negative: number;
    neutral: number;
    trend: 'improving' | 'declining' | 'stable';
  };
  
  // 주요 이벤트
  events: TrendEvent[];
}

interface TimelinePoint {
  date: Date;
  count: number;
  sentiment: number; // -1 to 1
  keywords: string[];
}

interface TrendEvent {
  date: Date;
  type: 'spike' | 'drop' | 'milestone';
  description: string;
  impact: number;
}
```

#### 5.2 비교 분석
- **키워드 비교**: 여러 키워드의 트렌드 비교
- **기간 비교**: 이번 주 vs 지난 주
- **출처 비교**: 출처별 보도 경향 차이
- **감정 비교**: 시간에 따른 감정 변화

### 6. 보고서 생성

#### 6.1 프로젝트 보고서
```typescript
interface ProjectReport {
  projectId: string;
  reportType: ReportType;
  timeRange: {
    start: Date;
    end: Date;
  };
  
  // 섹션
  sections: ReportSection[];
  
  // 메타데이터
  generatedAt: Date;
  generatedBy: string;
  format: 'pdf' | 'markdown' | 'html';
}

enum ReportType {
  WEEKLY_DIGEST = 'weekly_digest',     // 주간 요약
  MONTHLY_SUMMARY = 'monthly_summary', // 월간 요약
  TREND_REPORT = 'trend_report',       // 트렌드 보고서
  CUSTOM = 'custom'                    // 사용자 정의
}

interface ReportSection {
  type: SectionType;
  title: string;
  content: any;
  charts?: ChartData[];
}

enum SectionType {
  EXECUTIVE_SUMMARY,  // 요약
  TIMELINE,           // 타임라인
  TREND_ANALYSIS,     // 트렌드 분석
  SENTIMENT,          // 감정 분석
  KEY_ARTICLES,       // 주요 기사
  SOURCES,            // 출처 분석
  RECOMMENDATIONS     // 제안사항
}
```

#### 6.2 자동 보고서
- **주간 다이제스트**: 매주 월요일 자동 생성
- **월간 요약**: 매월 1일 자동 생성
- **이메일 발송**: 팀원들에게 자동 전송
- **템플릿**: 사용자 정의 보고서 템플릿

### 7. 알림 시스템

#### 7.1 알림 유형
```typescript
interface ProjectNotification {
  projectId: string;
  type: NotificationType;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  
  title: string;
  message: string;
  
  // 액션
  actionUrl?: string;
  actionLabel?: string;
  
  // 수신자
  recipients: string[];
  
  // 채널
  channels: NotificationChannel[];
  
  createdAt: Date;
}

enum NotificationType {
  NEW_ARTICLES,        // 새 기사 수집
  TREND_SPIKE,         // 트렌드 급등
  IMPORTANT_UPDATE,    // 중요 업데이트
  MEMBER_ACTIVITY,     // 멤버 활동
  REPORT_READY,        // 보고서 생성 완료
  SYSTEM_ALERT         // 시스템 알림
}

enum NotificationChannel {
  IN_APP,      // 앱 내 알림
  EMAIL,       // 이메일
  SLACK,       // Slack 연동
  WEBHOOK      // 웹훅
}
```

#### 7.2 알림 설정
- **개인 설정**: 사용자별 알림 선호도
- **프로젝트 설정**: 프로젝트별 알림 규칙
- **조용한 시간**: 알림 받지 않을 시간대
- **요약 모드**: 개별 알림 대신 요약 발송

---

## 🗄️ 데이터베이스 스키마

### 주요 테이블

```sql
-- 프로젝트
CREATE TABLE projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    keywords TEXT[], -- PostgreSQL array
    category VARCHAR(50),
    status VARCHAR(50),
    visibility VARCHAR(50),
    owner_id VARCHAR(64),
    settings JSONB,
    stats JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP
);

-- 프로젝트 멤버
CREATE TABLE project_members (
    id BIGSERIAL PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id),
    user_id VARCHAR(64),
    role VARCHAR(50),
    permissions TEXT[],
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    invited_by VARCHAR(64),
    UNIQUE(project_id, user_id)
);

-- 프로젝트 아이템
CREATE TABLE project_items (
    id BIGSERIAL PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id),
    type VARCHAR(50),
    source_id VARCHAR(255),
    source_type VARCHAR(50),
    title VARCHAR(500),
    summary TEXT,
    url VARCHAR(1000),
    published_at TIMESTAMP,
    tags TEXT[],
    category VARCHAR(100),
    bookmarked BOOLEAN DEFAULT FALSE,
    importance INTEGER,
    notes TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    added_by VARCHAR(64),
    INDEX idx_project_items_project_id (project_id),
    INDEX idx_project_items_type (type),
    INDEX idx_project_items_added_at (added_at)
);

-- 프로젝트 활동 로그
CREATE TABLE project_activity_log (
    id BIGSERIAL PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id),
    user_id VARCHAR(64),
    type VARCHAR(100),
    description TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_activity_project_id (project_id),
    INDEX idx_activity_created_at (created_at)
);

-- 프로젝트 알림
CREATE TABLE project_notifications (
    id BIGSERIAL PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id),
    type VARCHAR(100),
    priority VARCHAR(50),
    title VARCHAR(255),
    message TEXT,
    action_url VARCHAR(1000),
    action_label VARCHAR(100),
    recipients TEXT[],
    channels TEXT[],
    read_by TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_project_id (project_id),
    INDEX idx_notifications_created_at (created_at)
);
```

---

## 🎨 UI/UX 설계

### 1. 프로젝트 목록 페이지

```
┌─────────────────────────────────────────────────────┐
│  내 프로젝트                    [+ 새 프로젝트]      │
├─────────────────────────────────────────────────────┤
│  필터: [전체] [활성] [완료] [아카이브]               │
│  정렬: [최근 활동순] [이름순] [생성일순]             │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │ 🔬 AI 반도체 산업 동향 분석        [활성]    │  │
│  │ 키워드: AI, 반도체, NVIDIA, 삼성전자         │  │
│  │ 📊 125개 기사 | 👥 3명 | 🕒 2시간 전        │  │
│  │ [대시보드] [설정] [공유]                     │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │ 📈 경제 정책 모니터링              [활성]    │  │
│  │ 키워드: 금리, 부동산, 경제정책               │  │
│  │ 📊 89개 기사 | 👥 1명 | 🕒 1일 전          │  │
│  │ [대시보드] [설정] [공유]                     │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 2. 프로젝트 대시보드

```
┌─────────────────────────────────────────────────────┐
│  AI 반도체 산업 동향 분석                            │
│  [개요] [컬렉션] [분석] [보고서] [설정]              │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │  📊 통계        │  │  📈 트렌드              │  │
│  │  125개 기사     │  │  [시계열 그래프]        │  │
│  │  15개 출처      │  │                         │  │
│  │  긍정 65%       │  │                         │  │
│  └─────────────────┘  └─────────────────────────┘  │
│  ┌─────────────────────────────────────────────┐  │
│  │  🔔 최근 활동                                │  │
│  │  • 새 기사 10개 수집 (1시간 전)             │  │
│  │  • 주간 보고서 생성 완료 (3시간 전)         │  │
│  │  • 김철수님이 멤버로 추가됨 (1일 전)        │  │
│  └─────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────┐  │
│  │  📰 주요 기사                                │  │
│  │  [기사 목록 - 중요도순]                     │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 3. 컬렉션 뷰

```
┌─────────────────────────────────────────────────────┐
│  컬렉션 (125개 아이템)                               │
│  [필터] [정렬] [그룹화] [검색]                       │
├─────────────────────────────────────────────────────┤
│  날짜별 그룹화                                       │
│  ┌─────────────────────────────────────────────┐  │
│  │  📅 2024-12-20 (15개)                       │  │
│  │  ├─ ⭐⭐⭐⭐⭐ NVIDIA, AI 칩 신제품 발표    │  │
│  │  │   출처: TechCrunch | 긍정 | [상세]      │  │
│  │  ├─ ⭐⭐⭐ 삼성전자, HBM3E 양산 시작       │  │
│  │  │   출처: 조선일보 | 중립 | [상세]        │  │
│  │  └─ [더 보기...]                            │  │
│  └─────────────────────────────────────────────┘  │
│  ┌─────────────────────────────────────────────┐  │
│  │  📅 2024-12-19 (22개)                       │  │
│  │  [접힌 상태]                                 │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 구현 로드맵

### Phase 1: 기본 기능 (4주)

**Week 1-2: 백엔드 기반**
- [ ] 데이터베이스 스키마 설계 및 마이그레이션
- [ ] Project 엔티티 및 리포지토리
- [ ] ProjectItem 엔티티 및 리포지토리
- [ ] 기본 CRUD API 구현
- [ ] 권한 관리 시스템

**Week 3-4: 프론트엔드 기본**
- [ ] 프로젝트 목록 페이지
- [ ] 프로젝트 생성/수정 폼
- [ ] 프로젝트 대시보드 (기본)
- [ ] 컬렉션 뷰 (목록)
- [ ] 라우팅 및 네비게이션

### Phase 2: 자동 수집 (3주)

**Week 5-6: 수집 파이프라인**
- [ ] 자동 수집 스케줄러
- [ ] 키워드 기반 검색 통합
- [ ] 중복 제거 로직
- [ ] 수집 설정 UI

**Week 7: 알림 시스템**
- [ ] 알림 엔티티 및 서비스
- [ ] 이메일 알림
- [ ] 인앱 알림
- [ ] 알림 설정 UI

### Phase 3: 협업 기능 (3주)

**Week 8-9: 멤버 관리**
- [ ] 멤버 초대 시스템
- [ ] 역할 및 권한 관리
- [ ] 활동 로그
- [ ] 멤버 관리 UI

**Week 10: 실시간 협업**
- [ ] WebSocket 연결
- [ ] 실시간 동기화
- [ ] 댓글 시스템
- [ ] 활동 피드

### Phase 4: 분석 및 보고서 (4주)

**Week 11-12: 시계열 분석**
- [ ] 트렌드 분석 서비스
- [ ] 감정 분석 통합
- [ ] 비교 분석 기능
- [ ] 분석 차트 UI

**Week 13-14: 보고서 생성**
- [ ] 보고서 템플릿 엔진
- [ ] PDF 생성 (차트 포함)
- [ ] 자동 보고서 스케줄러
- [ ] 보고서 관리 UI

### Phase 5: 고급 기능 (2주)

**Week 15-16: 추가 기능**
- [ ] 프로젝트 템플릿
- [ ] 데이터 내보내기/가져오기
- [ ] API 키 관리
- [ ] 통합 (Slack, Webhook)

---

## 📊 성공 지표 (KPI)

### 사용자 참여
- 월간 활성 프로젝트 수
- 프로젝트당 평균 아이템 수
- 프로젝트당 평균 멤버 수
- 주간 활동 빈도

### 기능 사용률
- 자동 수집 활성화율
- 보고서 생성 빈도
- 협업 기능 사용률
- 알림 응답률

### 품질 지표
- 수집 정확도
- 중복 제거율
- AI 분석 정확도
- 사용자 만족도

---

## 🔒 보안 및 권한

### 데이터 접근 제어
- **프로젝트 소유자**: 모든 권한
- **관리자**: 멤버 관리 제외 모든 권한
- **편집자**: 컨텐츠 추가/수정
- **조회자**: 읽기 전용

### 데이터 보호
- 프로젝트별 데이터 격리
- 민감 정보 암호화
- 감사 로그 유지
- GDPR 준수

---

## 💰 비용 고려사항

### 리소스 사용
- **스토리지**: 프로젝트당 평균 100MB
- **API 호출**: 자동 수집 시 증가
- **AI 분석**: 토큰 사용량 증가
- **알림**: 이메일 발송 비용

### 최적화 전략
- 수집 빈도 제한
- 캐싱 활용
- 배치 처리
- 리소스 쿼터 설정

---

## 🎓 사용 사례

### 1. 언론사 모니터링
- **목적**: 특정 기업/인물에 대한 보도 추적
- **키워드**: 기업명, 인물명, 관련 이슈
- **활용**: 위기 관리, PR 전략

### 2. 시장 조사
- **목적**: 산업 트렌드 및 경쟁사 분석
- **키워드**: 제품명, 기술명, 경쟁사
- **활용**: 사업 전략, 투자 결정

### 3. 학술 연구
- **목적**: 특정 주제에 대한 문헌 수집
- **키워드**: 연구 주제, 저자명
- **활용**: 논문 작성, 연구 동향 파악

### 4. 정책 모니터링
- **목적**: 정부 정책 및 규제 변화 추적
- **키워드**: 정책명, 법안명, 부처명
- **활용**: 로비 활동, 컴플라이언스

---

## 📝 다음 단계

### 즉시 시작
1. ✅ 데이터베이스 스키마 설계 검토
2. ✅ 기술 스택 확정
3. ✅ 프로토타입 개발 시작

### 단기 목표 (1개월)
- Phase 1 완료
- 베타 테스트 시작
- 초기 사용자 피드백 수집

### 중기 목표 (3개월)
- Phase 2-3 완료
- 정식 출시
- 마케팅 시작

### 장기 목표 (6개월)
- 전체 기능 완성
- 엔터프라이즈 기능 추가
- API 공개
