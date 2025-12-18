package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import com.newsinsight.collector.repository.DataSourceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * DataSourceService 단위 테스트
 */
@ExtendWith(MockitoExtension.class)
class DataSourceServiceTest {

    @Mock
    private DataSourceRepository dataSourceRepository;

    @InjectMocks
    private DataSourceService dataSourceService;

    private DataSource testSource;

    @BeforeEach
    void setUp() {
        testSource = new DataSource();
        testSource.setId(1L);
        testSource.setName("테스트 소스");
        testSource.setType(SourceType.NEWS);
        testSource.setBaseUrl("https://example.com");
        testSource.setActive(true);
    }

    @Test
    @DisplayName("활성화된 소스 목록 조회")
    void findActiveSources() {
        // given
        when(dataSourceRepository.findByActiveTrue()).thenReturn(List.of(testSource));

        // when
        List<DataSource> result = dataSourceService.getActiveSources();

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("테스트 소스");
        verify(dataSourceRepository, times(1)).findByActiveTrue();
    }

    @Test
    @DisplayName("ID로 소스 조회")
    void findById() {
        // given
        when(dataSourceRepository.findById(1L)).thenReturn(Optional.of(testSource));

        // when
        Optional<DataSource> result = dataSourceService.findById(1L);

        // then
        assertThat(result).isPresent();
        assertThat(result.get().getName()).isEqualTo("테스트 소스");
    }

    @Test
    @DisplayName("소스 저장")
    void saveSource() {
        // given
        when(dataSourceRepository.save(any(DataSource.class))).thenReturn(testSource);

        // when
        DataSource result = dataSourceService.save(testSource);

        // then
        assertThat(result).isNotNull();
        assertThat(result.getName()).isEqualTo("테스트 소스");
        verify(dataSourceRepository, times(1)).save(testSource);
    }
}
