package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DataSourceRepository 통합 테스트 (Testcontainers 사용)
 * 실제 PostgreSQL 컨테이너에서 테스트를 실행합니다.
 */
@DataJpaTest
@Testcontainers
@ActiveProfiles("test")
class DataSourceRepositoryIT {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("pgvector/pgvector:pg15")
            .withDatabaseName("testdb")
            .withUsername("test")
            .withPassword("test");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "create-drop");
    }

    @Autowired
    private DataSourceRepository dataSourceRepository;

    @Test
    @DisplayName("데이터 소스 저장 및 조회")
    void saveAndFindDataSource() {
        // given
        DataSource source = new DataSource();
        source.setName("테스트 뉴스 소스");
        source.setType(SourceType.NEWS);
        source.setBaseUrl("https://news.example.com");
        source.setActive(true);

        // when
        DataSource saved = dataSourceRepository.save(source);

        // then
        assertThat(saved.getId()).isNotNull();
        assertThat(saved.getName()).isEqualTo("테스트 뉴스 소스");
    }

    @Test
    @DisplayName("활성화된 소스만 조회")
    void findByActiveTrue() {
        // given
        DataSource activeSource = new DataSource();
        activeSource.setName("활성 소스");
        activeSource.setType(SourceType.NEWS);
        activeSource.setBaseUrl("https://active.example.com");
        activeSource.setActive(true);

        DataSource inactiveSource = new DataSource();
        inactiveSource.setName("비활성 소스");
        inactiveSource.setType(SourceType.NEWS);
        inactiveSource.setBaseUrl("https://inactive.example.com");
        inactiveSource.setActive(false);

        dataSourceRepository.save(activeSource);
        dataSourceRepository.save(inactiveSource);

        // when
        List<DataSource> activeSources = dataSourceRepository.findByActiveTrue();

        // then
        assertThat(activeSources).hasSize(1);
        assertThat(activeSources.get(0).getName()).isEqualTo("활성 소스");
    }

    @Test
    @DisplayName("타입별 소스 조회")
    void findByType() {
        // given
        DataSource newsSource = new DataSource();
        newsSource.setName("뉴스 소스");
        newsSource.setType(SourceType.NEWS);
        newsSource.setBaseUrl("https://news.example.com");
        newsSource.setActive(true);

        DataSource socialSource = new DataSource();
        socialSource.setName("소셜 소스");
        socialSource.setType(SourceType.SOCIAL);
        socialSource.setBaseUrl("https://social.example.com");
        socialSource.setActive(true);

        dataSourceRepository.save(newsSource);
        dataSourceRepository.save(socialSource);

        // when
        List<DataSource> newsSources = dataSourceRepository.findByType(SourceType.NEWS);

        // then
        assertThat(newsSources).hasSize(1);
        assertThat(newsSources.get(0).getType()).isEqualTo(SourceType.NEWS);
    }
}
