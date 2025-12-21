package com.newsinsight.collector.service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.MediaType;
import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 벡터 임베딩 서비스
 * 
 * 채팅 메시지를 벡터 DB에 임베딩하여 저장합니다.
 * 유사 질문 검색, 컨텍스트 검색 등에 활용됩니다.
 * 
 * 개선사항:
 * - 자동 초기화 (ApplicationReadyEvent)
 * - 재시도 로직 (Retry)
 * - 배치 임베딩 지원
 * - 연결 상태 확인
 * - 메트릭 수집
 * - 로컬 임베딩 대체 지원
 */
@Service
@Slf4j
public class VectorEmbeddingService {

    private final WebClient webClient;
    private final MeterRegistry meterRegistry;

    @Value("${vector.db.enabled:false}")
    private boolean vectorDbEnabled;

    @Value("${vector.db.url:http://localhost:6333}")
    private String vectorDbUrl;

    @Value("${vector.db.collection:factcheck_chat}")
    private String collectionName;

    @Value("${vector.embedding.model:text-embedding-ada-002}")
    private String embeddingModel;

    @Value("${vector.embedding.api-key:}")
    private String apiKey;

    @Value("${vector.embedding.dimension:1536}")
    private int embeddingDimension;

    @Value("${vector.embedding.timeout-seconds:30}")
    private int timeoutSeconds;

    @Value("${vector.embedding.max-retry:3}")
    private int maxRetry;

    @Value("${vector.embedding.batch-size:10}")
    private int batchSize;

    // 로컬 임베딩 서비스 설정 (HuggingFace TEI 등)
    @Value("${vector.embedding.local.enabled:false}")
    private boolean localEmbeddingEnabled;

    @Value("${vector.embedding.local.url:http://localhost:8011}")
    private String localEmbeddingUrl;

    // 상태 플래그
    private final AtomicBoolean vectorDbHealthy = new AtomicBoolean(false);
    private final AtomicBoolean embeddingServiceHealthy = new AtomicBoolean(false);

    // 메트릭
    private Counter embeddingSuccessCounter;
    private Counter embeddingErrorCounter;
    private Counter searchSuccessCounter;
    private Counter searchErrorCounter;
    private Timer embeddingDurationTimer;
    private Timer searchDurationTimer;
    private final AtomicLong embeddingQueueSize = new AtomicLong(0);

    public VectorEmbeddingService(WebClient.Builder webClientBuilder, MeterRegistry meterRegistry) {
        this.webClient = webClientBuilder
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(16 * 1024 * 1024))
                .build();
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    public void initMetrics() {
        embeddingSuccessCounter = Counter.builder("vector.embedding.success")
                .description("Number of successful embeddings")
                .register(meterRegistry);

        embeddingErrorCounter = Counter.builder("vector.embedding.error")
                .description("Number of failed embeddings")
                .register(meterRegistry);

        searchSuccessCounter = Counter.builder("vector.search.success")
                .description("Number of successful searches")
                .register(meterRegistry);

        searchErrorCounter = Counter.builder("vector.search.error")
                .description("Number of failed searches")
                .register(meterRegistry);

        embeddingDurationTimer = Timer.builder("vector.embedding.duration")
                .description("Time taken for embedding generation")
                .register(meterRegistry);

        searchDurationTimer = Timer.builder("vector.search.duration")
                .description("Time taken for vector search")
                .register(meterRegistry);

        meterRegistry.gauge("vector.embedding.queue.size", embeddingQueueSize);
        meterRegistry.gauge("vector.db.healthy", vectorDbHealthy, b -> b.get() ? 1.0 : 0.0);
        meterRegistry.gauge("vector.embedding.service.healthy", embeddingServiceHealthy, b -> b.get() ? 1.0 : 0.0);
    }

    /**
     * 애플리케이션 시작 시 벡터 DB 초기화
     */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        if (vectorDbEnabled) {
            log.info("Initializing Vector DB on application startup...");
            initializeVectorDb();
            checkVectorDbHealth();
            checkEmbeddingServiceHealth();
        } else {
            log.info("Vector DB is disabled");
        }
    }

    /**
     * 채팅 메시지를 벡터 DB에 임베딩
     * 
     * @param sessionId 세션 ID
     * @param messageId 메시지 ID
     * @param content 메시지 내용
     * @param metadata 메타데이터
     * @return 임베딩 ID
     */
    @Retryable(
            retryFor = {WebClientResponseException.class},
            maxAttempts = 3,
            backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public String embedChatMessage(String sessionId, String messageId, String content, Object metadata) {
        if (!vectorDbEnabled) {
            log.debug("Vector DB is disabled, skipping embedding");
            return null;
        }

        if (!vectorDbHealthy.get()) {
            log.warn("Vector DB is not healthy, skipping embedding");
            return null;
        }

        Timer.Sample sample = Timer.start(meterRegistry);
        embeddingQueueSize.incrementAndGet();

        try {
            // 1. 텍스트 임베딩 생성
            List<Double> embedding = generateEmbeddingWithFallback(content);

            if (embedding == null || embedding.isEmpty()) {
                log.error("Failed to generate embedding for message {}", messageId);
                embeddingErrorCounter.increment();
                return null;
            }

            // 2. 벡터 DB에 저장
            String embeddingId = UUID.randomUUID().toString();
            storeEmbedding(embeddingId, sessionId, messageId, content, embedding, metadata);

            sample.stop(embeddingDurationTimer);
            embeddingSuccessCounter.increment();
            
            log.info("Embedded message {} to vector DB with ID: {}", messageId, embeddingId);
            return embeddingId;

        } catch (Exception e) {
            log.error("Failed to embed message {}: {}", messageId, e.getMessage(), e);
            sample.stop(embeddingDurationTimer);
            embeddingErrorCounter.increment();
            return null;
        } finally {
            embeddingQueueSize.decrementAndGet();
        }
    }

    /**
     * 배치로 여러 메시지 임베딩
     */
    public List<String> embedChatMessagesBatch(List<EmbeddingRequest> requests) {
        if (!vectorDbEnabled || !vectorDbHealthy.get()) {
            return Collections.emptyList();
        }

        List<String> embeddingIds = new ArrayList<>();
        
        // 배치 크기로 나누어 처리
        for (int i = 0; i < requests.size(); i += batchSize) {
            List<EmbeddingRequest> batch = requests.subList(i, Math.min(i + batchSize, requests.size()));
            
            for (EmbeddingRequest request : batch) {
                String embeddingId = embedChatMessage(
                        request.getSessionId(),
                        request.getMessageId(),
                        request.getContent(),
                        request.getMetadata()
                );
                if (embeddingId != null) {
                    embeddingIds.add(embeddingId);
                }
            }
        }
        
        return embeddingIds;
    }

    /**
     * 텍스트 임베딩 생성 (폴백 포함)
     */
    private List<Double> generateEmbeddingWithFallback(String text) {
        // 1. 로컬 임베딩 서비스 시도
        if (localEmbeddingEnabled && embeddingServiceHealthy.get()) {
            try {
                List<Double> embedding = generateLocalEmbedding(text);
                if (embedding != null && !embedding.isEmpty()) {
                    return embedding;
                }
            } catch (Exception e) {
                log.warn("Local embedding failed, falling back to OpenAI: {}", e.getMessage());
            }
        }

        // 2. OpenAI API 시도
        if (apiKey != null && !apiKey.isBlank()) {
            try {
                return generateOpenAIEmbedding(text);
            } catch (Exception e) {
                log.error("OpenAI embedding failed: {}", e.getMessage());
            }
        }

        // 3. 더미 임베딩 (최후의 수단)
        log.warn("All embedding methods failed, using dummy embedding");
        return generateDummyEmbedding();
    }

    /**
     * 로컬 임베딩 서비스로 임베딩 생성 (HuggingFace TEI)
     */
    private List<Double> generateLocalEmbedding(String text) {
        Map<String, Object> request = new HashMap<>();
        request.put("inputs", text);

        return webClient.post()
                .uri(localEmbeddingUrl + "/embed")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(List.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .retryWhen(Retry.backoff(maxRetry, Duration.ofSeconds(1)))
                .block();
    }

    /**
     * OpenAI API로 임베딩 생성
     */
    @SuppressWarnings("unchecked")
    private List<Double> generateOpenAIEmbedding(String text) {
        Map<String, Object> request = new HashMap<>();
        request.put("input", text);
        request.put("model", embeddingModel);

        Map<String, Object> response = webClient.post()
                .uri("https://api.openai.com/v1/embeddings")
                .header("Authorization", "Bearer " + apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(Map.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .retryWhen(Retry.backoff(maxRetry, Duration.ofSeconds(1)))
                .block();

        if (response != null && response.containsKey("data")) {
            List<Map<String, Object>> data = (List<Map<String, Object>>) response.get("data");
            if (!data.isEmpty()) {
                return (List<Double>) data.get(0).get("embedding");
            }
        }

        return null;
    }

    /**
     * 벡터 DB에 임베딩 저장 (Qdrant)
     */
    private void storeEmbedding(
            String embeddingId,
            String sessionId,
            String messageId,
            String content,
            List<Double> embedding,
            Object metadata
    ) {
        Map<String, Object> point = new HashMap<>();
        point.put("id", embeddingId);
        point.put("vector", embedding);

        Map<String, Object> payload = new HashMap<>();
        payload.put("session_id", sessionId);
        payload.put("message_id", messageId);
        payload.put("content", content);
        payload.put("metadata", metadata);
        payload.put("timestamp", System.currentTimeMillis());
        payload.put("created_at", java.time.Instant.now().toString());
        point.put("payload", payload);

        Map<String, Object> request = new HashMap<>();
        request.put("points", List.of(point));

        webClient.put()
                .uri(vectorDbUrl + "/collections/" + collectionName + "/points")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(Void.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .retryWhen(Retry.backoff(maxRetry, Duration.ofSeconds(1)))
                .block();

        log.debug("Stored embedding {} in vector DB", embeddingId);
    }

    /**
     * 유사 메시지 검색
     * 
     * @param queryText 검색 쿼리
     * @param limit 결과 개수
     * @return 유사 메시지 목록
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> searchSimilarMessages(String queryText, int limit) {
        return searchSimilarMessages(queryText, limit, 0.5f);
    }

    /**
     * 유사 메시지 검색 (최소 점수 지정)
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> searchSimilarMessages(String queryText, int limit, float minScore) {
        if (!vectorDbEnabled || !vectorDbHealthy.get()) {
            return List.of();
        }

        Timer.Sample sample = Timer.start(meterRegistry);

        try {
            List<Double> queryEmbedding = generateEmbeddingWithFallback(queryText);
            
            if (queryEmbedding == null || queryEmbedding.isEmpty()) {
                log.error("Failed to generate query embedding");
                searchErrorCounter.increment();
                return List.of();
            }

            Map<String, Object> request = new HashMap<>();
            request.put("vector", queryEmbedding);
            request.put("limit", limit);
            request.put("with_payload", true);
            request.put("score_threshold", minScore);

            Map<String, Object> response = webClient.post()
                    .uri(vectorDbUrl + "/collections/" + collectionName + "/points/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .retryWhen(Retry.backoff(maxRetry, Duration.ofSeconds(1)))
                    .block();

            sample.stop(searchDurationTimer);
            searchSuccessCounter.increment();

            if (response != null && response.containsKey("result")) {
                return (List<Map<String, Object>>) response.get("result");
            }

            return List.of();

        } catch (Exception e) {
            log.error("Failed to search similar messages: {}", e.getMessage());
            sample.stop(searchDurationTimer);
            searchErrorCounter.increment();
            return List.of();
        }
    }

    /**
     * 세션 ID로 필터링된 유사 메시지 검색
     */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> searchSimilarMessagesInSession(String queryText, String sessionId, int limit) {
        if (!vectorDbEnabled || !vectorDbHealthy.get()) {
            return List.of();
        }

        try {
            List<Double> queryEmbedding = generateEmbeddingWithFallback(queryText);
            
            if (queryEmbedding == null || queryEmbedding.isEmpty()) {
                return List.of();
            }

            Map<String, Object> filter = Map.of(
                    "must", List.of(
                            Map.of("key", "session_id",
                                   "match", Map.of("value", sessionId))
                    )
            );

            Map<String, Object> request = new HashMap<>();
            request.put("vector", queryEmbedding);
            request.put("limit", limit);
            request.put("with_payload", true);
            request.put("filter", filter);

            Map<String, Object> response = webClient.post()
                    .uri(vectorDbUrl + "/collections/" + collectionName + "/points/search")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .block();

            if (response != null && response.containsKey("result")) {
                return (List<Map<String, Object>>) response.get("result");
            }

            return List.of();

        } catch (Exception e) {
            log.error("Failed to search similar messages in session: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 더미 임베딩 생성 (테스트용)
     */
    private List<Double> generateDummyEmbedding() {
        List<Double> dummy = new ArrayList<>();
        Random random = new Random(System.currentTimeMillis());
        for (int i = 0; i < embeddingDimension; i++) {
            dummy.add(random.nextGaussian() * 0.1);
        }
        // 정규화
        double norm = Math.sqrt(dummy.stream().mapToDouble(d -> d * d).sum());
        return dummy.stream().map(d -> d / norm).toList();
    }

    /**
     * 벡터 DB 초기화 (컬렉션 생성)
     */
    public void initializeVectorDb() {
        if (!vectorDbEnabled) {
            return;
        }

        try {
            // 1. 컬렉션 존재 여부 확인
            Boolean exists = checkCollectionExists();
            
            if (Boolean.TRUE.equals(exists)) {
                log.info("Vector DB collection '{}' already exists", collectionName);
                vectorDbHealthy.set(true);
                return;
            }

            // 2. 컬렉션 생성
            Map<String, Object> config = new HashMap<>();
            config.put("vectors", Map.of(
                    "size", embeddingDimension,
                    "distance", "Cosine"
            ));

            // 최적화 설정
            config.put("optimizers_config", Map.of(
                    "indexing_threshold", 20000,
                    "memmap_threshold", 50000
            ));

            webClient.put()
                    .uri(vectorDbUrl + "/collections/" + collectionName)
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(config)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .timeout(Duration.ofSeconds(30))
                    .block();

            // 3. 인덱스 생성
            createPayloadIndex("session_id");
            createPayloadIndex("message_id");

            vectorDbHealthy.set(true);
            log.info("Initialized vector DB collection: {}", collectionName);

        } catch (Exception e) {
            log.error("Vector DB initialization failed: {}", e.getMessage());
            vectorDbHealthy.set(false);
        }
    }

    /**
     * 컬렉션 존재 여부 확인
     */
    @SuppressWarnings("unchecked")
    private Boolean checkCollectionExists() {
        try {
            Map<String, Object> response = webClient.get()
                    .uri(vectorDbUrl + "/collections/" + collectionName)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(Duration.ofSeconds(10))
                    .block();
            return response != null && response.containsKey("result");
        } catch (WebClientResponseException.NotFound e) {
            return false;
        } catch (Exception e) {
            log.warn("Failed to check collection existence: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 페이로드 인덱스 생성
     */
    private void createPayloadIndex(String fieldName) {
        try {
            Map<String, Object> request = Map.of(
                    "field_name", fieldName,
                    "field_schema", "keyword"
            );

            webClient.put()
                    .uri(vectorDbUrl + "/collections/" + collectionName + "/index")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .timeout(Duration.ofSeconds(10))
                    .block();

            log.debug("Created payload index for field: {}", fieldName);
        } catch (Exception e) {
            log.warn("Failed to create payload index for {}: {}", fieldName, e.getMessage());
        }
    }

    /**
     * 벡터 DB 헬스 체크
     */
    public void checkVectorDbHealth() {
        if (!vectorDbEnabled) {
            vectorDbHealthy.set(false);
            return;
        }

        try {
            webClient.get()
                    .uri(vectorDbUrl + "/")
                    .retrieve()
                    .bodyToMono(Map.class)
                    .timeout(Duration.ofSeconds(5))
                    .block();
            
            vectorDbHealthy.set(true);
            log.debug("Vector DB health check passed");
        } catch (Exception e) {
            vectorDbHealthy.set(false);
            log.warn("Vector DB health check failed: {}", e.getMessage());
        }
    }

    /**
     * 임베딩 서비스 헬스 체크
     */
    public void checkEmbeddingServiceHealth() {
        if (!localEmbeddingEnabled) {
            embeddingServiceHealthy.set(apiKey != null && !apiKey.isBlank());
            return;
        }

        try {
            webClient.get()
                    .uri(localEmbeddingUrl + "/health")
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(5))
                    .block();
            
            embeddingServiceHealthy.set(true);
            log.debug("Embedding service health check passed");
        } catch (Exception e) {
            embeddingServiceHealthy.set(apiKey != null && !apiKey.isBlank());
            log.warn("Local embedding service health check failed, using OpenAI: {}", e.getMessage());
        }
    }

    /**
     * 임베딩 삭제
     */
    public boolean deleteEmbedding(String embeddingId) {
        if (!vectorDbEnabled || !vectorDbHealthy.get()) {
            return false;
        }

        try {
            Map<String, Object> request = Map.of(
                    "points", List.of(embeddingId)
            );

            webClient.post()
                    .uri(vectorDbUrl + "/collections/" + collectionName + "/points/delete")
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(request)
                    .retrieve()
                    .bodyToMono(Void.class)
                    .timeout(Duration.ofSeconds(10))
                    .block();

            log.info("Deleted embedding: {}", embeddingId);
            return true;
        } catch (Exception e) {
            log.error("Failed to delete embedding {}: {}", embeddingId, e.getMessage());
            return false;
        }
    }

    /**
     * 서비스 상태 조회
     */
    public VectorServiceStatus getStatus() {
        return VectorServiceStatus.builder()
                .enabled(vectorDbEnabled)
                .vectorDbHealthy(vectorDbHealthy.get())
                .embeddingServiceHealthy(embeddingServiceHealthy.get())
                .queueSize(embeddingQueueSize.get())
                .vectorDbUrl(vectorDbUrl)
                .collectionName(collectionName)
                .embeddingModel(embeddingModel)
                .embeddingDimension(embeddingDimension)
                .localEmbeddingEnabled(localEmbeddingEnabled)
                .build();
    }

    /**
     * 임베딩 요청 DTO
     */
    @lombok.Data
    @lombok.Builder
    @lombok.NoArgsConstructor
    @lombok.AllArgsConstructor
    public static class EmbeddingRequest {
        private String sessionId;
        private String messageId;
        private String content;
        private Object metadata;
    }

    /**
     * 서비스 상태 DTO
     */
    @lombok.Data
    @lombok.Builder
    public static class VectorServiceStatus {
        private boolean enabled;
        private boolean vectorDbHealthy;
        private boolean embeddingServiceHealthy;
        private long queueSize;
        private String vectorDbUrl;
        private String collectionName;
        private String embeddingModel;
        private int embeddingDimension;
        private boolean localEmbeddingEnabled;
    }
}
