package com.newsinsight.collector.service.search;

import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.repository.CollectedDataRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import jakarta.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;

/**
 * PostgreSQL pgvector 기반 벡터 검색 서비스.
 * 
 * 시맨틱 검색을 위해 문서 임베딩을 저장하고 유사도 검색을 수행합니다.
 * pgvector 확장이 설치되어 있어야 합니다.
 * 
 * 사용 전 필요한 SQL:
 * CREATE EXTENSION IF NOT EXISTS vector;
 * ALTER TABLE collected_data ADD COLUMN IF NOT EXISTS embedding vector(1024);
 * CREATE INDEX IF NOT EXISTS collected_data_embedding_idx ON collected_data 
 *   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class VectorSearchService {

    private final JdbcTemplate jdbcTemplate;
    private final EmbeddingService embeddingService;
    private final CollectedDataRepository collectedDataRepository;

    @Value("${collector.vector-search.enabled:true}")
    private boolean enabled;

    @Value("${collector.vector-search.top-k:20}")
    private int defaultTopK;

    @Value("${collector.vector-search.min-similarity:0.5}")
    private double minSimilarity;

    @Value("${collector.embedding.dimension:1024}")
    private int embeddingDimension;

    private boolean pgvectorAvailable = false;

    @PostConstruct
    public void init() {
        if (!enabled) {
            log.info("VectorSearchService is disabled");
            return;
        }

        // pgvector 확장 및 컬럼 존재 여부 확인
        try {
            jdbcTemplate.queryForObject(
                    "SELECT 1 FROM pg_extension WHERE extname = 'vector'",
                    Integer.class);
            
            // embedding 컬럼 존재 확인
            Integer columnExists = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.columns " +
                    "WHERE table_name = 'collected_data' AND column_name = 'embedding'",
                    Integer.class);
            
            pgvectorAvailable = columnExists != null && columnExists > 0;
            
            if (pgvectorAvailable) {
                log.info("VectorSearchService initialized: pgvector available, dimension={}", embeddingDimension);
            } else {
                log.warn("VectorSearchService: embedding column not found in collected_data table. " +
                         "Run migration to add vector column.");
            }
        } catch (Exception e) {
            log.warn("VectorSearchService: pgvector extension not available. " +
                     "Install with: CREATE EXTENSION vector;");
            pgvectorAvailable = false;
        }
    }

    /**
     * 쿼리와 유사한 문서를 벡터 검색합니다.
     *
     * @param query 검색 쿼리
     * @param topK 반환할 결과 수
     * @return 유사도순 정렬된 문서 목록
     */
    public Mono<List<ScoredDocument>> searchSimilar(String query, int topK) {
        if (!isAvailable()) {
            return Mono.just(List.of());
        }

        return embeddingService.embedQuery(query)
                .flatMap(queryEmbedding -> {
                    if (queryEmbedding == null || queryEmbedding.length == 0) {
                        return Mono.just(List.<ScoredDocument>of());
                    }
                    return Mono.fromCallable(() -> searchByVector(queryEmbedding, topK));
                })
                .onErrorResume(e -> {
                    log.error("Vector search failed: {}", e.getMessage());
                    return Mono.just(List.<ScoredDocument>of());
                });
    }

    /**
     * 벡터로 직접 유사 문서를 검색합니다.
     *
     * @param queryEmbedding 쿼리 임베딩 벡터
     * @param topK 반환할 결과 수
     * @return 유사도순 정렬된 문서 목록
     */
    public List<ScoredDocument> searchByVector(float[] queryEmbedding, int topK) {
        if (!isAvailable() || queryEmbedding == null) {
            return List.of();
        }

        String vectorStr = vectorToString(queryEmbedding);
        
        // pgvector 코사인 유사도 검색 (1 - cosine_distance)
        String sql = """
                SELECT id, title, url, 
                       1 - (embedding <=> ?::vector) as similarity
                FROM collected_data
                WHERE embedding IS NOT NULL
                  AND 1 - (embedding <=> ?::vector) >= ?
                ORDER BY embedding <=> ?::vector
                LIMIT ?
                """;

        try {
            return jdbcTemplate.query(sql, 
                    (rs, rowNum) -> new ScoredDocument(
                            rs.getLong("id"),
                            rs.getString("title"),
                            rs.getString("url"),
                            rs.getDouble("similarity")
                    ),
                    vectorStr, vectorStr, minSimilarity, vectorStr, topK);
        } catch (Exception e) {
            log.error("Vector search failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 문서에 임베딩을 저장합니다.
     *
     * @param documentId 문서 ID
     * @param content 문서 내용
     * @return 저장 성공 여부
     */
    public Mono<Boolean> saveEmbedding(Long documentId, String content) {
        if (!isAvailable() || content == null || content.isBlank()) {
            return Mono.just(false);
        }

        return embeddingService.embedDocument(content)
                .flatMap(embedding -> {
                    if (embedding == null || embedding.length == 0) {
                        return Mono.just(false);
                    }
                    return Mono.fromCallable(() -> {
                        String vectorStr = vectorToString(embedding);
                        int updated = jdbcTemplate.update(
                                "UPDATE collected_data SET embedding = ?::vector WHERE id = ?",
                                vectorStr, documentId);
                        return updated > 0;
                    });
                })
                .onErrorReturn(false);
    }

    /**
     * 여러 문서의 임베딩을 일괄 저장합니다.
     *
     * @param documents 문서 목록 (ID, 내용)
     * @return 저장된 문서 수
     */
    public Mono<Integer> saveEmbeddingsBatch(List<DocumentContent> documents) {
        if (!isAvailable() || documents == null || documents.isEmpty()) {
            return Mono.just(0);
        }

        List<String> contents = documents.stream()
                .map(DocumentContent::content)
                .toList();

        return embeddingService.embedBatch(contents)
                .map(embeddings -> {
                    int savedCount = 0;
                    for (int i = 0; i < Math.min(documents.size(), embeddings.size()); i++) {
                        try {
                            String vectorStr = vectorToString(embeddings.get(i));
                            int updated = jdbcTemplate.update(
                                    "UPDATE collected_data SET embedding = ?::vector WHERE id = ?",
                                    vectorStr, documents.get(i).id());
                            if (updated > 0) savedCount++;
                        } catch (Exception e) {
                            log.debug("Failed to save embedding for document {}: {}", 
                                    documents.get(i).id(), e.getMessage());
                        }
                    }
                    return savedCount;
                })
                .onErrorReturn(0);
    }

    /**
     * 임베딩이 없는 문서에 대해 임베딩을 생성합니다.
     *
     * @param batchSize 한 번에 처리할 문서 수
     * @return 처리된 문서 수
     */
    public Mono<Integer> indexMissingEmbeddings(int batchSize) {
        if (!isAvailable()) {
            return Mono.just(0);
        }

        try {
            // 임베딩이 없는 문서 조회
            List<DocumentContent> documents = jdbcTemplate.query(
                    "SELECT id, COALESCE(title, '') || ' ' || COALESCE(content, '') as content " +
                    "FROM collected_data WHERE embedding IS NULL LIMIT ?",
                    (rs, rowNum) -> new DocumentContent(
                            rs.getLong("id"),
                            rs.getString("content")
                    ),
                    batchSize);

            if (documents.isEmpty()) {
                return Mono.just(0);
            }

            log.info("Indexing {} documents without embeddings", documents.size());
            return saveEmbeddingsBatch(documents);
        } catch (Exception e) {
            log.error("Failed to index missing embeddings: {}", e.getMessage());
            return Mono.just(0);
        }
    }

    /**
     * 서비스 사용 가능 여부를 반환합니다.
     */
    public boolean isAvailable() {
        return enabled && pgvectorAvailable && embeddingService.isEnabled();
    }

    /**
     * float 배열을 pgvector 형식 문자열로 변환합니다.
     */
    private String vectorToString(float[] vector) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(vector[i]);
        }
        sb.append("]");
        return sb.toString();
    }

    // ==================== Inner Classes ====================

    /**
     * 유사도 점수가 포함된 문서
     */
    public record ScoredDocument(
            Long id,
            String title,
            String url,
            double similarity
    ) {}

    /**
     * 문서 ID와 내용
     */
    public record DocumentContent(
            Long id,
            String content
    ) {}
}
