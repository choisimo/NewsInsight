package com.newsinsight.collector.service.factcheck;

import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import com.newsinsight.collector.service.search.EmbeddingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 시맨틱 유사도 기반 관련성 필터
 * 
 * 벡터 임베딩을 사용하여 검색 결과의 의미적 관련성을 평가하고,
 * 키워드는 매칭되지만 문맥상 관련 없는 결과를 필터링합니다.
 * 
 * 예시:
 * - 쿼리: "전기차 배터리 수명"
 * - 필터링 대상: "차(tea)"가 포함된 음료 관련 문서
 * - 통과: "electric vehicle battery"가 포함된 기술 문서
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SemanticRelevanceFilter {

    private final EmbeddingService embeddingService;
    
    @Value("${collector.fact-check.semantic-filter.min-similarity:0.3}")
    private double minSemanticSimilarity; // 최소 시맨틱 유사도 (0-1)
    
    @Value("${collector.fact-check.semantic-filter.enabled:true}")
    private boolean enabled;
    
    // 쿼리 임베딩 캐시 (동일 쿼리 반복 임베딩 방지)
    private final ConcurrentHashMap<String, float[]> queryEmbeddingCache = new ConcurrentHashMap<>();
    private static final int MAX_CACHE_SIZE = 100;

    /**
     * 증거 목록을 시맨틱 유사도로 필터링합니다.
     * 
     * @param query 원본 검색 쿼리
     * @param evidences 필터링할 증거 목록
     * @return 시맨틱 유사도가 임계값 이상인 증거만 포함된 목록
     */
    public Mono<List<SourceEvidence>> filterBySemanticRelevance(String query, List<SourceEvidence> evidences) {
        if (!enabled || !embeddingService.isEnabled()) {
            log.debug("Semantic filtering disabled, returning all {} evidences", evidences.size());
            return Mono.just(evidences);
        }

        if (evidences == null || evidences.isEmpty()) {
            return Mono.just(List.of());
        }

        // 쿼리 임베딩 가져오기 (캐시 활용)
        return getQueryEmbedding(query)
                .flatMap(queryEmbedding -> {
                    if (queryEmbedding == null || queryEmbedding.length == 0) {
                        log.warn("Failed to get query embedding, skipping semantic filter");
                        return Mono.just(evidences);
                    }

                    List<SourceEvidence> filtered = new ArrayList<>();
                    int filteredCount = 0;

                    for (SourceEvidence evidence : evidences) {
                        String content = buildEvidenceContent(evidence);
                        
                        // 증거 임베딩 및 유사도 계산
                        float[] evidenceEmbedding = embeddingService.embedDocument(content)
                                .block();
                        
                        if (evidenceEmbedding != null && evidenceEmbedding.length > 0) {
                            double similarity = embeddingService.cosineSimilarity(queryEmbedding, evidenceEmbedding);
                            
                            if (similarity >= minSemanticSimilarity) {
                                // 시맨틱 유사도를 relevanceScore에 반영
                                if (evidence.getRelevanceScore() != null) {
                                    // 기존 점수와 시맨틱 유사도의 가중 평균
                                    double combinedScore = (evidence.getRelevanceScore() * 0.6) + (similarity * 0.4);
                                    evidence.setRelevanceScore(combinedScore);
                                } else {
                                    evidence.setRelevanceScore(similarity);
                                }
                                filtered.add(evidence);
                            } else {
                                filteredCount++;
                                log.debug("Filtered out evidence (similarity={:.2f}): {}", 
                                        similarity, truncate(content, 100));
                            }
                        } else {
                            // 임베딩 실패 시 통과 (보수적 접근)
                            filtered.add(evidence);
                        }
                    }

                    if (filteredCount > 0) {
                        log.info("Semantic filter removed {} irrelevant evidences ({}→{})", 
                                filteredCount, evidences.size(), filtered.size());
                    }

                    return Mono.just(filtered);
                })
                .onErrorResume(e -> {
                    log.warn("Semantic filtering failed: {}, returning unfiltered results", e.getMessage());
                    return Mono.just(evidences);
                });
    }

    /**
     * 쿼리 임베딩 가져오기 (캐시 활용)
     */
    private Mono<float[]> getQueryEmbedding(String query) {
        String cacheKey = query.toLowerCase().trim();
        
        // 캐시 확인
        float[] cached = queryEmbeddingCache.get(cacheKey);
        if (cached != null) {
            return Mono.just(cached);
        }

        // 임베딩 생성 및 캐시 저장
        return embeddingService.embedQuery(query)
                .doOnNext(embedding -> {
                    if (embedding != null && queryEmbeddingCache.size() < MAX_CACHE_SIZE) {
                        queryEmbeddingCache.put(cacheKey, embedding);
                    }
                });
    }

    /**
     * 증거에서 임베딩할 콘텐츠 생성
     */
    private String buildEvidenceContent(SourceEvidence evidence) {
        StringBuilder content = new StringBuilder();
        
        if (evidence.getSourceName() != null) {
            content.append(evidence.getSourceName()).append(" ");
        }
        
        if (evidence.getExcerpt() != null) {
            content.append(evidence.getExcerpt());
        }
        
        return content.toString().trim();
    }

    /**
     * 문자열 자르기
     */
    private String truncate(String text, int maxLength) {
        if (text == null || text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "...";
    }

    /**
     * 필터 활성화 여부
     */
    public boolean isEnabled() {
        return enabled && embeddingService.isEnabled();
    }
}
