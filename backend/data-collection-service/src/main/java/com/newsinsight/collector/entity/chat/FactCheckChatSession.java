package com.newsinsight.collector.entity.chat;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 팩트체크 챗봇 세션 (MongoDB)
 * 
 * 채팅 세션 정보와 대화 이력을 저장합니다.
 * 
 * 개선사항:
 * - 복합 인덱스 추가
 * - 버전 관리 (낙관적 락)
 * - Audit 필드 추가
 * - 메시지 타입 세분화
 * - 직렬화 지원
 */
@Document(collection = "factcheck_chat_sessions")
@CompoundIndexes({
    @CompoundIndex(name = "idx_user_status", def = "{'userId': 1, 'status': 1}"),
    @CompoundIndex(name = "idx_status_sync", def = "{'status': 1, 'syncedToRdb': 1}"),
    @CompoundIndex(name = "idx_status_embed", def = "{'status': 1, 'embeddedToVectorDb': 1}"),
    @CompoundIndex(name = "idx_activity_status", def = "{'lastActivityAt': 1, 'status': 1}")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FactCheckChatSession implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    private String id; // MongoDB ObjectId

    /**
     * 세션 ID (UUID)
     */
    @Indexed(unique = true)
    private String sessionId;

    /**
     * 사용자 ID (선택)
     */
    @Indexed
    private String userId;

    /**
     * 세션 시작 시간
     */
    @CreatedDate
    @Indexed
    private LocalDateTime startedAt;

    /**
     * 마지막 활동 시간
     */
    @LastModifiedDate
    @Indexed
    private LocalDateTime lastActivityAt;

    /**
     * 세션 종료 시간
     */
    private LocalDateTime endedAt;

    /**
     * 세션 상태
     */
    @Indexed
    @Builder.Default
    private SessionStatus status = SessionStatus.ACTIVE;

    /**
     * 대화 메시지 목록
     */
    @Builder.Default
    private List<ChatMessage> messages = new ArrayList<>();

    /**
     * 세션 메타데이터
     */
    private SessionMetadata metadata;

    /**
     * RDB 동기화 여부
     */
    @Indexed
    @Builder.Default
    private boolean syncedToRdb = false;

    /**
     * 벡터 DB 임베딩 여부
     */
    @Indexed
    @Builder.Default
    private boolean embeddedToVectorDb = false;

    /**
     * 마지막 RDB 동기화 시간
     */
    private LocalDateTime lastSyncedAt;

    /**
     * 마지막 임베딩 시간
     */
    private LocalDateTime lastEmbeddedAt;

    /**
     * 동기화된 메시지 수
     */
    @Builder.Default
    private int syncedMessageCount = 0;

    /**
     * 임베딩된 메시지 수
     */
    @Builder.Default
    private int embeddedMessageCount = 0;

    /**
     * 버전 (낙관적 락용)
     */
    @Version
    private Long version;

    /**
     * 세션 상태
     */
    public enum SessionStatus {
        ACTIVE,      // 활성 - 대화 진행 중
        COMPLETED,   // 완료 - 사용자가 종료
        EXPIRED,     // 만료 - 비활성으로 인한 자동 만료
        ARCHIVED,    // 아카이브 - 장기 보관
        ERROR        // 에러 - 처리 중 오류 발생
    }

    /**
     * 채팅 메시지
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatMessage implements Serializable {
        private static final long serialVersionUID = 1L;
        
        private String messageId;
        private String role; // user, assistant, system
        private String content;
        private Long timestamp;
        private MessageType type;
        private Map<String, Object> metadata; // 추가 데이터 (증거, 검증 결과 등)
        
        // 추가 필드
        private Integer tokenCount; // 토큰 수 (비용 추적용)
        private Long processingTimeMs; // 처리 시간
        private String parentMessageId; // 부모 메시지 (스레드 지원)
        private Boolean synced; // RDB 동기화 여부
        private Boolean embedded; // 벡터 DB 임베딩 여부
    }

    /**
     * 메시지 타입
     */
    public enum MessageType {
        // 기본 메시지 타입
        MESSAGE,           // 일반 메시지
        SYSTEM,            // 시스템 메시지
        
        // 상태 관련
        STATUS,            // 상태 업데이트
        PROGRESS,          // 진행 상황
        
        // 팩트체크 관련
        CLAIM,             // 추출된 주장
        EVIDENCE,          // 수집된 증거
        VERIFICATION,      // 검증 결과
        ASSESSMENT,        // 신뢰도 평가
        
        // AI 관련
        AI_SYNTHESIS,      // AI 종합 분석
        AI_SUMMARY,        // AI 요약
        
        // 결과 관련
        COMPLETE,          // 완료
        ERROR,             // 에러
        WARNING,           // 경고
        
        // 피드백 관련
        FEEDBACK,          // 사용자 피드백
        RATING             // 평가
    }

    /**
     * 세션 메타데이터
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SessionMetadata implements Serializable {
        private static final long serialVersionUID = 1L;
        
        // 클라이언트 정보
        private String userAgent;
        private String ipAddress;
        private String language;
        private String timezone;
        private String platform; // web, mobile, api
        
        // 세션 통계
        private Integer messageCount;
        private Integer factCheckCount;
        private Integer errorCount;
        private Double averageResponseTime;
        private Long totalTokensUsed;
        
        // 첫 번째/마지막 주제
        private String firstTopic;
        private String lastTopic;
        
        // 세션 품질 지표
        private Double satisfactionScore; // 사용자 만족도 (1-5)
        private Boolean feedbackProvided; // 피드백 제공 여부
        
        // 기타
        private Map<String, Object> customData; // 커스텀 데이터
    }

    // =====================
    // 편의 메서드
    // =====================

    /**
     * 메시지 추가
     */
    public void addMessage(ChatMessage message) {
        if (messages == null) {
            messages = new ArrayList<>();
        }
        messages.add(message);
        updateMetadataOnMessage();
    }

    /**
     * 메시지 추가 후 메타데이터 업데이트
     */
    private void updateMetadataOnMessage() {
        if (metadata == null) {
            metadata = SessionMetadata.builder()
                    .messageCount(0)
                    .factCheckCount(0)
                    .errorCount(0)
                    .build();
        }
        metadata.setMessageCount(messages.size());
    }

    /**
     * 세션 종료
     */
    public void close() {
        this.status = SessionStatus.COMPLETED;
        this.endedAt = LocalDateTime.now();
    }

    /**
     * 세션 만료
     */
    public void expire() {
        this.status = SessionStatus.EXPIRED;
        this.endedAt = LocalDateTime.now();
    }

    /**
     * 활성 세션인지 확인
     */
    public boolean isActive() {
        return status == SessionStatus.ACTIVE;
    }

    /**
     * 동기화 필요 여부 확인
     */
    public boolean needsSync() {
        return !syncedToRdb && (status == SessionStatus.COMPLETED || status == SessionStatus.EXPIRED);
    }

    /**
     * 임베딩 필요 여부 확인
     */
    public boolean needsEmbedding() {
        return syncedToRdb && !embeddedToVectorDb;
    }

    /**
     * 마지막 사용자 메시지 조회
     */
    public ChatMessage getLastUserMessage() {
        if (messages == null || messages.isEmpty()) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            if ("user".equals(messages.get(i).getRole())) {
                return messages.get(i);
            }
        }
        return null;
    }

    /**
     * 마지막 어시스턴트 메시지 조회
     */
    public ChatMessage getLastAssistantMessage() {
        if (messages == null || messages.isEmpty()) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            if ("assistant".equals(messages.get(i).getRole())) {
                return messages.get(i);
            }
        }
        return null;
    }

    /**
     * 특정 타입의 메시지 수 조회
     */
    public long countMessagesByType(MessageType type) {
        if (messages == null) {
            return 0;
        }
        return messages.stream()
                .filter(m -> m.getType() == type)
                .count();
    }

    /**
     * 동기화되지 않은 메시지 조회
     */
    public List<ChatMessage> getUnsyncedMessages() {
        if (messages == null) {
            return new ArrayList<>();
        }
        return messages.stream()
                .filter(m -> m.getSynced() == null || !m.getSynced())
                .toList();
    }

    /**
     * 세션 지속 시간 (초)
     */
    public long getDurationSeconds() {
        if (startedAt == null) {
            return 0;
        }
        LocalDateTime end = endedAt != null ? endedAt : LocalDateTime.now();
        return java.time.Duration.between(startedAt, end).getSeconds();
    }
}
