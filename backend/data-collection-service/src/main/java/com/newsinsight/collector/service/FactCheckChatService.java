package com.newsinsight.collector.service;

import com.newsinsight.collector.controller.FactCheckChatController.ChatMessage;
import com.newsinsight.collector.entity.chat.FactCheckChatSession;
import com.newsinsight.collector.repository.FactCheckChatSessionRepository;
import com.newsinsight.collector.service.FactVerificationService.DeepAnalysisEvent;
import io.micrometer.core.annotation.Timed;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;

/**
 * 팩트체크 챗봇 서비스
 * 
 * MongoDB에 채팅 이력을 저장하고 Redis로 캐싱합니다.
 * 백그라운드에서 FactVerificationService를 호출하고
 * 결과를 SSE로 스트리밍합니다.
 * 
 * 주요 기능:
 * - 세션 관리 (생성, 조회, 종료)
 * - 메시지 처리 및 팩트체크 실행
 * - Redis 캐싱 (수동 관리)
 * - 백그라운드 동기화 트리거
 * - 메트릭 수집
 */
@Service
@Slf4j
public class FactCheckChatService {

    private static final String CACHE_NAME_SESSIONS = "chatSessions";
    private static final String CACHE_NAME_MESSAGES = "chatMessages";

    private final FactVerificationService factVerificationService;
    private final FactCheckChatSessionRepository sessionRepository;
    private final ChatSyncService chatSyncService;
    private final CacheManager cacheManager;
    private final MeterRegistry meterRegistry;

    // 메트릭
    private Counter sessionCreatedCounter;
    private Counter sessionClosedCounter;
    private Counter messageProcessedCounter;
    private Counter factCheckSuccessCounter;
    private Counter factCheckErrorCounter;
    private Timer factCheckTimer;
    private final AtomicLong activeSessionsGauge = new AtomicLong(0);

    // 진행 중인 세션 트래킹 (동시성 제어)
    private final ConcurrentHashMap<String, Boolean> processingSessions = new ConcurrentHashMap<>();

    public FactCheckChatService(
            FactVerificationService factVerificationService,
            FactCheckChatSessionRepository sessionRepository,
            ChatSyncService chatSyncService,
            CacheManager cacheManager,
            MeterRegistry meterRegistry
    ) {
        this.factVerificationService = factVerificationService;
        this.sessionRepository = sessionRepository;
        this.chatSyncService = chatSyncService;
        this.cacheManager = cacheManager;
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    public void initMetrics() {
        sessionCreatedCounter = Counter.builder("factcheck.chat.sessions.created")
                .description("Number of chat sessions created")
                .register(meterRegistry);
        
        sessionClosedCounter = Counter.builder("factcheck.chat.sessions.closed")
                .description("Number of chat sessions closed")
                .register(meterRegistry);
        
        messageProcessedCounter = Counter.builder("factcheck.chat.messages.processed")
                .description("Number of messages processed")
                .register(meterRegistry);
        
        factCheckSuccessCounter = Counter.builder("factcheck.chat.factcheck.success")
                .description("Number of successful fact checks")
                .register(meterRegistry);
        
        factCheckErrorCounter = Counter.builder("factcheck.chat.factcheck.error")
                .description("Number of failed fact checks")
                .register(meterRegistry);
        
        factCheckTimer = Timer.builder("factcheck.chat.factcheck.duration")
                .description("Time taken for fact check operations")
                .register(meterRegistry);

        meterRegistry.gauge("factcheck.chat.sessions.active", activeSessionsGauge);
    }

    /**
     * 세션 생성 또는 조회
     * 캐시를 수동으로 관리하여 proxy 문제 회피
     */
    @Timed(value = "factcheck.chat.session.get", description = "Time to get or create session")
    public FactCheckChatSession getOrCreateSession(String sessionId) {
        // 1. 캐시에서 먼저 조회
        FactCheckChatSession cached = getCachedSession(sessionId);
        if (cached != null) {
            log.debug("Session {} found in cache", sessionId);
            return cached;
        }

        // 2. MongoDB에서 조회
        return sessionRepository.findBySessionId(sessionId)
                .map(session -> {
                    putSessionToCache(session);
                    return session;
                })
                .orElseGet(() -> {
                    // 3. 새 세션 생성
                    FactCheckChatSession session = FactCheckChatSession.builder()
                            .sessionId(sessionId)
                            .startedAt(LocalDateTime.now())
                            .lastActivityAt(LocalDateTime.now())
                            .status(FactCheckChatSession.SessionStatus.ACTIVE)
                            .messages(new ArrayList<>())
                            .build();
                    FactCheckChatSession saved = sessionRepository.save(session);
                    
                    // 메트릭 업데이트
                    sessionCreatedCounter.increment();
                    activeSessionsGauge.incrementAndGet();
                    
                    putSessionToCache(saved);
                    log.info("Created new chat session: {}", sessionId);
                    return saved;
                });
    }

    /**
     * 세션 생성 (사용자 정보 포함)
     */
    public FactCheckChatSession createSession(String sessionId, String userId, String userAgent, String ipAddress) {
        FactCheckChatSession session = FactCheckChatSession.builder()
                .sessionId(sessionId)
                .userId(userId)
                .startedAt(LocalDateTime.now())
                .lastActivityAt(LocalDateTime.now())
                .status(FactCheckChatSession.SessionStatus.ACTIVE)
                .messages(new ArrayList<>())
                .metadata(FactCheckChatSession.SessionMetadata.builder()
                        .userAgent(userAgent)
                        .ipAddress(ipAddress)
                        .messageCount(0)
                        .factCheckCount(0)
                        .build())
                .build();
        
        FactCheckChatSession saved = sessionRepository.save(session);
        
        sessionCreatedCounter.increment();
        activeSessionsGauge.incrementAndGet();
        putSessionToCache(saved);
        
        log.info("Created new chat session: {} for user: {}", sessionId, userId);
        return saved;
    }

    /**
     * 사용자 메시지 처리 및 팩트체크 수행
     * 
     * @param sessionId 세션 ID
     * @param userMessage 사용자 메시지
     * @param claims 검증할 주장 목록 (선택)
     * @return 챗봇 응답 이벤트 스트림
     */
    @Timed(value = "factcheck.chat.message.process", description = "Time to process message")
    public Flux<ChatEvent> processMessage(String sessionId, String userMessage, List<String> claims) {
        log.info("Processing message for session {}: {}", sessionId, userMessage);
        
        // 중복 처리 방지
        if (processingSessions.putIfAbsent(sessionId, true) != null) {
            log.warn("Session {} is already processing a message", sessionId);
            return Flux.just(ChatEvent.builder()
                    .type("error")
                    .role("system")
                    .content("이전 요청을 처리 중입니다. 잠시 후 다시 시도해주세요.")
                    .timestamp(System.currentTimeMillis())
                    .build());
        }
        
        messageProcessedCounter.increment();
        
        // 세션 조회 또는 생성
        FactCheckChatSession session = getOrCreateSession(sessionId);
        
        // 사용자 메시지 저장
        FactCheckChatSession.ChatMessage userMsg = FactCheckChatSession.ChatMessage.builder()
                .messageId(UUID.randomUUID().toString())
                .role("user")
                .content(userMessage)
                .timestamp(System.currentTimeMillis())
                .type(FactCheckChatSession.MessageType.MESSAGE)
                .build();
        
        session.getMessages().add(userMsg);
        session.setLastActivityAt(LocalDateTime.now());
        
        // 메타데이터 업데이트
        updateSessionMetadata(session);
        
        saveSession(session);

        return Flux.create(sink -> {
            Timer.Sample sample = Timer.start(meterRegistry);
            
            // 1. 인사 메시지
            sink.next(ChatEvent.builder()
                    .type("message")
                    .role("assistant")
                    .content("안녕하세요! 팩트체크 챗봇입니다. 입력하신 내용을 분석하겠습니다.")
                    .timestamp(System.currentTimeMillis())
                    .build());

            // 2. 분석 시작 알림
            sink.next(ChatEvent.builder()
                    .type("status")
                    .role("system")
                    .content("🔍 팩트체크를 시작합니다...")
                    .phase("init")
                    .timestamp(System.currentTimeMillis())
                    .build());

            // 3. 백그라운드에서 팩트체크 실행
            executeFactCheckAsync(sessionId, userMessage, claims, sink, sample);
        });
    }

    /**
     * 백그라운드에서 팩트체크 실행
     */
    private void executeFactCheckAsync(
            String sessionId, 
            String topic, 
            List<String> claims,
            reactor.core.publisher.FluxSink<ChatEvent> sink,
            Timer.Sample timerSample
    ) {
        try {
            StringBuilder assistantResponse = new StringBuilder();
            
            // FactVerificationService 호출
            factVerificationService.analyzeAndVerify(topic, claims)
                    .doOnNext(event -> {
                        // DeepAnalysisEvent를 ChatEvent로 변환
                        ChatEvent chatEvent = convertToChatEvent(event);
                        
                        // 어시스턴트 응답 누적
                        if ("ai_synthesis".equals(event.getEventType())) {
                            assistantResponse.append(event.getMessage());
                        }
                        
                        sink.next(chatEvent);
                    })
                    .doOnComplete(() -> {
                        // 최종 응답 저장
                        if (assistantResponse.length() > 0) {
                            addToHistory(sessionId, assistantResponse.toString(), 
                                    FactCheckChatSession.MessageType.AI_SYNTHESIS);
                        }
                        
                        // 완료 메시지
                        sink.next(ChatEvent.builder()
                                .type("complete")
                                .role("system")
                                .content("✅ 팩트체크가 완료되었습니다. 추가로 궁금한 점이 있으시면 질문해주세요!")
                                .timestamp(System.currentTimeMillis())
                                .build());
                        
                        // 메트릭 기록
                        timerSample.stop(factCheckTimer);
                        factCheckSuccessCounter.increment();
                        
                        // 세션 메타데이터 업데이트
                        FactCheckChatSession session = getOrCreateSession(sessionId);
                        if (session.getMetadata() != null) {
                            Integer count = session.getMetadata().getFactCheckCount();
                            session.getMetadata().setFactCheckCount(count != null ? count + 1 : 1);
                            saveSession(session);
                        }
                        
                        // 처리 상태 해제
                        processingSessions.remove(sessionId);
                        
                        sink.complete();
                    })
                    .doOnError(error -> {
                        log.error("Fact check failed for session {}: {}", sessionId, error.getMessage());
                        
                        // 에러 메시지 저장
                        addToHistory(sessionId, "팩트체크 중 오류 발생: " + error.getMessage(), 
                                FactCheckChatSession.MessageType.ERROR);
                        
                        sink.next(ChatEvent.builder()
                                .type("error")
                                .role("system")
                                .content("❌ 팩트체크 중 오류가 발생했습니다: " + error.getMessage())
                                .timestamp(System.currentTimeMillis())
                                .build());
                        
                        // 메트릭 기록
                        timerSample.stop(factCheckTimer);
                        factCheckErrorCounter.increment();
                        
                        // 처리 상태 해제
                        processingSessions.remove(sessionId);
                        
                        sink.error(error);
                    })
                    .subscribe();
                    
        } catch (Exception e) {
            log.error("Failed to execute fact check for session {}: {}", sessionId, e.getMessage());
            factCheckErrorCounter.increment();
            processingSessions.remove(sessionId);
            sink.error(e);
        }
    }

    /**
     * DeepAnalysisEvent를 ChatEvent로 변환
     */
    private ChatEvent convertToChatEvent(DeepAnalysisEvent event) {
        ChatEvent.ChatEventBuilder builder = ChatEvent.builder()
                .type(event.getEventType())
                .role("assistant")
                .content(event.getMessage())
                .phase(event.getPhase())
                .timestamp(System.currentTimeMillis());

        // 증거 정보 추가
        if (event.getEvidence() != null && !event.getEvidence().isEmpty()) {
            builder.evidence(event.getEvidence());
        }

        // 검증 결과 추가
        if (event.getVerificationResult() != null) {
            builder.verificationResult(event.getVerificationResult());
        }

        // 신뢰도 평가 추가
        if (event.getCredibility() != null) {
            builder.credibility(event.getCredibility());
        }

        return builder.build();
    }

    /**
     * 세션 저장 (MongoDB + Redis 캐시 갱신)
     */
    private FactCheckChatSession saveSession(FactCheckChatSession session) {
        session.setLastActivityAt(LocalDateTime.now());
        FactCheckChatSession saved = sessionRepository.save(session);
        
        // 캐시 업데이트
        putSessionToCache(saved);
        evictMessagesCache(session.getSessionId());
        
        // 백그라운드 동기화 트리거
        chatSyncService.scheduleSyncIfNeeded(saved);
        
        return saved;
    }

    /**
     * 이력에 메시지 추가
     */
    private void addToHistory(String sessionId, String content, FactCheckChatSession.MessageType type) {
        try {
            FactCheckChatSession session = getOrCreateSession(sessionId);
            
            FactCheckChatSession.ChatMessage message = FactCheckChatSession.ChatMessage.builder()
                    .messageId(UUID.randomUUID().toString())
                    .role("assistant")
                    .content(content)
                    .timestamp(System.currentTimeMillis())
                    .type(type)
                    .build();
            
            session.getMessages().add(message);
            saveSession(session);
            
            log.debug("Added message to history for session {}: type={}", sessionId, type);
        } catch (Exception e) {
            log.error("Failed to add message to history for session {}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * 메시지 추가 및 저장 (공개 메서드)
     */
    public void addMessageToSession(String sessionId, FactCheckChatSession.ChatMessage message) {
        FactCheckChatSession session = getOrCreateSession(sessionId);
        session.getMessages().add(message);
        updateSessionMetadata(session);
        saveSession(session);
    }

    /**
     * 세션 메타데이터 업데이트
     */
    private void updateSessionMetadata(FactCheckChatSession session) {
        if (session.getMetadata() == null) {
            session.setMetadata(FactCheckChatSession.SessionMetadata.builder()
                    .messageCount(0)
                    .factCheckCount(0)
                    .build());
        }
        session.getMetadata().setMessageCount(session.getMessages().size());
    }

    /**
     * 세션 이력 조회
     */
    @Timed(value = "factcheck.chat.history.get", description = "Time to get chat history")
    public List<ChatMessage> getHistory(String sessionId) {
        // 1. 캐시에서 먼저 조회
        List<ChatMessage> cached = getCachedMessages(sessionId);
        if (cached != null) {
            log.debug("History for session {} found in cache", sessionId);
            return cached;
        }

        // 2. MongoDB에서 조회
        List<ChatMessage> history = sessionRepository.findBySessionId(sessionId)
                .map(session -> session.getMessages().stream()
                        .map(msg -> ChatMessage.builder()
                                .role(msg.getRole())
                                .content(msg.getContent())
                                .timestamp(msg.getTimestamp())
                                .build())
                        .collect(Collectors.toList()))
                .orElse(new ArrayList<>());
        
        // 캐시에 저장
        putMessagesToCache(sessionId, history);
        
        return history;
    }

    /**
     * 세션 종료
     */
    public void closeSession(String sessionId) {
        sessionRepository.findBySessionId(sessionId).ifPresent(session -> {
            session.setStatus(FactCheckChatSession.SessionStatus.COMPLETED);
            session.setEndedAt(LocalDateTime.now());
            sessionRepository.save(session);
            
            // 캐시 삭제
            evictSessionCache(sessionId);
            evictMessagesCache(sessionId);
            
            // 최종 동기화 트리거
            chatSyncService.syncSessionToRdb(session);
            
            // 메트릭 업데이트
            sessionClosedCounter.increment();
            activeSessionsGauge.decrementAndGet();
            
            // 처리 상태 정리
            processingSessions.remove(sessionId);
            
            log.info("Closed fact-check chat session: {}", sessionId);
        });
    }

    /**
     * 사용자별 세션 목록 조회
     */
    public List<FactCheckChatSession> getUserSessions(String userId) {
        return sessionRepository.findByUserIdOrderByStartedAtDesc(userId);
    }

    /**
     * 세션 상태 조회
     */
    public FactCheckChatSession.SessionStatus getSessionStatus(String sessionId) {
        return sessionRepository.findBySessionId(sessionId)
                .map(FactCheckChatSession::getStatus)
                .orElse(null);
    }

    // =====================
    // 캐시 관리 메서드
    // =====================

    private FactCheckChatSession getCachedSession(String sessionId) {
        try {
            var cache = cacheManager.getCache(CACHE_NAME_SESSIONS);
            if (cache != null) {
                var wrapper = cache.get(sessionId, FactCheckChatSession.class);
                return wrapper;
            }
        } catch (Exception e) {
            log.warn("Failed to get session from cache: {}", e.getMessage());
        }
        return null;
    }

    private void putSessionToCache(FactCheckChatSession session) {
        try {
            var cache = cacheManager.getCache(CACHE_NAME_SESSIONS);
            if (cache != null) {
                cache.put(session.getSessionId(), session);
            }
        } catch (Exception e) {
            log.warn("Failed to put session to cache: {}", e.getMessage());
        }
    }

    private void evictSessionCache(String sessionId) {
        try {
            var cache = cacheManager.getCache(CACHE_NAME_SESSIONS);
            if (cache != null) {
                cache.evict(sessionId);
            }
        } catch (Exception e) {
            log.warn("Failed to evict session from cache: {}", e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private List<ChatMessage> getCachedMessages(String sessionId) {
        try {
            var cache = cacheManager.getCache(CACHE_NAME_MESSAGES);
            if (cache != null) {
                return cache.get(sessionId, List.class);
            }
        } catch (Exception e) {
            log.warn("Failed to get messages from cache: {}", e.getMessage());
        }
        return null;
    }

    private void putMessagesToCache(String sessionId, List<ChatMessage> messages) {
        try {
            var cache = cacheManager.getCache(CACHE_NAME_MESSAGES);
            if (cache != null) {
                cache.put(sessionId, messages);
            }
        } catch (Exception e) {
            log.warn("Failed to put messages to cache: {}", e.getMessage());
        }
    }

    private void evictMessagesCache(String sessionId) {
        try {
            var cache = cacheManager.getCache(CACHE_NAME_MESSAGES);
            if (cache != null) {
                cache.evict(sessionId);
            }
        } catch (Exception e) {
            log.warn("Failed to evict messages from cache: {}", e.getMessage());
        }
    }

    /**
     * 챗봇 이벤트 DTO
     */
    @Data
    @Builder
    public static class ChatEvent {
        private String type;        // message, status, evidence, verification, assessment, ai_synthesis, complete, error
        private String role;        // user, assistant, system
        private String content;     // 메시지 내용
        private String phase;       // init, concepts, verification, assessment, synthesis, complete
        private Long timestamp;
        
        // 추가 데이터
        private Object evidence;
        private Object verificationResult;
        private Object credibility;
    }
}
