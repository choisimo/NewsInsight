package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.chat.FactCheckChatSession;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 팩트체크 챗봇 세션 리포지토리 (MongoDB)
 */
@Repository
public interface FactCheckChatSessionRepository extends MongoRepository<FactCheckChatSession, String> {

    /**
     * 세션 ID로 조회
     */
    Optional<FactCheckChatSession> findBySessionId(String sessionId);

    /**
     * 사용자 ID로 세션 목록 조회
     */
    List<FactCheckChatSession> findByUserIdOrderByStartedAtDesc(String userId);

    /**
     * 상태별 세션 조회
     */
    List<FactCheckChatSession> findByStatus(FactCheckChatSession.SessionStatus status);

    /**
     * RDB 동기화가 필요한 세션 조회
     */
    List<FactCheckChatSession> findBySyncedToRdbFalseAndStatusIn(List<FactCheckChatSession.SessionStatus> statuses);

    /**
     * 벡터 DB 임베딩이 필요한 세션 조회
     */
    List<FactCheckChatSession> findByEmbeddedToVectorDbFalseAndStatusIn(List<FactCheckChatSession.SessionStatus> statuses);

    /**
     * 특정 시간 이후 활동이 없는 세션 조회 (만료 처리용)
     */
    List<FactCheckChatSession> findByStatusAndLastActivityAtBefore(
            FactCheckChatSession.SessionStatus status, 
            LocalDateTime dateTime
    );

    /**
     * 세션 ID 존재 여부 확인
     */
    boolean existsBySessionId(String sessionId);
}
