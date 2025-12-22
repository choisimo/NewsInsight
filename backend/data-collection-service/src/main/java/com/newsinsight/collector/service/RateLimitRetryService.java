package com.newsinsight.collector.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import reactor.util.retry.Retry;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/**
 * Rate Limit (429, 403) 에러 발생 시 IP Rotation을 통해 재시도하는 서비스.
 * 
 * 사용 방법:
 * 1. 일반 WebClient 요청 실행
 * 2. 429/403 에러 발생 시 ProxyRotationService에서 새 프록시 가져오기
 * 3. 프록시를 통해 요청 재시도
 * 4. 결과를 ProxyRotationService에 기록
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class RateLimitRetryService {

    private final ProxyRotationService proxyRotationService;
    private final WebClient webClient;

    @Value("${collector.ip-rotation.max-retries:3}")
    private int maxRetries;

    @Value("${collector.ip-rotation.retry-delay-ms:1000}")
    private long retryDelayMs;

    @Value("${collector.ip-rotation.timeout-seconds:15}")
    private int timeoutSeconds;

    // 프록시를 통해 재시도해야 하는 HTTP 상태 코드
    private static final Set<Integer> RETRYABLE_STATUS_CODES = Set.of(
            429, // Too Many Requests
            403, // Forbidden (rate limit or IP blocked)
            503  // Service Unavailable (sometimes used for rate limiting)
    );

    /**
     * GET 요청을 실행하고, Rate Limit 에러 시 프록시를 통해 재시도합니다.
     * 
     * @param url 요청 URL
     * @param headers 추가 헤더 (키-값 쌍, 예: "Authorization", "Bearer xxx")
     * @return 응답 본문
     */
    public Mono<String> executeWithRetry(String url, String... headers) {
        return executeRequest(url, headers)
                .onErrorResume(e -> {
                    if (isRetryableError(e)) {
                        log.info("Rate limit detected for URL: {}, attempting proxy retry", url);
                        return retryWithProxy(url, headers);
                    }
                    return Mono.error(e);
                });
    }

    /**
     * GET 요청을 동기적으로 실행하고, Rate Limit 에러 시 프록시를 통해 재시도합니다.
     * 
     * @param url 요청 URL
     * @param headers 추가 헤더 (키-값 쌍)
     * @return 응답 본문 또는 실패 시 null
     */
    public String executeWithRetryBlocking(String url, String... headers) {
        try {
            return executeWithRetry(url, headers)
                    .block(Duration.ofSeconds(timeoutSeconds * (maxRetries + 1)));
        } catch (Exception e) {
            log.warn("Request failed after retries: {} - {}", url, e.getMessage());
            return null;
        }
    }

    /**
     * WebClient를 사용한 기본 GET 요청
     */
    private Mono<String> executeRequest(String url, String... headers) {
        WebClient.RequestHeadersSpec<?> request = webClient.get()
                .uri(url);

        // 헤더 추가
        if (headers != null && headers.length >= 2) {
            for (int i = 0; i < headers.length - 1; i += 2) {
                request = request.header(headers[i], headers[i + 1]);
            }
        }

        return request
                .retrieve()
                .bodyToMono(String.class)
                .timeout(Duration.ofSeconds(timeoutSeconds));
    }

    /**
     * 프록시를 통한 재시도
     */
    private Mono<String> retryWithProxy(String url, String... headers) {
        if (!proxyRotationService.isEnabled()) {
            log.debug("IP rotation disabled, skipping proxy retry");
            return Mono.empty();
        }

        return Mono.defer(() -> attemptProxyRequest(url, 0, headers));
    }

    /**
     * 프록시 요청 시도 (재귀적)
     */
    private Mono<String> attemptProxyRequest(String url, int attempt, String... headers) {
        if (attempt >= maxRetries) {
            log.warn("Max proxy retries ({}) exceeded for URL: {}", maxRetries, url);
            return Mono.empty();
        }

        return proxyRotationService.getNextProxy()
                .flatMap(proxyInfo -> {
                    log.debug("Attempting proxy request (attempt {}/{}): {} via {}", 
                            attempt + 1, maxRetries, url, proxyInfo.getAddress());
                    
                    long startTime = System.currentTimeMillis();
                    
                    return executeViaProxy(url, proxyInfo, headers)
                            .doOnSuccess(response -> {
                                long latency = System.currentTimeMillis() - startTime;
                                proxyRotationService.recordSuccess(proxyInfo.getProxyId(), latency);
                                log.info("Proxy request succeeded: {} via {} ({}ms)", 
                                        url, proxyInfo.getAddress(), latency);
                            })
                            .onErrorResume(e -> {
                                String reason = e.getMessage();
                                if (e instanceof WebClientResponseException wce) {
                                    reason = "HTTP " + wce.getStatusCode().value();
                                }
                                proxyRotationService.recordFailure(proxyInfo.getProxyId(), reason);
                                log.warn("Proxy request failed (attempt {}/{}): {} via {} - {}", 
                                        attempt + 1, maxRetries, url, proxyInfo.getAddress(), reason);
                                
                                // 재시도 가능한 에러면 다음 프록시로 시도
                                if (isRetryableError(e) && attempt + 1 < maxRetries) {
                                    return Mono.delay(Duration.ofMillis(retryDelayMs))
                                            .then(attemptProxyRequest(url, attempt + 1, headers));
                                }
                                return Mono.empty();
                            });
                })
                .switchIfEmpty(Mono.defer(() -> {
                    // 프록시를 가져오지 못한 경우
                    if (attempt + 1 < maxRetries) {
                        return Mono.delay(Duration.ofMillis(retryDelayMs))
                                .then(attemptProxyRequest(url, attempt + 1, headers));
                    }
                    return Mono.empty();
                }));
    }

    /**
     * 프록시를 통해 HTTP 요청 실행 (Java HttpClient 사용)
     */
    private Mono<String> executeViaProxy(String url, ProxyRotationService.ProxyInfo proxyInfo, String... headers) {
        return Mono.fromCallable(() -> {
            InetSocketAddress proxyAddress = proxyRotationService.parseProxyAddress(proxyInfo.getAddress());
            if (proxyAddress == null) {
                throw new RuntimeException("Invalid proxy address: " + proxyInfo.getAddress());
            }

            HttpClient client = HttpClient.newBuilder()
                    .proxy(java.net.ProxySelector.of(proxyAddress))
                    .connectTimeout(Duration.ofSeconds(10))
                    .build();

            HttpRequest.Builder requestBuilder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .GET();

            // 헤더 추가
            if (headers != null && headers.length >= 2) {
                for (int i = 0; i < headers.length - 1; i += 2) {
                    requestBuilder.header(headers[i], headers[i + 1]);
                }
            }

            // 프록시 인증이 필요한 경우 (Basic Auth)
            if (proxyInfo.getUsername() != null && !proxyInfo.getUsername().isBlank()) {
                String auth = proxyInfo.getUsername() + ":" + 
                        (proxyInfo.getPassword() != null ? proxyInfo.getPassword() : "");
                String encodedAuth = java.util.Base64.getEncoder().encodeToString(auth.getBytes());
                requestBuilder.header("Proxy-Authorization", "Basic " + encodedAuth);
            }

            HttpResponse<String> response = client.send(
                    requestBuilder.build(),
                    HttpResponse.BodyHandlers.ofString()
            );

            int statusCode = response.statusCode();
            if (statusCode >= 200 && statusCode < 300) {
                return response.body();
            } else if (RETRYABLE_STATUS_CODES.contains(statusCode)) {
                throw new WebClientResponseException(
                        statusCode, 
                        "HTTP " + statusCode, 
                        null, null, null
                );
            } else {
                throw new RuntimeException("HTTP error: " + statusCode);
            }
        });
    }

    /**
     * 재시도 가능한 에러인지 확인
     */
    private boolean isRetryableError(Throwable e) {
        if (e instanceof WebClientResponseException wce) {
            return RETRYABLE_STATUS_CODES.contains(wce.getStatusCode().value());
        }
        String message = e.getMessage();
        if (message != null) {
            message = message.toLowerCase();
            return message.contains("429") || 
                   message.contains("403") || 
                   message.contains("too many requests") ||
                   message.contains("rate limit") ||
                   message.contains("forbidden");
        }
        return false;
    }

    /**
     * 특정 상태 코드가 재시도 가능한지 확인
     */
    public boolean isRetryableStatusCode(int statusCode) {
        return RETRYABLE_STATUS_CODES.contains(statusCode);
    }
}
