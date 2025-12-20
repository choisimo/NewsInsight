package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.chat.ChatHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 채팅 이력 리포지토리 (PostgreSQL)
 */
@Repository
public interface ChatHistoryRepository extends JpaRepository<ChatHistory, Long> {

    /**
     * 세션 ID로 메시지 조회
     */
    List<ChatHistory> findBySessionIdOrderByCreatedAtAsc(String sessionId);

    /**
     * 사용자 ID로 메시지 조회
     */
    List<ChatHistory> findByUserIdOrderByCreatedAtDesc(String userId);

    /**
     * 메시지 ID 존재 여부 확인
     */
    boolean existsByMessageId(String messageId);

    /**
     * 특정 기간 내 메시지 조회
     */
    List<ChatHistory> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end);

    /**
     * 임베딩이 필요한 메시지 조회 (assistant 메시지만)
     */
    @Query("SELECT ch FROM ChatHistory ch WHERE ch.role = 'assistant' AND ch.embeddingId IS NULL")
    List<ChatHistory> findMessagesNeedingEmbedding();
}
