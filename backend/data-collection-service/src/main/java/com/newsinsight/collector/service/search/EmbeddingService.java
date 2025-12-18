package com.newsinsight.collector.service.search;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import jakarta.annotation.PostConstruct;
import java.time.Duration;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * 텍스트 임베딩 서비스.
 * HuggingFace Text Embeddings Inference (TEI) 서버와 연동하여
 * 텍스트를 벡터로 변환합니다.
 * 
 * 지원 모델:
 * - intfloat/multilingual-e5-large (다국어, 1024차원)
 * - sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (다국어, 384차원)
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EmbeddingService {

    @Value("${collector.embedding.enabled:true}")
    private boolean enabled;

    @Value("${collector.embedding.base-url:http://localhost:8011}")
    private String baseUrl;

    @Value("${collector.embedding.model:intfloat/multilingual-e5-large}")
    private String modelName;

    @Value("${collector.embedding.timeout-seconds:30}")
    private int timeoutSeconds;

    @Value("${collector.embedding.dimension:1024}")
    private int embeddingDimension;

    private WebClient webClient;

    @PostConstruct
    public void init() {
        this.webClient = WebClient.builder()
                .baseUrl(baseUrl)
                .build();
        log.info("EmbeddingService initialized: enabled={}, baseUrl={}, model={}, dimension={}", 
                enabled, baseUrl, modelName, embeddingDimension);
    }

    /**
     * 텍스트를 벡터로 변환합니다.
     *
     * @param text 변환할 텍스트
     * @return 임베딩 벡터 (float 배열)
     */
    public Mono<float[]> embed(String text) {
        if (!enabled) {
            return Mono.empty();
        }

        if (text == null || text.isBlank()) {
            return Mono.just(new float[embeddingDimension]);
        }

        // E5 모델은 검색 쿼리에 "query: " 접두사를 붙이면 성능이 향상됨
        String processedText = text.length() > 8000 ? text.substring(0, 8000) : text;

        return webClient.post()
                .uri("/embed")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("inputs", processedText))
                .retrieve()
                .bodyToMono(float[][].class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .map(result -> result != null && result.length > 0 ? result[0] : new float[embeddingDimension])
                .doOnError(e -> log.error("Embedding failed for text (length={}): {}", 
                        text.length(), e.getMessage()))
                .onErrorReturn(new float[embeddingDimension]);
    }

    /**
     * 검색 쿼리를 벡터로 변환합니다.
     * E5 모델의 경우 "query: " 접두사를 추가합니다.
     *
     * @param query 검색 쿼리
     * @return 임베딩 벡터
     */
    public Mono<float[]> embedQuery(String query) {
        if (!enabled) {
            return Mono.empty();
        }

        // E5 모델용 쿼리 접두사
        String prefixedQuery = modelName.contains("e5") 
                ? "query: " + query 
                : query;
        
        return embed(prefixedQuery);
    }

    /**
     * 문서를 벡터로 변환합니다.
     * E5 모델의 경우 "passage: " 접두사를 추가합니다.
     *
     * @param document 문서 텍스트
     * @return 임베딩 벡터
     */
    public Mono<float[]> embedDocument(String document) {
        if (!enabled) {
            return Mono.empty();
        }

        // E5 모델용 문서 접두사
        String prefixedDoc = modelName.contains("e5") 
                ? "passage: " + document 
                : document;
        
        return embed(prefixedDoc);
    }

    /**
     * 여러 텍스트를 일괄 벡터 변환합니다.
     *
     * @param texts 변환할 텍스트 목록
     * @return 임베딩 벡터 목록
     */
    public Mono<List<float[]>> embedBatch(List<String> texts) {
        if (!enabled || texts == null || texts.isEmpty()) {
            return Mono.just(List.of());
        }

        // 텍스트 전처리
        List<String> processedTexts = texts.stream()
                .map(t -> t != null && t.length() > 8000 ? t.substring(0, 8000) : t)
                .map(t -> t != null ? t : "")
                .toList();

        return webClient.post()
                .uri("/embed")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of("inputs", processedTexts))
                .retrieve()
                .bodyToMono(float[][].class)
                .timeout(Duration.ofSeconds(timeoutSeconds * 2))
                .map(result -> result != null ? List.of(result) : List.<float[]>of())
                .doOnError(e -> log.error("Batch embedding failed for {} texts: {}", 
                        texts.size(), e.getMessage()))
                .onErrorResume(e -> Mono.just(List.<float[]>of()));
    }

    /**
     * 두 벡터 간의 코사인 유사도를 계산합니다.
     *
     * @param vec1 첫 번째 벡터
     * @param vec2 두 번째 벡터
     * @return 코사인 유사도 (-1 ~ 1)
     */
    public double cosineSimilarity(float[] vec1, float[] vec2) {
        if (vec1 == null || vec2 == null || vec1.length != vec2.length) {
            return 0.0;
        }

        double dotProduct = 0.0;
        double norm1 = 0.0;
        double norm2 = 0.0;

        for (int i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        if (norm1 == 0 || norm2 == 0) {
            return 0.0;
        }

        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    /**
     * 서비스 활성화 여부를 반환합니다.
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * 임베딩 차원을 반환합니다.
     */
    public int getDimension() {
        return embeddingDimension;
    }

    /**
     * 임베딩 서버 상태를 확인합니다.
     */
    public Mono<Boolean> healthCheck() {
        if (!enabled) {
            return Mono.just(false);
        }

        return webClient.get()
                .uri("/health")
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(5))
                .map(response -> true)
                .onErrorReturn(false);
    }
}
