package com.newsinsight.collector.exception;

/**
 * 벡터 임베딩 관련 예외
 */
public class VectorEmbeddingException extends ChatServiceException {

    public VectorEmbeddingException(String message) {
        super("VECTOR_ERROR", message);
    }

    public VectorEmbeddingException(String message, Throwable cause) {
        super("VECTOR_ERROR", message, null, cause);
    }

    public VectorEmbeddingException(String message, String sessionId, Throwable cause) {
        super("VECTOR_ERROR", message, sessionId, cause);
    }

    /**
     * 벡터 DB 연결 실패
     */
    public static VectorEmbeddingException connectionFailed(Throwable cause) {
        return new VectorEmbeddingException("Failed to connect to vector DB", cause);
    }

    /**
     * 임베딩 생성 실패
     */
    public static VectorEmbeddingException embeddingGenerationFailed(String messageId, Throwable cause) {
        return new VectorEmbeddingException("Failed to generate embedding for message: " + messageId, cause);
    }

    /**
     * 벡터 저장 실패
     */
    public static VectorEmbeddingException storageFailed(String embeddingId, Throwable cause) {
        return new VectorEmbeddingException("Failed to store embedding: " + embeddingId, cause);
    }

    /**
     * 검색 실패
     */
    public static VectorEmbeddingException searchFailed(Throwable cause) {
        return new VectorEmbeddingException("Vector search failed", cause);
    }

    /**
     * 벡터 DB 비활성화
     */
    public static VectorEmbeddingException disabled() {
        return new VectorEmbeddingException("Vector DB is disabled");
    }
}
