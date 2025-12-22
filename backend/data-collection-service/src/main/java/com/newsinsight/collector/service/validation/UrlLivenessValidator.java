package com.newsinsight.collector.service.validation;

import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * URL 실존 여부 검증 서비스 (Liveness Check)
 * 
 * HTTP HEAD/GET 요청을 통해 URL이 실제로 접근 가능한지 확인하고,
 * 삭제된 페이지, 에러 페이지, LLM 환각(Hallucination) URL을 필터링합니다.
 * 
 * 주요 기능:
 * 1. HTTP HEAD 요청으로 URL 접근 가능 여부 확인
 * 2. 삭제된 페이지/에러 페이지 콘텐츠 패턴 감지
 * 3. LLM이 생성한 가짜 URL 필터링
 * 4. 결과 캐싱으로 중복 요청 방지
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class UrlLivenessValidator {

    private final WebClient webClient;

    @Value("${collector.url-validation.timeout-seconds:5}")
    private int timeoutSeconds;

    @Value("${collector.url-validation.cache-ttl-minutes:30}")
    private int cacheTtlMinutes;

    @Value("${collector.url-validation.enabled:true}")
    private boolean validationEnabled;

    // URL 검증 결과 캐시 (TTL 적용)
    private final Map<String, CachedValidation> validationCache = new ConcurrentHashMap<>();

    // 삭제된 페이지를 나타내는 키워드 패턴 (한국어/영어)
    private static final List<Pattern> DELETED_PAGE_PATTERNS = List.of(
            // 한국어 패턴
            Pattern.compile("삭제된\\s*게시[글물]", Pattern.CASE_INSENSITIVE),
            Pattern.compile("삭제되었습니다", Pattern.CASE_INSENSITIVE),
            Pattern.compile("존재하지\\s*않는\\s*페이지", Pattern.CASE_INSENSITIVE),
            Pattern.compile("페이지를\\s*찾을\\s*수\\s*없", Pattern.CASE_INSENSITIVE),
            Pattern.compile("접근\\s*권한이\\s*없", Pattern.CASE_INSENSITIVE),
            Pattern.compile("비공개\\s*게시", Pattern.CASE_INSENSITIVE),
            Pattern.compile("회원만\\s*열람", Pattern.CASE_INSENSITIVE),
            Pattern.compile("로그인이\\s*필요", Pattern.CASE_INSENSITIVE),
            Pattern.compile("게시글이\\s*없습니다", Pattern.CASE_INSENSITIVE),
            Pattern.compile("이\\s*글은\\s*삭제", Pattern.CASE_INSENSITIVE),
            
            // 영어 패턴
            Pattern.compile("page\\s*not\\s*found", Pattern.CASE_INSENSITIVE),
            Pattern.compile("404\\s*error", Pattern.CASE_INSENSITIVE),
            Pattern.compile("not\\s*found", Pattern.CASE_INSENSITIVE),
            Pattern.compile("this\\s*page\\s*does\\s*not\\s*exist", Pattern.CASE_INSENSITIVE),
            Pattern.compile("content\\s*has\\s*been\\s*removed", Pattern.CASE_INSENSITIVE),
            Pattern.compile("content\\s*is\\s*no\\s*longer\\s*available", Pattern.CASE_INSENSITIVE),
            Pattern.compile("access\\s*denied", Pattern.CASE_INSENSITIVE),
            Pattern.compile("permission\\s*denied", Pattern.CASE_INSENSITIVE),
            Pattern.compile("article\\s*not\\s*found", Pattern.CASE_INSENSITIVE),
            Pattern.compile("post\\s*has\\s*been\\s*deleted", Pattern.CASE_INSENSITIVE),
            Pattern.compile("this\\s*content\\s*is\\s*unavailable", Pattern.CASE_INSENSITIVE),
            Pattern.compile("sorry.*couldn't find", Pattern.CASE_INSENSITIVE),
            Pattern.compile("the\\s*requested\\s*url\\s*was\\s*not\\s*found", Pattern.CASE_INSENSITIVE)
    );

    // LLM이 자주 생성하는 가짜 URL 패턴
    private static final List<Pattern> HALLUCINATION_URL_PATTERNS = List.of(
            // 존재하지 않는 도메인 패턴
            Pattern.compile("example\\.com", Pattern.CASE_INSENSITIVE),
            Pattern.compile("sample\\.com", Pattern.CASE_INSENSITIVE),
            Pattern.compile("test\\.com", Pattern.CASE_INSENSITIVE),
            Pattern.compile("fake\\.(com|org|net)", Pattern.CASE_INSENSITIVE),
            Pattern.compile("placeholder\\.(com|org|net)", Pattern.CASE_INSENSITIVE),
            
            // 명백히 가짜인 경로 패턴
            Pattern.compile("/article/\\d{10,}", Pattern.CASE_INSENSITIVE), // 비정상적으로 긴 ID
            Pattern.compile("/news/fake-", Pattern.CASE_INSENSITIVE),
            Pattern.compile("/example-", Pattern.CASE_INSENSITIVE),
            
            // 흔한 환각 패턴
            Pattern.compile("www\\d+\\.", Pattern.CASE_INSENSITIVE), // www1., www2. 등
            Pattern.compile("\\.fake\\.", Pattern.CASE_INSENSITIVE)
    );

    // 신뢰할 수 있는 도메인 (검증 생략 가능)
    private static final Set<String> TRUSTED_DOMAINS = Set.of(
            "wikipedia.org",
            "en.wikipedia.org",
            "ko.wikipedia.org",
            "scholar.google.com",
            "pubmed.ncbi.nlm.nih.gov",
            "doi.org",
            "arxiv.org",
            "nature.com",
            "science.org",
            "sciencedirect.com",
            "springer.com",
            "wiley.com",
            "ncbi.nlm.nih.gov",
            "britannica.com",
            "namu.wiki",
            "kosis.kr",
            "stats.oecd.org",
            "data.worldbank.org"
    );

    /**
     * URL 유효성 검증 결과
     */
    @Data
    @Builder
    public static class ValidationResult {
        private String url;
        private boolean isValid;
        private boolean isAccessible;      // HTTP 접근 가능 여부
        private boolean isContentValid;    // 콘텐츠가 유효한지 (삭제 페이지 아님)
        private boolean isTrustedDomain;   // 신뢰할 수 있는 도메인인지
        private boolean isHallucination;   // LLM 환각으로 의심되는지
        private int httpStatusCode;
        private String failureReason;
        private long responseTimeMs;
    }

    /**
     * 캐시된 검증 결과
     */
    @Data
    @Builder
    private static class CachedValidation {
        private ValidationResult result;
        private long cachedAt;
    }

    /**
     * 단일 URL 검증
     */
    public Mono<ValidationResult> validateUrl(String url) {
        if (!validationEnabled) {
            return Mono.just(ValidationResult.builder()
                    .url(url)
                    .isValid(true)
                    .isAccessible(true)
                    .isContentValid(true)
                    .isTrustedDomain(false)
                    .isHallucination(false)
                    .build());
        }

        // 캐시 확인
        CachedValidation cached = validationCache.get(url);
        if (cached != null && !isCacheExpired(cached)) {
            return Mono.just(cached.getResult());
        }

        // 1. URL 형식 검증
        if (!isValidUrlFormat(url)) {
            ValidationResult result = ValidationResult.builder()
                    .url(url)
                    .isValid(false)
                    .isAccessible(false)
                    .isContentValid(false)
                    .isTrustedDomain(false)
                    .isHallucination(true)
                    .failureReason("Invalid URL format")
                    .build();
            cacheResult(url, result);
            return Mono.just(result);
        }

        // 2. 환각 URL 패턴 검사
        if (isLikelyHallucination(url)) {
            ValidationResult result = ValidationResult.builder()
                    .url(url)
                    .isValid(false)
                    .isAccessible(false)
                    .isContentValid(false)
                    .isTrustedDomain(false)
                    .isHallucination(true)
                    .failureReason("URL matches hallucination pattern")
                    .build();
            cacheResult(url, result);
            return Mono.just(result);
        }

        // 3. 신뢰할 수 있는 도메인 확인
        if (isTrustedDomain(url)) {
            ValidationResult result = ValidationResult.builder()
                    .url(url)
                    .isValid(true)
                    .isAccessible(true)
                    .isContentValid(true)
                    .isTrustedDomain(true)
                    .isHallucination(false)
                    .build();
            cacheResult(url, result);
            return Mono.just(result);
        }

        // 4. HTTP HEAD 요청으로 실제 접근 가능 여부 확인
        long startTime = System.currentTimeMillis();

        return performHttpValidation(url)
                .map(statusCode -> {
                    long responseTime = System.currentTimeMillis() - startTime;
                    boolean isAccessible = statusCode >= 200 && statusCode < 400;
                    
                    ValidationResult result = ValidationResult.builder()
                            .url(url)
                            .isValid(isAccessible)
                            .isAccessible(isAccessible)
                            .isContentValid(isAccessible) // HEAD만으로는 콘텐츠 검증 불가
                            .isTrustedDomain(false)
                            .isHallucination(false)
                            .httpStatusCode(statusCode)
                            .responseTimeMs(responseTime)
                            .failureReason(isAccessible ? null : "HTTP " + statusCode)
                            .build();
                    
                    cacheResult(url, result);
                    return result;
                })
                .onErrorResume(e -> {
                    long responseTime = System.currentTimeMillis() - startTime;
                    String reason = e.getMessage() != null ? e.getMessage() : "Connection failed";
                    
                    ValidationResult result = ValidationResult.builder()
                            .url(url)
                            .isValid(false)
                            .isAccessible(false)
                            .isContentValid(false)
                            .isTrustedDomain(false)
                            .isHallucination(false)
                            .responseTimeMs(responseTime)
                            .failureReason(reason)
                            .build();
                    
                    cacheResult(url, result);
                    return Mono.just(result);
                });
    }

    /**
     * 다중 URL 병렬 검증
     */
    public Flux<ValidationResult> validateUrls(List<String> urls) {
        if (urls == null || urls.isEmpty()) {
            return Flux.empty();
        }

        return Flux.fromIterable(urls)
                .flatMap(this::validateUrl, 10) // 동시성 10개 제한
                .subscribeOn(Schedulers.boundedElastic());
    }

    /**
     * URL 목록에서 유효한 URL만 필터링
     */
    public Mono<List<String>> filterValidUrls(List<String> urls) {
        return validateUrls(urls)
                .filter(ValidationResult::isValid)
                .map(ValidationResult::getUrl)
                .collectList();
    }

    /**
     * 콘텐츠가 삭제된 페이지인지 검사
     */
    public boolean isDeletedPageContent(String content) {
        if (content == null || content.isBlank()) {
            return true; // 빈 콘텐츠는 삭제된 것으로 간주
        }

        // 콘텐츠가 너무 짧으면 에러 페이지일 가능성 높음
        if (content.length() < 100) {
            for (Pattern pattern : DELETED_PAGE_PATTERNS) {
                if (pattern.matcher(content).find()) {
                    return true;
                }
            }
        }

        // 일반 콘텐츠에서도 삭제 패턴 검사
        for (Pattern pattern : DELETED_PAGE_PATTERNS) {
            if (pattern.matcher(content).find()) {
                // 패턴이 발견되었지만, 충분히 긴 콘텐츠면 실제 뉴스일 수 있음
                if (content.length() > 500) {
                    continue; // 더 많은 패턴 확인
                }
                return true;
            }
        }

        return false;
    }

    /**
     * 콘텐츠 유효성 검증 (삭제 페이지, 에러 페이지 필터링)
     */
    public ContentValidationResult validateContent(String url, String content) {
        ContentValidationResult.ContentValidationResultBuilder builder = ContentValidationResult.builder()
                .url(url)
                .originalContent(content);

        // 1. 빈 콘텐츠 검사
        if (content == null || content.isBlank()) {
            return builder
                    .isValid(false)
                    .failureReason("Empty content")
                    .contentType(ContentType.EMPTY)
                    .build();
        }

        // 2. 너무 짧은 콘텐츠 검사
        if (content.length() < 50) {
            return builder
                    .isValid(false)
                    .failureReason("Content too short: " + content.length() + " chars")
                    .contentType(ContentType.TOO_SHORT)
                    .build();
        }

        // 3. 삭제된 페이지 패턴 검사
        if (isDeletedPageContent(content)) {
            return builder
                    .isValid(false)
                    .failureReason("Content matches deleted page pattern")
                    .contentType(ContentType.DELETED_PAGE)
                    .build();
        }

        // 4. 유효한 콘텐츠
        return builder
                .isValid(true)
                .contentType(ContentType.VALID)
                .contentLength(content.length())
                .build();
    }

    /**
     * 콘텐츠 검증 결과
     */
    @Data
    @Builder
    public static class ContentValidationResult {
        private String url;
        private String originalContent;
        private boolean isValid;
        private String failureReason;
        private ContentType contentType;
        private int contentLength;
    }

    public enum ContentType {
        VALID,
        EMPTY,
        TOO_SHORT,
        DELETED_PAGE,
        ERROR_PAGE,
        ACCESS_DENIED
    }

    // ============================================
    // Private Helper Methods
    // ============================================

    private boolean isValidUrlFormat(String url) {
        if (url == null || url.isBlank()) {
            return false;
        }

        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            
            return (scheme != null && (scheme.equals("http") || scheme.equals("https")))
                    && host != null && !host.isBlank();
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private boolean isLikelyHallucination(String url) {
        for (Pattern pattern : HALLUCINATION_URL_PATTERNS) {
            if (pattern.matcher(url).find()) {
                log.debug("URL matches hallucination pattern: {}", url);
                return true;
            }
        }
        return false;
    }

    private boolean isTrustedDomain(String url) {
        try {
            URI uri = new URI(url);
            String host = uri.getHost();
            if (host == null) {
                return false;
            }

            host = host.toLowerCase();
            for (String trusted : TRUSTED_DOMAINS) {
                if (host.equals(trusted) || host.endsWith("." + trusted)) {
                    return true;
                }
            }
        } catch (URISyntaxException e) {
            return false;
        }
        return false;
    }

    private Mono<Integer> performHttpValidation(String url) {
        return webClient.method(HttpMethod.HEAD)
                .uri(url)
                .exchangeToMono(response -> {
                    HttpStatusCode status = response.statusCode();
                    return Mono.just(status.value());
                })
                .timeout(Duration.ofSeconds(timeoutSeconds))
                .onErrorResume(e -> {
                    // HEAD 실패 시 GET으로 재시도
                    return webClient.method(HttpMethod.GET)
                            .uri(url)
                            .exchangeToMono(response -> {
                                HttpStatusCode status = response.statusCode();
                                return Mono.just(status.value());
                            })
                            .timeout(Duration.ofSeconds(timeoutSeconds));
                });
    }

    private void cacheResult(String url, ValidationResult result) {
        validationCache.put(url, CachedValidation.builder()
                .result(result)
                .cachedAt(System.currentTimeMillis())
                .build());
        
        // 캐시 크기 제한 (1000개 초과 시 오래된 항목 정리)
        if (validationCache.size() > 1000) {
            cleanupExpiredCache();
        }
    }

    private boolean isCacheExpired(CachedValidation cached) {
        long expiryTime = cached.getCachedAt() + (cacheTtlMinutes * 60 * 1000L);
        return System.currentTimeMillis() > expiryTime;
    }

    private void cleanupExpiredCache() {
        long now = System.currentTimeMillis();
        long expiryThreshold = now - (cacheTtlMinutes * 60 * 1000L);
        
        validationCache.entrySet().removeIf(entry -> 
                entry.getValue().getCachedAt() < expiryThreshold);
        
        log.info("Cache cleanup completed. Remaining entries: {}", validationCache.size());
    }

    /**
     * 캐시 통계 조회
     */
    public Map<String, Object> getCacheStats() {
        long validCount = validationCache.values().stream()
                .filter(c -> c.getResult().isValid())
                .count();
        
        return Map.of(
                "totalEntries", validationCache.size(),
                "validUrls", validCount,
                "invalidUrls", validationCache.size() - validCount,
                "cacheTtlMinutes", cacheTtlMinutes
        );
    }

    /**
     * 캐시 초기화
     */
    public void clearCache() {
        validationCache.clear();
        log.info("URL validation cache cleared");
    }
}
