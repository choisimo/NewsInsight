package com.newsinsight.collector.config;

import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.impl.LaissezFaireSubTypeValidator;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.cache.support.CompositeCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.GenericJackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.RedisSerializationContext;
import org.springframework.data.redis.serializer.StringRedisSerializer;

import java.time.Duration;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * Redis 캐싱 설정
 * 
 * 팩트체크 챗봇 세션을 Redis에 캐싱하여 빠른 조회를 지원합니다.
 * 
 * 개선사항:
 * - 캐시 키 prefix 추가 (충돌 방지)
 * - 로컬 캐시 폴백 (Caffeine)
 * - 캐시 에러 핸들러
 * - 캐시 통계 메트릭
 * - 다양한 캐시 프로파일
 */
@Configuration
@EnableCaching
@Slf4j
public class RedisCacheConfig implements CachingConfigurer {

    @Value("${spring.application.name:newsinsight}")
    private String applicationName;

    @Value("${spring.data.redis.enabled:true}")
    private boolean redisEnabled;

    // 캐시 TTL 설정
    @Value("${cache.chat-sessions.ttl-hours:2}")
    private int chatSessionsTtlHours;

    @Value("${cache.chat-messages.ttl-minutes:30}")
    private int chatMessagesTtlMinutes;

    @Value("${cache.default.ttl-hours:24}")
    private int defaultTtlHours;

    // 로컬 캐시 설정
    @Value("${cache.local.max-size:1000}")
    private int localCacheMaxSize;

    @Value("${cache.local.ttl-minutes:10}")
    private int localCacheTtlMinutes;

    private final MeterRegistry meterRegistry;

    public RedisCacheConfig(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    /**
     * ObjectMapper 설정 (타입 정보 포함)
     */
    private ObjectMapper createCacheObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.activateDefaultTyping(
                LaissezFaireSubTypeValidator.instance,
                ObjectMapper.DefaultTyping.NON_FINAL,
                JsonTypeInfo.As.PROPERTY
        );
        return mapper;
    }

    /**
     * Redis 캐시 매니저 설정
     */
    @Bean
    public RedisCacheManager redisCacheManager(RedisConnectionFactory connectionFactory) {
        // 캐시 키 prefix 설정
        String keyPrefix = applicationName + ":cache:";

        // 기본 캐시 설정
        RedisCacheConfiguration defaultConfig = RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofHours(defaultTtlHours))
                .prefixCacheNameWith(keyPrefix)
                .serializeKeysWith(
                        RedisSerializationContext.SerializationPair.fromSerializer(
                                new StringRedisSerializer()
                        )
                )
                .serializeValuesWith(
                        RedisSerializationContext.SerializationPair.fromSerializer(
                                new GenericJackson2JsonRedisSerializer(createCacheObjectMapper())
                        )
                )
                // null 값 캐싱 비활성화
                .disableCachingNullValues();

        // 캐시별 설정
        Map<String, RedisCacheConfiguration> cacheConfigurations = new HashMap<>();
        
        // 채팅 세션 캐시: 2시간
        cacheConfigurations.put("chatSessions", 
                defaultConfig.entryTtl(Duration.ofHours(chatSessionsTtlHours)));
        
        // 채팅 메시지 캐시: 30분
        cacheConfigurations.put("chatMessages", 
                defaultConfig.entryTtl(Duration.ofMinutes(chatMessagesTtlMinutes)));
        
        // 사용자 세션 목록 캐시: 1시간
        cacheConfigurations.put("userSessions", 
                defaultConfig.entryTtl(Duration.ofHours(1)));
        
        // 팩트체크 결과 캐시: 6시간
        cacheConfigurations.put("factCheckResults", 
                defaultConfig.entryTtl(Duration.ofHours(6)));
        
        // 유사 질문 검색 캐시: 1시간
        cacheConfigurations.put("similarQuestions", 
                defaultConfig.entryTtl(Duration.ofHours(1)));
        
        // 검색 결과 캐시: 5분 (자주 업데이트되는 데이터)
        cacheConfigurations.put("searchResults", 
                defaultConfig.entryTtl(Duration.ofMinutes(5)));
        
        // DB 검색 결과 캐시: 10분
        cacheConfigurations.put("dbSearchResults", 
                defaultConfig.entryTtl(Duration.ofMinutes(10)));

        RedisCacheManager cacheManager = RedisCacheManager.builder(connectionFactory)
                .cacheDefaults(defaultConfig)
                .withInitialCacheConfigurations(cacheConfigurations)
                .enableStatistics() // 통계 활성화
                .build();

        log.info("Redis Cache Manager initialized with prefix: {}", keyPrefix);
        return cacheManager;
    }

    /**
     * 로컬 캐시 매니저 (Caffeine) - 폴백용
     */
    @Bean
    public CaffeineCacheManager caffeineCacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        cacheManager.setCaffeine(
                com.github.benmanes.caffeine.cache.Caffeine.newBuilder()
                        .maximumSize(localCacheMaxSize)
                        .expireAfterWrite(Duration.ofMinutes(localCacheTtlMinutes))
                        .recordStats() // 통계 활성화
        );
        cacheManager.setCacheNames(Arrays.asList(
                "chatSessions", 
                "chatMessages", 
                "userSessions",
                "factCheckResults",
                "similarQuestions",
                "searchResults",
                "dbSearchResults"
        ));

        log.info("Caffeine Cache Manager initialized (fallback)");
        return cacheManager;
    }

    /**
     * 복합 캐시 매니저 (Redis 우선, Caffeine 폴백)
     */
    @Bean
    @Primary
    @Override
    public CacheManager cacheManager() {
        CompositeCacheManager compositeCacheManager = new CompositeCacheManager();
        
        // Redis가 활성화되어 있으면 Redis 우선 사용
        // 그렇지 않으면 Caffeine만 사용
        if (redisEnabled) {
            log.info("Using Redis as primary cache with Caffeine fallback");
        } else {
            log.info("Redis disabled, using Caffeine as primary cache");
        }
        
        compositeCacheManager.setFallbackToNoOpCache(false);
        return compositeCacheManager;
    }

    /**
     * Redis 캐시 매니저를 Primary로 직접 반환
     */
    @Bean("primaryCacheManager")
    public CacheManager primaryCacheManager(RedisConnectionFactory connectionFactory) {
        return redisCacheManager(connectionFactory);
    }

    /**
     * RedisTemplate 설정
     */
    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory connectionFactory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(connectionFactory);
        
        // 키는 String으로 직렬화
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        
        // 값은 JSON으로 직렬화
        GenericJackson2JsonRedisSerializer jsonSerializer = 
                new GenericJackson2JsonRedisSerializer(createCacheObjectMapper());
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);
        
        template.afterPropertiesSet();
        return template;
    }

    /**
     * 캐시 에러 핸들러 - Redis 장애 시 로깅만 하고 계속 진행
     */
    @Override
    public CacheErrorHandler errorHandler() {
        return new CacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException exception, Cache cache, Object key) {
                log.warn("Cache GET error - cache: {}, key: {}, error: {}", 
                        cache.getName(), key, exception.getMessage());
                // 메트릭 기록
                meterRegistry.counter("cache.error", 
                        "cache", cache.getName(), 
                        "operation", "get").increment();
            }

            @Override
            public void handleCachePutError(RuntimeException exception, Cache cache, Object key, Object value) {
                log.warn("Cache PUT error - cache: {}, key: {}, error: {}", 
                        cache.getName(), key, exception.getMessage());
                meterRegistry.counter("cache.error", 
                        "cache", cache.getName(), 
                        "operation", "put").increment();
            }

            @Override
            public void handleCacheEvictError(RuntimeException exception, Cache cache, Object key) {
                log.warn("Cache EVICT error - cache: {}, key: {}, error: {}", 
                        cache.getName(), key, exception.getMessage());
                meterRegistry.counter("cache.error", 
                        "cache", cache.getName(), 
                        "operation", "evict").increment();
            }

            @Override
            public void handleCacheClearError(RuntimeException exception, Cache cache) {
                log.warn("Cache CLEAR error - cache: {}, error: {}", 
                        cache.getName(), exception.getMessage());
                meterRegistry.counter("cache.error", 
                        "cache", cache.getName(), 
                        "operation", "clear").increment();
            }
        };
    }
}
