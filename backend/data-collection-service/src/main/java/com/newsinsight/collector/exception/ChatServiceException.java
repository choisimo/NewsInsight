package com.newsinsight.collector.exception;

/**
 * 채팅 서비스 관련 예외 기본 클래스
 */
public class ChatServiceException extends RuntimeException {
    
    private final String errorCode;
    private final String sessionId;

    public ChatServiceException(String message) {
        super(message);
        this.errorCode = "CHAT_ERROR";
        this.sessionId = null;
    }

    public ChatServiceException(String message, Throwable cause) {
        super(message, cause);
        this.errorCode = "CHAT_ERROR";
        this.sessionId = null;
    }

    public ChatServiceException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
        this.sessionId = null;
    }

    public ChatServiceException(String errorCode, String message, String sessionId) {
        super(message);
        this.errorCode = errorCode;
        this.sessionId = sessionId;
    }

    public ChatServiceException(String errorCode, String message, String sessionId, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.sessionId = sessionId;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public String getSessionId() {
        return sessionId;
    }
}
