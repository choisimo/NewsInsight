package com.newsinsight.collector.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.service.FactCheckChatService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.List;
import java.util.UUID;

/**
 * 팩트체크 챗봇 컨트롤러
 * 
 * 사용자와 대화하며 실시간으로 팩트체크 결과를 제공합니다.
 * SSE를 통해 스트리밍 방식으로 응답을 전송합니다.
 * 
 * NOTE: CORS is handled by API Gateway - do not add @CrossOrigin here
 */
@RestController
@RequestMapping("/api/v1/factcheck-chat")
@RequiredArgsConstructor
@Slf4j
public class FactCheckChatController {

    private final FactCheckChatService factCheckChatService;
    private final ObjectMapper objectMapper;

    /**
     * 팩트체크 챗봇 세션 시작
     * 
     * @param request 초기 메시지 요청
     * @return 세션 ID
     */
    @PostMapping("/session")
    public SessionResponse createSession(@RequestBody ChatRequest request) {
        String sessionId = UUID.randomUUID().toString();
        log.info("Created fact-check chat session: {}", sessionId);
        
        return SessionResponse.builder()
                .sessionId(sessionId)
                .message("팩트체크 챗봇 세션이 시작되었습니다.")
                .build();
    }

    /**
     * 팩트체크 챗봇 메시지 전송 및 SSE 스트리밍 응답
     * 
     * @param sessionId 세션 ID
     * @param request 사용자 메시지
     * @return SSE 이벤트 스트림
     */
    @PostMapping(value = "/session/{sessionId}/message", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> sendMessage(
            @PathVariable String sessionId,
            @RequestBody ChatRequest request
    ) {
        log.info("Received message for session {}: {}", sessionId, request.getMessage());

        return factCheckChatService.processMessage(sessionId, request.getMessage(), request.getClaims())
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(UUID.randomUUID().toString())
                                .event(event.getType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize chat event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                })
                .concatWith(Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("{\"message\": \"Response completed\"}")
                                .build()
                ))
                .timeout(Duration.ofMinutes(3))
                .onErrorResume(e -> {
                    log.error("Error in chat stream for session {}: {}", sessionId, e.getMessage());
                    return Flux.just(
                            ServerSentEvent.<String>builder()
                                    .event("error")
                                    .data("{\"error\": \"" + e.getMessage() + "\"}")
                                    .build()
                    );
                });
    }

    /**
     * 세션 종료
     * 
     * @param sessionId 세션 ID
     */
    @DeleteMapping("/session/{sessionId}")
    public void closeSession(@PathVariable String sessionId) {
        log.info("Closing fact-check chat session: {}", sessionId);
        factCheckChatService.closeSession(sessionId);
    }

    /**
     * 세션 이력 조회
     * 
     * @param sessionId 세션 ID
     * @return 대화 이력
     */
    @GetMapping("/session/{sessionId}/history")
    public ChatHistoryResponse getHistory(@PathVariable String sessionId) {
        List<ChatMessage> history = factCheckChatService.getHistory(sessionId);
        return ChatHistoryResponse.builder()
                .sessionId(sessionId)
                .messages(history)
                .build();
    }

    // DTO Classes
    
    @Data
    public static class ChatRequest {
        private String message;
        private List<String> claims;
    }

    @Data
    @lombok.Builder
    public static class SessionResponse {
        private String sessionId;
        private String message;
    }

    @Data
    @lombok.Builder
    public static class ChatHistoryResponse {
        private String sessionId;
        private List<ChatMessage> messages;
    }

    @Data
    @lombok.Builder
    public static class ChatMessage {
        private String role; // user, assistant, system
        private String content;
        private Long timestamp;
    }
}
