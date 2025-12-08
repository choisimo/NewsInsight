package com.newsinsight.collector.entity;

/**
 * Enum representing specific timeout/failure reasons for deep search jobs.
 * Used for diagnostic logging and monitoring dashboards.
 */
public enum CrawlFailureReason {
    // Timeout reasons
    TIMEOUT_INTEGRATED_CRAWLER("timeout_integrated_crawler", "Integrated crawler exceeded time limit"),
    TIMEOUT_CRAWL4AI("timeout_crawl4ai", "Crawl4AI service timeout"),
    TIMEOUT_BROWSER_USE("timeout_browser_use", "Browser-Use API timeout"),
    TIMEOUT_AIDOVE("timeout_aidove", "AI Dove analysis timeout"),
    TIMEOUT_JOB_OVERALL("timeout_job_overall", "Overall job timeout exceeded"),
    TIMEOUT_HTTP_REQUEST("timeout_http_request", "HTTP request timeout"),
    TIMEOUT_POLLING("timeout_polling", "Polling timeout for async result"),

    // Connection/Network errors
    CONNECTION_REFUSED("connection_refused", "Connection refused by remote service"),
    CONNECTION_TIMEOUT("connection_timeout", "Connection establishment timeout"),
    DNS_RESOLUTION_FAILED("dns_resolution_failed", "DNS resolution failed"),
    NETWORK_UNREACHABLE("network_unreachable", "Network unreachable"),
    SSL_HANDSHAKE_FAILED("ssl_handshake_failed", "SSL handshake failed"),

    // Service errors
    SERVICE_UNAVAILABLE("service_unavailable", "External service unavailable"),
    SERVICE_OVERLOADED("service_overloaded", "Service overloaded, rate limited"),
    SERVICE_ERROR("service_error", "External service returned error"),
    CRAWL4AI_UNAVAILABLE("crawl4ai_unavailable", "Crawl4AI service not available"),
    BROWSER_USE_UNAVAILABLE("browser_use_unavailable", "Browser-Use service not available"),
    AIDOVE_UNAVAILABLE("aidove_unavailable", "AI Dove service not available"),

    // Content/Parsing errors
    EMPTY_CONTENT("empty_content", "No content extracted from pages"),
    PARSE_ERROR("parse_error", "Failed to parse response"),
    INVALID_URL("invalid_url", "Invalid URL provided"),
    BLOCKED_BY_ROBOTS("blocked_by_robots", "Blocked by robots.txt"),
    BLOCKED_BY_CAPTCHA("blocked_by_captcha", "Blocked by CAPTCHA"),
    CONTENT_TOO_LARGE("content_too_large", "Content too large to process"),

    // Processing errors
    AI_ANALYSIS_FAILED("ai_analysis_failed", "AI analysis/extraction failed"),
    EVIDENCE_EXTRACTION_FAILED("evidence_extraction_failed", "Evidence extraction failed"),
    STANCE_ANALYSIS_FAILED("stance_analysis_failed", "Stance analysis failed"),
    
    // Job management errors
    JOB_CANCELLED("job_cancelled", "Job was cancelled"),
    DUPLICATE_CALLBACK("duplicate_callback", "Duplicate callback received"),
    INVALID_CALLBACK_TOKEN("invalid_callback_token", "Invalid callback token"),

    // Unknown/Other
    UNKNOWN("unknown", "Unknown error occurred");

    private final String code;
    private final String description;

    CrawlFailureReason(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public String getCode() {
        return code;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Get failure reason from exception message
     */
    public static CrawlFailureReason fromException(Throwable e) {
        if (e == null) return UNKNOWN;
        
        String message = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
        String className = e.getClass().getSimpleName().toLowerCase();
        
        // Timeout detection
        if (className.contains("timeout") || message.contains("timeout") || message.contains("timed out")) {
            if (message.contains("crawl4ai")) return TIMEOUT_CRAWL4AI;
            if (message.contains("browser") || message.contains("browser-use")) return TIMEOUT_BROWSER_USE;
            if (message.contains("aidove") || message.contains("ai dove") || message.contains("dove")) return TIMEOUT_AIDOVE;
            if (message.contains("connect")) return CONNECTION_TIMEOUT;
            if (message.contains("poll")) return TIMEOUT_POLLING;
            return TIMEOUT_HTTP_REQUEST;
        }
        
        // Connection errors
        if (message.contains("connection refused") || className.contains("connectexception")) {
            return CONNECTION_REFUSED;
        }
        if (message.contains("dns") || message.contains("unknown host") || message.contains("unresolved")) {
            return DNS_RESOLUTION_FAILED;
        }
        if (message.contains("ssl") || message.contains("certificate") || message.contains("tls")) {
            return SSL_HANDSHAKE_FAILED;
        }
        if (message.contains("network") || message.contains("unreachable")) {
            return NETWORK_UNREACHABLE;
        }
        
        // Service errors
        if (message.contains("503") || message.contains("service unavailable")) {
            return SERVICE_UNAVAILABLE;
        }
        if (message.contains("429") || message.contains("rate limit") || message.contains("too many requests")) {
            return SERVICE_OVERLOADED;
        }
        if (message.contains("500") || message.contains("internal server error")) {
            return SERVICE_ERROR;
        }
        
        // Content errors
        if (message.contains("empty") && (message.contains("content") || message.contains("response"))) {
            return EMPTY_CONTENT;
        }
        if (message.contains("parse") || message.contains("json") || message.contains("malformed")) {
            return PARSE_ERROR;
        }
        if (message.contains("captcha")) {
            return BLOCKED_BY_CAPTCHA;
        }
        if (message.contains("robots")) {
            return BLOCKED_BY_ROBOTS;
        }
        
        return UNKNOWN;
    }

    /**
     * Get failure reason from error message string
     */
    public static CrawlFailureReason fromErrorMessage(String errorMessage) {
        if (errorMessage == null || errorMessage.isBlank()) return UNKNOWN;
        
        String message = errorMessage.toLowerCase();
        
        // Match specific codes first
        for (CrawlFailureReason reason : values()) {
            if (message.contains(reason.code)) {
                return reason;
            }
        }
        
        // Fallback to pattern matching
        if (message.contains("timeout")) {
            if (message.contains("crawl4ai")) return TIMEOUT_CRAWL4AI;
            if (message.contains("browser")) return TIMEOUT_BROWSER_USE;
            if (message.contains("aidove") || message.contains("dove")) return TIMEOUT_AIDOVE;
            if (message.contains("overall") || message.contains("job")) return TIMEOUT_JOB_OVERALL;
            return TIMEOUT_HTTP_REQUEST;
        }
        
        if (message.contains("cancelled") || message.contains("canceled")) {
            return JOB_CANCELLED;
        }
        
        if (message.contains("unavailable")) {
            if (message.contains("crawl4ai")) return CRAWL4AI_UNAVAILABLE;
            if (message.contains("browser")) return BROWSER_USE_UNAVAILABLE;
            if (message.contains("aidove")) return AIDOVE_UNAVAILABLE;
            return SERVICE_UNAVAILABLE;
        }
        
        return UNKNOWN;
    }

    @Override
    public String toString() {
        return code;
    }
}
