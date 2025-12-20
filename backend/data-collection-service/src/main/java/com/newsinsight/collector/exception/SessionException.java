package com.newsinsight.collector.exception;

/**
 * 세션 관련 예외
 */
public class SessionException extends ChatServiceException {

    public SessionException(String message) {
        super("SESSION_ERROR", message);
    }

    public SessionException(String message, String sessionId) {
        super("SESSION_ERROR", message, sessionId);
    }

    public SessionException(String message, String sessionId, Throwable cause) {
        super("SESSION_ERROR", message, sessionId, cause);
    }

    /**
     * 세션을 찾을 수 없을 때
     */
    public static SessionException notFound(String sessionId) {
        return new SessionException("Session not found: " + sessionId, sessionId);
    }

    /**
     * 세션이 만료되었을 때
     */
    public static SessionException expired(String sessionId) {
        return new SessionException("Session has expired: " + sessionId, sessionId);
    }

    /**
     * 세션이 이미 종료되었을 때
     */
    public static SessionException alreadyClosed(String sessionId) {
        return new SessionException("Session is already closed: " + sessionId, sessionId);
    }

    /**
     * 세션 생성 실패
     */
    public static SessionException creationFailed(String sessionId, Throwable cause) {
        return new SessionException("Failed to create session: " + sessionId, sessionId, cause);
    }
}
