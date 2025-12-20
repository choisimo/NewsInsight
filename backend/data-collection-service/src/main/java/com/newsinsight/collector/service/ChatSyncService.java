package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.chat.ChatHistory;
import com.newsinsight.collector.entity.chat.FactCheckChatSession;
import com.newsinsight.collector.repository.ChatHistoryRepository;
import com.newsinsight.collector.repository.FactCheckChatSessionRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 채팅 동기화 서비스
 * 
 * MongoDB → RDB 동기화 (백그라운드)
 * MongoDB → 벡터 DB 임베딩 (백그라운드)
 * 
 * 개선사항:
 * - 5분 경과 조건 추가
 * - 배치 저장 지원
 * - 동시성 제어 강화
 * - 메트릭 수집
 * - 재시도 로직
 */
@Service
@Slf4j
public class ChatSyncService {

    private final FactCheckChatSessionRepository sessionRepository;
    private final ChatHistoryRepository chatHistoryRepository;
    private final VectorEmbeddingService vectorEmbeddingService;
    private final MeterRegistry meterRegistry;

    // 설정값
    @Value("${chat.sync.min-messages:10}")
    private int minMessagesForSync;

    @Value("${chat.sync.max-idle-minutes:5}")
    private int maxIdleMinutesForSync;

    @Value("${chat.sync.batch-size:50}")
    private int batchSize;

    @Value("${chat.sync.max-retry:3}")
    private int maxRetryAttempts;

    @Value("${chat.sync.session-expire-hours:24}")
    private int sessionExpireHours;

    // 메트릭
    private Counter syncSuccessCounter;
    private Counter syncErrorCounter;
    private Counter embeddingSuccessCounter;
    private Counter embeddingErrorCounter;
    private Counter sessionExpiredCounter;
    private Timer syncDurationTimer;
    private Timer embeddingDurationTimer;
    private final AtomicLong pendingSyncGauge = new AtomicLong(0);
    private final AtomicLong pendingEmbeddingGauge = new AtomicLong(0);

    // 동시성 제어 - 진행 중인 동기화 세션 추적
    private final ConcurrentHashMap<String, LocalDateTime> syncingSessionsMap = new ConcurrentHashMap<>();
    
    // 마지막 동기화 시간 추적
    private final ConcurrentHashMap<String, LocalDateTime> lastSyncTimeMap = new ConcurrentHashMap<>();

    public ChatSyncService(
            FactCheckChatSessionRepository sessionRepository,
            ChatHistoryRepository chatHistoryRepository,
            VectorEmbeddingService vectorEmbeddingService,
            MeterRegistry meterRegistry
    ) {
        this.sessionRepository = sessionRepository;
        this.chatHistoryRepository = chatHistoryRepository;
        this.vectorEmbeddingService = vectorEmbeddingService;
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    public void initMetrics() {
        syncSuccessCounter = Counter.builder("chat.sync.rdb.success")
                .description("Number of successful RDB syncs")
                .register(meterRegistry);
        
        syncErrorCounter = Counter.builder("chat.sync.rdb.error")
                .description("Number of failed RDB syncs")
                .register(meterRegistry);
        
        embeddingSuccessCounter = Counter.builder("chat.sync.embedding.success")
                .description("Number of successful embeddings")
                .register(meterRegistry);
        
        embeddingErrorCounter = Counter.builder("chat.sync.embedding.error")
                .description("Number of failed embeddings")
                .register(meterRegistry);
        
        sessionExpiredCounter = Counter.builder("chat.sync.sessions.expired")
                .description("Number of sessions expired")
                .register(meterRegistry);
        
        syncDurationTimer = Timer.builder("chat.sync.rdb.duration")
                .description("Time taken for RDB sync")
                .register(meterRegistry);
        
        embeddingDurationTimer = Timer.builder("chat.sync.embedding.duration")
                .description("Time taken for embedding")
                .register(meterRegistry);

        meterRegistry.gauge("chat.sync.rdb.pending", pendingSyncGauge);
        meterRegistry.gauge("chat.sync.embedding.pending", pendingEmbeddingGauge);
    }

    /**
     * 동기화가 필요한 경우 스케줄링
     * 조건:
     * 1. 메시지가 minMessagesForSync개 이상
     * 2. 마지막 동기화로부터 maxIdleMinutesForSync분 경과
     */
    public void scheduleSyncIfNeeded(FactCheckChatSession session) {
        if (session.isSyncedToRdb()) {
            return;
        }

        boolean shouldSync = false;
        String reason = "";

        // 조건 1: 메시지 개수 체크
        if (session.getMessages().size() >= minMessagesForSync) {
            shouldSync = true;
            reason = "message count >= " + minMessagesForSync;
        }

        // 조건 2: 마지막 동기화로부터 시간 경과 체크
        LocalDateTime lastSync = lastSyncTimeMap.get(session.getSessionId());
        if (lastSync != null) {
            Duration elapsed = Duration.between(lastSync, LocalDateTime.now());
            if (elapsed.toMinutes() >= maxIdleMinutesForSync) {
                shouldSync = true;
                reason = "idle time >= " + maxIdleMinutesForSync + " minutes";
            }
        } else if (session.getStartedAt() != null) {
            // 최초 동기화 - 세션 시작 후 5분 경과 시
            Duration elapsed = Duration.between(session.getStartedAt(), LocalDateTime.now());
            if (elapsed.toMinutes() >= maxIdleMinutesForSync && session.getMessages().size() > 0) {
                shouldSync = true;
                reason = "first sync after " + maxIdleMinutesForSync + " minutes";
            }
        }

        if (shouldSync) {
            log.debug("Scheduling sync for session {}: {}", session.getSessionId(), reason);
            syncSessionToRdbAsync(session);
        }
    }

    /**
     * 세션을 RDB로 동기화 (비동기)
     */
    @Async("chatSyncExecutor")
    public void syncSessionToRdbAsync(FactCheckChatSession session) {
        String sessionId = session.getSessionId();
        
        // 중복 동기화 방지
        if (syncingSessionsMap.putIfAbsent(sessionId, LocalDateTime.now()) != null) {
            log.debug("Session {} is already being synced, skipping", sessionId);
            return;
        }

        try {
            syncSessionToRdbWithRetry(session);
        } finally {
            syncingSessionsMap.remove(sessionId);
        }
    }

    /**
     * 세션을 RDB로 동기화 (재시도 포함)
     */
    private void syncSessionToRdbWithRetry(FactCheckChatSession session) {
        int attempts = 0;
        Exception lastException = null;

        while (attempts < maxRetryAttempts) {
            try {
                syncSessionToRdb(session);
                return; // 성공 시 반환
            } catch (Exception e) {
                attempts++;
                lastException = e;
                log.warn("Sync attempt {} failed for session {}: {}", 
                        attempts, session.getSessionId(), e.getMessage());
                
                if (attempts < maxRetryAttempts) {
                    try {
                        // 지수 백오프
                        Thread.sleep((long) Math.pow(2, attempts) * 1000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }

        log.error("Failed to sync session {} after {} attempts", 
                session.getSessionId(), maxRetryAttempts, lastException);
        syncErrorCounter.increment();
    }

    /**
     * 세션을 RDB로 동기화 (동기)
     */
    @Transactional
    public void syncSessionToRdb(FactCheckChatSession session) {
        Timer.Sample sample = Timer.start(meterRegistry);
        
        log.info("Syncing session {} to RDB ({} messages)", 
                session.getSessionId(), session.getMessages().size());

        // 배치로 저장할 메시지 수집
        List<ChatHistory> toSave = new ArrayList<>();
        
        for (FactCheckChatSession.ChatMessage message : session.getMessages()) {
            // 이미 동기화된 메시지는 건너뛰기
            if (chatHistoryRepository.existsByMessageId(message.getMessageId())) {
                continue;
            }

            // RDB 엔티티 생성
            ChatHistory chatHistory = ChatHistory.builder()
                    .sessionId(session.getSessionId())
                    .messageId(message.getMessageId())
                    .userId(session.getUserId())
                    .role(message.getRole())
                    .content(message.getContent())
                    .messageType(message.getType() != null ? message.getType().name() : null)
                    .metadata(convertMetadata(message.getMetadata()))
                    .build();

            toSave.add(chatHistory);

            // 배치 크기에 도달하면 저장
            if (toSave.size() >= batchSize) {
                chatHistoryRepository.saveAll(toSave);
                toSave.clear();
            }
        }

        // 남은 메시지 저장
        if (!toSave.isEmpty()) {
            chatHistoryRepository.saveAll(toSave);
        }

        // 동기화 완료 플래그 업데이트
        session.setSyncedToRdb(true);
        sessionRepository.save(session);

        // 마지막 동기화 시간 업데이트
        lastSyncTimeMap.put(session.getSessionId(), LocalDateTime.now());

        sample.stop(syncDurationTimer);
        syncSuccessCounter.increment();
        
        log.info("Synced {} new messages from session {} to RDB", 
                toSave.size(), session.getSessionId());

        // 벡터 임베딩 트리거
        if (!session.isEmbeddedToVectorDb()) {
            embedSessionToVectorDbAsync(session);
        }
    }

    /**
     * 세션을 벡터 DB로 임베딩 (비동기)
     */
    @Async("chatSyncExecutor")
    public void embedSessionToVectorDbAsync(FactCheckChatSession session) {
        String sessionId = session.getSessionId();
        
        try {
            embedSessionToVectorDbWithRetry(session);
        } catch (Exception e) {
            log.error("Failed to embed session {} to vector DB: {}", 
                    sessionId, e.getMessage(), e);
            embeddingErrorCounter.increment();
        }
    }

    /**
     * 세션을 벡터 DB로 임베딩 (재시도 포함)
     */
    private void embedSessionToVectorDbWithRetry(FactCheckChatSession session) {
        int attempts = 0;
        Exception lastException = null;

        while (attempts < maxRetryAttempts) {
            try {
                embedSessionToVectorDb(session);
                return;
            } catch (Exception e) {
                attempts++;
                lastException = e;
                log.warn("Embedding attempt {} failed for session {}: {}", 
                        attempts, session.getSessionId(), e.getMessage());
                
                if (attempts < maxRetryAttempts) {
                    try {
                        Thread.sleep((long) Math.pow(2, attempts) * 1000);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }

        log.error("Failed to embed session {} after {} attempts", 
                session.getSessionId(), maxRetryAttempts, lastException);
        embeddingErrorCounter.increment();
    }

    /**
     * 세션을 벡터 DB로 임베딩 (동기)
     */
    @Transactional
    public void embedSessionToVectorDb(FactCheckChatSession session) {
        Timer.Sample sample = Timer.start(meterRegistry);
        
        log.info("Embedding session {} to vector DB", session.getSessionId());

        // assistant 메시지만 임베딩 (팩트체크 결과)
        List<FactCheckChatSession.ChatMessage> assistantMessages = session.getMessages().stream()
                .filter(msg -> "assistant".equals(msg.getRole()))
                .filter(msg -> msg.getContent() != null && !msg.getContent().isBlank())
                .filter(msg -> msg.getType() == FactCheckChatSession.MessageType.AI_SYNTHESIS 
                        || msg.getType() == FactCheckChatSession.MessageType.VERIFICATION
                        || msg.getType() == FactCheckChatSession.MessageType.ASSESSMENT)
                .toList();

        if (assistantMessages.isEmpty()) {
            log.debug("No assistant messages to embed for session {}", session.getSessionId());
            session.setEmbeddedToVectorDb(true);
            sessionRepository.save(session);
            return;
        }

        int embeddedCount = 0;
        for (FactCheckChatSession.ChatMessage message : assistantMessages) {
            try {
                // 벡터 임베딩 생성 및 저장
                String embeddingId = vectorEmbeddingService.embedChatMessage(
                        session.getSessionId(),
                        message.getMessageId(),
                        message.getContent(),
                        message.getMetadata()
                );

                if (embeddingId != null) {
                    // RDB에 임베딩 ID 업데이트
                    updateEmbeddingIdInRdb(session.getSessionId(), message.getMessageId(), embeddingId);
                    embeddedCount++;
                }
            } catch (Exception e) {
                log.error("Failed to embed message {}: {}", message.getMessageId(), e.getMessage());
            }
        }

        // 임베딩 완료 플래그 업데이트
        session.setEmbeddedToVectorDb(true);
        sessionRepository.save(session);

        sample.stop(embeddingDurationTimer);
        embeddingSuccessCounter.increment();

        log.info("Embedded {} messages from session {} to vector DB", 
                embeddedCount, session.getSessionId());
    }

    /**
     * RDB에 임베딩 ID 업데이트
     */
    private void updateEmbeddingIdInRdb(String sessionId, String messageId, String embeddingId) {
        chatHistoryRepository.findBySessionIdOrderByCreatedAtAsc(sessionId)
                .stream()
                .filter(ch -> ch.getMessageId().equals(messageId))
                .findFirst()
                .ifPresent(ch -> {
                    ch.setEmbeddingId(embeddingId);
                    chatHistoryRepository.save(ch);
                });
    }

    /**
     * 스케줄러: 주기적으로 동기화되지 않은 세션 처리
     */
    @Scheduled(fixedDelayString = "${chat.sync.scheduler.interval:300000}") // 기본 5분마다
    public void syncPendingSessions() {
        log.debug("Running scheduled sync for pending sessions");

        List<FactCheckChatSession.SessionStatus> targetStatuses = List.of(
                FactCheckChatSession.SessionStatus.ACTIVE,
                FactCheckChatSession.SessionStatus.COMPLETED,
                FactCheckChatSession.SessionStatus.EXPIRED
        );

        // RDB 동기화 대상 조회
        List<FactCheckChatSession> unsyncedSessions = 
                sessionRepository.findBySyncedToRdbFalseAndStatusIn(targetStatuses);
        
        pendingSyncGauge.set(unsyncedSessions.size());
        log.info("Found {} sessions to sync to RDB", unsyncedSessions.size());
        
        for (FactCheckChatSession session : unsyncedSessions) {
            // 5분 이상 경과한 세션만 동기화
            if (shouldSyncNow(session)) {
                syncSessionToRdbAsync(session);
            }
        }

        // 벡터 DB 임베딩 대상 조회
        List<FactCheckChatSession> unembeddedSessions = 
                sessionRepository.findByEmbeddedToVectorDbFalseAndStatusIn(
                        List.of(FactCheckChatSession.SessionStatus.COMPLETED,
                                FactCheckChatSession.SessionStatus.EXPIRED));
        
        pendingEmbeddingGauge.set(unembeddedSessions.size());
        log.info("Found {} sessions to embed to vector DB", unembeddedSessions.size());
        
        for (FactCheckChatSession session : unembeddedSessions) {
            // RDB 동기화 완료된 세션만 임베딩
            if (session.isSyncedToRdb()) {
                embedSessionToVectorDbAsync(session);
            }
        }
    }

    /**
     * 지금 동기화해야 하는지 확인
     */
    private boolean shouldSyncNow(FactCheckChatSession session) {
        // 완료/만료 세션은 즉시 동기화
        if (session.getStatus() != FactCheckChatSession.SessionStatus.ACTIVE) {
            return true;
        }

        // 활성 세션은 마지막 활동으로부터 5분 경과 시 동기화
        if (session.getLastActivityAt() != null) {
            Duration elapsed = Duration.between(session.getLastActivityAt(), LocalDateTime.now());
            return elapsed.toMinutes() >= maxIdleMinutesForSync;
        }

        return true;
    }

    /**
     * 스케줄러: 오래된 활성 세션 만료 처리
     */
    @Scheduled(fixedDelayString = "${chat.sync.expire.interval:3600000}") // 기본 1시간마다
    public void expireInactiveSessions() {
        LocalDateTime expiryThreshold = LocalDateTime.now().minusHours(sessionExpireHours);
        
        List<FactCheckChatSession> inactiveSessions = sessionRepository
                .findByStatusAndLastActivityAtBefore(
                        FactCheckChatSession.SessionStatus.ACTIVE, 
                        expiryThreshold
                );

        log.info("Found {} inactive sessions to expire", inactiveSessions.size());
        
        for (FactCheckChatSession session : inactiveSessions) {
            session.setStatus(FactCheckChatSession.SessionStatus.EXPIRED);
            session.setEndedAt(LocalDateTime.now());
            sessionRepository.save(session);
            
            // 만료된 세션도 동기화
            syncSessionToRdbAsync(session);
            
            sessionExpiredCounter.increment();
            log.info("Expired session: {}", session.getSessionId());
        }

        // 메모리 정리 - 오래된 추적 데이터 삭제
        cleanupTrackingData();
    }

    /**
     * 스케줄러: 동기화 상태 정리 (stuck 상태 복구)
     */
    @Scheduled(fixedDelay = 600000) // 10분마다
    public void cleanupStuckSyncs() {
        LocalDateTime stuckThreshold = LocalDateTime.now().minusMinutes(10);
        
        syncingSessionsMap.entrySet().removeIf(entry -> {
            if (entry.getValue().isBefore(stuckThreshold)) {
                log.warn("Removing stuck sync for session: {}", entry.getKey());
                return true;
            }
            return false;
        });
    }

    /**
     * 오래된 추적 데이터 정리
     */
    private void cleanupTrackingData() {
        LocalDateTime cleanupThreshold = LocalDateTime.now().minusHours(sessionExpireHours * 2);
        
        lastSyncTimeMap.entrySet().removeIf(entry -> 
                entry.getValue().isBefore(cleanupThreshold));
    }

    /**
     * 메타데이터 변환 (Object → Map)
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> convertMetadata(Object metadata) {
        if (metadata == null) {
            return new HashMap<>();
        }
        if (metadata instanceof Map) {
            return (Map<String, Object>) metadata;
        }
        // 다른 타입의 경우 빈 맵 반환
        Map<String, Object> result = new HashMap<>();
        result.put("raw", metadata.toString());
        return result;
    }

    /**
     * 동기화 통계 조회
     */
    public SyncStats getSyncStats() {
        return SyncStats.builder()
                .pendingSyncCount(pendingSyncGauge.get())
                .pendingEmbeddingCount(pendingEmbeddingGauge.get())
                .activeSyncCount(syncingSessionsMap.size())
                .build();
    }

    @lombok.Data
    @lombok.Builder
    public static class SyncStats {
        private long pendingSyncCount;
        private long pendingEmbeddingCount;
        private int activeSyncCount;
    }
}
