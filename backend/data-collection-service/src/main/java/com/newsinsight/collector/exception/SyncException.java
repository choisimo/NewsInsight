package com.newsinsight.collector.exception;

/**
 * 동기화 관련 예외
 */
public class SyncException extends ChatServiceException {

    public SyncException(String message) {
        super("SYNC_ERROR", message);
    }

    public SyncException(String message, String sessionId) {
        super("SYNC_ERROR", message, sessionId);
    }

    public SyncException(String message, String sessionId, Throwable cause) {
        super("SYNC_ERROR", message, sessionId, cause);
    }

    /**
     * RDB 동기화 실패
     */
    public static SyncException rdbSyncFailed(String sessionId, Throwable cause) {
        return new SyncException("Failed to sync session to RDB: " + sessionId, sessionId, cause);
    }

    /**
     * 벡터 DB 임베딩 실패
     */
    public static SyncException embeddingFailed(String sessionId, Throwable cause) {
        return new SyncException("Failed to embed session to vector DB: " + sessionId, sessionId, cause);
    }

    /**
     * 동기화 타임아웃
     */
    public static SyncException timeout(String sessionId) {
        return new SyncException("Sync operation timed out for session: " + sessionId, sessionId);
    }
}
