package com.newsinsight.collector;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

/**
 * 스프링 컨텍스트 로드 테스트
 * 애플리케이션 설정이 올바르게 구성되었는지 확인합니다.
 */
@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(properties = {
    // Consul 비활성화
    "spring.cloud.consul.enabled=false",
    "spring.cloud.consul.config.enabled=false",
    "spring.cloud.consul.discovery.enabled=false",
    // Kafka 비활성화
    "spring.kafka.enabled=false",
    // 임베딩 비활성화
    "embedding.enabled=false",
    "hybrid-search.enabled=false",
    "vector-search.enabled=false"
})
class CollectorApplicationTests {

    @Test
    void contextLoads() {
        // 스프링 컨텍스트가 정상적으로 로드되면 테스트 통과
    }
}
