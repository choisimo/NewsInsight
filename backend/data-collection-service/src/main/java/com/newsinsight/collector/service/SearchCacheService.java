package com.newsinsight.collector.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

/**
 * Search Result Cache Service
 * 
 * Redis를 사용하여 검색 결과를 캐싱합니다.
 * - DB 검색 결과: 10분 TTL
 * - 통합 검색 결과: 5분 TTL
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SearchCacheService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectMapper objectMapper;

    private static final String DB_SEARCH_CACHE_PREFIX = "newsinsight:search:db:";
    private static final String UNIFIED_SEARCH_CACHE_PREFIX = "newsinsight:search:unified:";
    private static final Duration DB_SEARCH_TTL = Duration.ofMinutes(10);
    private static final Duration UNIFIED_SEARCH_TTL = Duration.ofMinutes(5);

    /**
     * 캐시 키 생성 (쿼리 + 윈도우 해시)
     */
    public String generateCacheKey(String query, String window) {
        String input = query.toLowerCase().trim() + ":" + (window != null ? window : "all");
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (int i = 0; i < Math.min(hash.length, 16); i++) {
                String hex = Integer.toHexString(0xff & hash[i]);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            // Fallback to simple hash
            return String.valueOf(input.hashCode());
        }
    }

    /**
     * DB 검색 결과 캐시 조회
     */
    @SuppressWarnings("unchecked")
    public <T> Optional<List<T>> getDbSearchResults(String query, String window, Class<T> elementType) {
        String cacheKey = DB_SEARCH_CACHE_PREFIX + generateCacheKey(query, window);
        try {
            Object cached = redisTemplate.opsForValue().get(cacheKey);
            if (cached != null) {
                log.debug("Cache HIT for DB search: query='{}', window='{}'", query, window);
                if (cached instanceof List) {
                    return Optional.of((List<T>) cached);
                }
            }
            log.debug("Cache MISS for DB search: query='{}', window='{}'", query, window);
        } catch (Exception e) {
            log.warn("Error reading from cache: {}", e.getMessage());
        }
        return Optional.empty();
    }

    /**
     * DB 검색 결과 캐시 저장
     */
    public <T> void cacheDbSearchResults(String query, String window, List<T> results) {
        if (results == null || results.isEmpty()) {
            return; // 빈 결과는 캐싱하지 않음
        }
        
        String cacheKey = DB_SEARCH_CACHE_PREFIX + generateCacheKey(query, window);
        try {
            redisTemplate.opsForValue().set(cacheKey, results, DB_SEARCH_TTL);
            log.debug("Cached DB search results: query='{}', window='{}', count={}", 
                    query, window, results.size());
        } catch (Exception e) {
            log.warn("Error caching DB search results: {}", e.getMessage());
        }
    }

    /**
     * 통합 검색 결과 캐시 조회
     */
    @SuppressWarnings("unchecked")
    public <T> Optional<T> getUnifiedSearchResults(String query, String window, Class<T> resultType) {
        String cacheKey = UNIFIED_SEARCH_CACHE_PREFIX + generateCacheKey(query, window);
        try {
            Object cached = redisTemplate.opsForValue().get(cacheKey);
            if (cached != null) {
                log.debug("Cache HIT for unified search: query='{}', window='{}'", query, window);
                return Optional.of((T) cached);
            }
            log.debug("Cache MISS for unified search: query='{}', window='{}'", query, window);
        } catch (Exception e) {
            log.warn("Error reading from cache: {}", e.getMessage());
        }
        return Optional.empty();
    }

    /**
     * 통합 검색 결과 캐시 저장
     */
    public <T> void cacheUnifiedSearchResults(String query, String window, T results) {
        if (results == null) {
            return;
        }
        
        String cacheKey = UNIFIED_SEARCH_CACHE_PREFIX + generateCacheKey(query, window);
        try {
            redisTemplate.opsForValue().set(cacheKey, results, UNIFIED_SEARCH_TTL);
            log.debug("Cached unified search results: query='{}', window='{}'", query, window);
        } catch (Exception e) {
            log.warn("Error caching unified search results: {}", e.getMessage());
        }
    }

    /**
     * 검색 캐시 무효화
     */
    public void invalidateSearchCache(String query, String window) {
        String dbKey = DB_SEARCH_CACHE_PREFIX + generateCacheKey(query, window);
        String unifiedKey = UNIFIED_SEARCH_CACHE_PREFIX + generateCacheKey(query, window);
        
        try {
            redisTemplate.delete(dbKey);
            redisTemplate.delete(unifiedKey);
            log.debug("Invalidated search cache for query='{}', window='{}'", query, window);
        } catch (Exception e) {
            log.warn("Error invalidating cache: {}", e.getMessage());
        }
    }

    /**
     * 모든 검색 캐시 클리어
     */
    public void clearAllSearchCaches() {
        try {
            redisTemplate.delete(redisTemplate.keys(DB_SEARCH_CACHE_PREFIX + "*"));
            redisTemplate.delete(redisTemplate.keys(UNIFIED_SEARCH_CACHE_PREFIX + "*"));
            log.info("Cleared all search caches");
        } catch (Exception e) {
            log.warn("Error clearing all search caches: {}", e.getMessage());
        }
    }

    /**
     * 캐시 통계 조회
     */
    public CacheStats getStats() {
        try {
            Long dbKeyCount = Optional.ofNullable(
                    redisTemplate.keys(DB_SEARCH_CACHE_PREFIX + "*")
            ).map(keys -> (long) keys.size()).orElse(0L);
            
            Long unifiedKeyCount = Optional.ofNullable(
                    redisTemplate.keys(UNIFIED_SEARCH_CACHE_PREFIX + "*")
            ).map(keys -> (long) keys.size()).orElse(0L);
            
            return new CacheStats(dbKeyCount, unifiedKeyCount);
        } catch (Exception e) {
            log.warn("Error getting cache stats: {}", e.getMessage());
            return new CacheStats(0L, 0L);
        }
    }

    public record CacheStats(Long dbSearchKeys, Long unifiedSearchKeys) {
        public Long totalKeys() {
            return dbSearchKeys + unifiedSearchKeys;
        }
    }
}
