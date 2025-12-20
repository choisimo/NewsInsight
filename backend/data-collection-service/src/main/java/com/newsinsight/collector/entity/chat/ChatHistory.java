package com.newsinsight.collector.entity.chat;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 채팅 이력 (PostgreSQL)
 * 
 * MongoDB에서 동기화된 채팅 메시지를 RDB에 저장합니다.
 * 검색, 분석, 보고서 생성 등에 활용됩니다.
 */
@Entity
@Table(name = "chat_history", indexes = {
        @Index(name = "idx_chat_session_id", columnList = "session_id"),
        @Index(name = "idx_chat_user_id", columnList = "user_id"),
        @Index(name = "idx_chat_role", columnList = "role"),
        @Index(name = "idx_chat_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * MongoDB 세션 ID
     */
    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    /**
     * MongoDB 메시지 ID
     */
    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    /**
     * 사용자 ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * 메시지 역할
     */
    @Column(nullable = false, length = 32)
    private String role; // user, assistant, system

    /**
     * 메시지 내용
     */
    @Column(columnDefinition = "TEXT")
    private String content;

    /**
     * 메시지 타입
     */
    @Column(name = "message_type", length = 32)
    private String messageType;

    /**
     * 메시지 메타데이터 (JSON)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * 메시지 생성 시간
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 벡터 임베딩 ID (참조용)
     */
    @Column(name = "embedding_id", length = 64)
    private String embeddingId;
}
