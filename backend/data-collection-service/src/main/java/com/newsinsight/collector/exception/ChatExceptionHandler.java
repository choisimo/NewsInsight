package com.newsinsight.collector.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 채팅 서비스 전역 예외 핸들러
 */
@RestControllerAdvice(basePackages = "com.newsinsight.collector.controller")
@Slf4j
public class ChatExceptionHandler {

    @ExceptionHandler(SessionException.class)
    public ResponseEntity<Map<String, Object>> handleSessionException(SessionException ex) {
        log.error("Session error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.BAD_REQUEST.value()
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
    }

    @ExceptionHandler(SyncException.class)
    public ResponseEntity<Map<String, Object>> handleSyncException(SyncException ex) {
        log.error("Sync error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    @ExceptionHandler(VectorEmbeddingException.class)
    public ResponseEntity<Map<String, Object>> handleVectorEmbeddingException(VectorEmbeddingException ex) {
        log.error("Vector embedding error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.SERVICE_UNAVAILABLE.value()
        );
        
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(response);
    }

    @ExceptionHandler(ChatServiceException.class)
    public ResponseEntity<Map<String, Object>> handleChatServiceException(ChatServiceException ex) {
        log.error("Chat service error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGenericException(Exception ex) {
        log.error("Unexpected error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                "INTERNAL_ERROR",
                "An unexpected error occurred",
                null,
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    private Map<String, Object> createErrorResponse(String errorCode, String message, String sessionId, int status) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("error", errorCode);
        response.put("message", message);
        response.put("status", status);
        response.put("timestamp", LocalDateTime.now().toString());
        
        if (sessionId != null) {
            response.put("sessionId", sessionId);
        }
        
        return response;
    }
}
