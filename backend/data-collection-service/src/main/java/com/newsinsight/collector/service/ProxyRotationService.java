package com.newsinsight.collector.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * IP Rotation 서비스와 통신하여 프록시를 가져오고 결과를 기록하는 서비스.
 * 
 * 429 (Too Many Requests) 또는 403 (Forbidden) 에러 시 
 * 다른 IP를 통해 재시도할 수 있도록 프록시를 제공합니다.
 * 
 * IP-rotation 서비스 API:
 * - GET /proxy/next - 다음 프록시 가져오기
 * - POST /proxy/record - 성공/실패 결과 기록
 */
@Service
@Slf4j
public class ProxyRotationService {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final AtomicReference<ProxyInfo> cachedProxy = new AtomicReference<>();

    @Value("${collector.ip-rotation.enabled:true}")
    private boolean enabled;

    @Value("${collector.ip-rotation.base-url:http://ip-rotation:8050}")
    private String ipRotationBaseUrl;

    @Value("${collector.ip-rotation.timeout-seconds:5}")
    private int timeoutSeconds;

    @Value("${collector.ip-rotation.max-retries:3}")
    private int maxRetries;

    public ProxyRotationService(WebClient.Builder webClientBuilder, ObjectMapper objectMapper) {
        this.webClient = webClientBuilder.build();
        this.objectMapper = objectMapper;
    }

    /**
     * IP Rotation이 활성화되어 있는지 확인
     */
    public boolean isEnabled() {
        return enabled;
    }

    /**
     * 다음 프록시를 가져옵니다.
     * 
     * @return 프록시 정보 또는 사용 불가 시 null
     */
    public Mono<ProxyInfo> getNextProxy() {
        if (!enabled) {
            return Mono.empty();
        }

        return webClient.get()
                .uri(ipRotationBaseUrl + "/proxy/next")
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .flatMap(response -> {
                    try {
                        JsonNode node = objectMapper.readTree(response);
                        
                        ProxyInfo proxy = ProxyInfo.builder()
                                .proxyId(node.path("proxyId").asText())
                                .address(node.path("address").asText())
                                .protocol(node.path("protocol").asText("http"))
                                .username(node.path("username").asText(null))
                                .password(node.path("password").asText(null))
                                .country(node.path("country").asText(null))
                                .healthStatus(node.path("healthStatus").asText("unknown"))
                                .build();
                        
                        if (proxy.getAddress() == null || proxy.getAddress().isBlank()) {
                            log.warn("IP-rotation returned empty proxy address");
                            return Mono.empty();
                        }
                        
                        cachedProxy.set(proxy);
                        log.debug("Got proxy from IP-rotation: {} ({})", proxy.getAddress(), proxy.getCountry());
                        return Mono.just(proxy);
                    } catch (Exception e) {
                        log.warn("Failed to parse proxy response: {}", e.getMessage());
                        return Mono.empty();
                    }
                })
                .onErrorResume(e -> {
                    log.warn("Failed to get proxy from IP-rotation: {}", e.getMessage());
                    return Mono.empty();
                });
    }

    /**
     * 동기적으로 다음 프록시를 가져옵니다.
     */
    public ProxyInfo getNextProxyBlocking() {
        if (!enabled) {
            return null;
        }
        
        try {
            return getNextProxy().block(Duration.ofSeconds(timeoutSeconds));
        } catch (Exception e) {
            log.warn("Failed to get proxy (blocking): {}", e.getMessage());
            return null;
        }
    }

    /**
     * 프록시 사용 결과를 기록합니다.
     * 
     * @param proxyId 프록시 ID
     * @param success 성공 여부
     * @param latencyMs 응답 시간 (밀리초)
     * @param reason 실패 사유 (실패 시)
     */
    public Mono<Void> recordResult(String proxyId, boolean success, long latencyMs, String reason) {
        if (!enabled || proxyId == null || proxyId.isBlank()) {
            return Mono.empty();
        }

        Map<String, Object> body = Map.of(
                "proxyId", proxyId,
                "success", success,
                "latencyMs", latencyMs,
                "reason", reason != null ? reason : ""
        );

        return webClient.post()
                .uri(ipRotationBaseUrl + "/proxy/record")
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .doOnSuccess(r -> log.debug("Recorded proxy result: {} success={}", proxyId, success))
                .onErrorResume(e -> {
                    log.warn("Failed to record proxy result: {}", e.getMessage());
                    return Mono.empty();
                })
                .then();
    }

    /**
     * 프록시 사용 성공을 기록합니다.
     */
    public void recordSuccess(String proxyId, long latencyMs) {
        recordResult(proxyId, true, latencyMs, null).subscribe();
    }

    /**
     * 프록시 사용 실패를 기록합니다.
     */
    public void recordFailure(String proxyId, String reason) {
        recordResult(proxyId, false, 0, reason).subscribe();
    }

    /**
     * 마지막으로 가져온 프록시 정보
     */
    public ProxyInfo getCachedProxy() {
        return cachedProxy.get();
    }

    /**
     * 프록시 주소를 파싱하여 호스트와 포트를 추출합니다.
     * 
     * @param address 프록시 주소 (예: "192.168.1.1:8080" 또는 "http://proxy.example.com:3128")
     * @return InetSocketAddress 또는 파싱 실패 시 null
     */
    public InetSocketAddress parseProxyAddress(String address) {
        if (address == null || address.isBlank()) {
            return null;
        }

        try {
            // http:// 또는 https:// 프리픽스 제거
            String cleanAddress = address;
            if (cleanAddress.startsWith("http://")) {
                cleanAddress = cleanAddress.substring(7);
            } else if (cleanAddress.startsWith("https://")) {
                cleanAddress = cleanAddress.substring(8);
            }

            // host:port 분리
            int colonIndex = cleanAddress.lastIndexOf(':');
            if (colonIndex > 0 && colonIndex < cleanAddress.length() - 1) {
                String host = cleanAddress.substring(0, colonIndex);
                int port = Integer.parseInt(cleanAddress.substring(colonIndex + 1));
                return new InetSocketAddress(host, port);
            }
        } catch (Exception e) {
            log.warn("Failed to parse proxy address '{}': {}", address, e.getMessage());
        }
        return null;
    }

    /**
     * 프록시를 사용하는 HttpClient를 생성합니다.
     * 
     * @param proxyInfo 프록시 정보
     * @return HttpClient 또는 프록시 사용 불가 시 null
     */
    public HttpClient createProxiedHttpClient(ProxyInfo proxyInfo) {
        if (proxyInfo == null) {
            return null;
        }

        InetSocketAddress proxyAddress = parseProxyAddress(proxyInfo.getAddress());
        if (proxyAddress == null) {
            return null;
        }

        try {
            HttpClient.Builder builder = HttpClient.newBuilder()
                    .proxy(ProxySelector.of(proxyAddress))
                    .connectTimeout(Duration.ofSeconds(10));

            // 인증이 필요한 경우 Authenticator 설정 가능 (현재는 미구현)
            // 프록시 인증은 대부분 URL에 포함되거나 별도 처리 필요

            return builder.build();
        } catch (Exception e) {
            log.warn("Failed to create proxied HttpClient: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 프록시 정보
     */
    @Data
    @Builder
    public static class ProxyInfo {
        private String proxyId;
        private String address;
        private String protocol;
        private String username;
        private String password;
        private String country;
        private String healthStatus;

        /**
         * 프록시 URL을 생성합니다 (인증 정보 포함).
         */
        public String toProxyUrl() {
            StringBuilder sb = new StringBuilder();
            sb.append(protocol != null ? protocol : "http").append("://");
            
            if (username != null && !username.isBlank()) {
                sb.append(username);
                if (password != null && !password.isBlank()) {
                    sb.append(":").append(password);
                }
                sb.append("@");
            }
            
            sb.append(address);
            return sb.toString();
        }
    }
}
