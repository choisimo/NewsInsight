package com.newsinsight.collector.config;

import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import com.newsinsight.collector.repository.DataSourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * 웹 검색 소스 자동 초기화.
 * 
 * 애플리케이션 시작 시 기본 웹 검색 소스(네이버, 다음, 구글 뉴스)를
 * DB에 자동으로 등록합니다. 이미 등록된 소스는 건너뜁니다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DataSourceInitializer implements CommandLineRunner {

    private final DataSourceRepository dataSourceRepository;

    @Override
    @Transactional
    public void run(String... args) {
        log.info("Initializing default web search sources...");
        
        List<DataSource> defaultSources = createDefaultWebSearchSources();
        int initialized = 0;
        
        for (DataSource source : defaultSources) {
            // 이미 존재하는지 확인 (이름으로)
            if (dataSourceRepository.findByName(source.getName()).isEmpty()) {
                dataSourceRepository.save(source);
                initialized++;
                log.info("Initialized web search source: {}", source.getName());
            } else {
                log.debug("Web search source already exists: {}", source.getName());
            }
        }
        
        if (initialized > 0) {
            log.info("Initialized {} new web search sources", initialized);
        } else {
            log.info("All default web search sources already exist");
        }
        
        // 현재 활성화된 웹 검색 소스 수 로깅
        long activeCount = dataSourceRepository.findActiveWebSearchSources().size();
        log.info("Total active web search sources: {}", activeCount);
    }

    /**
     * 기본 웹 검색 소스 생성
     */
    private List<DataSource> createDefaultWebSearchSources() {
        List<DataSource> sources = new ArrayList<>();
        
        // 1. 네이버 뉴스 (최고 우선순위)
        sources.add(DataSource.builder()
                .name("네이버 뉴스")
                .url("https://news.naver.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.naver.com/search.naver?where=news&query={query}")
                .searchPriority(10)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"country\":\"KR\",\"language\":\"ko\",\"portal\":\"naver\"}")
                .build());
        
        // 2. 다음 뉴스
        sources.add(DataSource.builder()
                .name("다음 뉴스")
                .url("https://news.daum.net")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.daum.net/search?w=news&q={query}")
                .searchPriority(20)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"country\":\"KR\",\"language\":\"ko\",\"portal\":\"daum\"}")
                .build());
        
        // 3. 구글 뉴스 (한국)
        sources.add(DataSource.builder()
                .name("구글 뉴스")
                .url("https://news.google.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://news.google.com/search?q={query}&hl=ko&gl=KR")
                .searchPriority(30)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"country\":\"KR\",\"language\":\"ko\",\"portal\":\"google\"}")
                .build());
        
        // 4. 네이트 뉴스 (비활성화 상태로 추가 - 사용자가 필요시 활성화 가능)
        sources.add(DataSource.builder()
                .name("네이트 뉴스")
                .url("https://news.nate.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.nate.com/search/all.html?q={query}&csn=1")
                .searchPriority(40)
                .isActive(false)
                .collectionFrequency(3600)
                .metadataJson("{\"country\":\"KR\",\"language\":\"ko\",\"portal\":\"nate\"}")
                .build());
        
        // 5. 줌 뉴스 (비활성화 상태로 추가)
        sources.add(DataSource.builder()
                .name("줌 뉴스")
                .url("https://news.zum.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.zum.com/search.zum?method=news&query={query}")
                .searchPriority(50)
                .isActive(false)
                .collectionFrequency(3600)
                .metadataJson("{\"country\":\"KR\",\"language\":\"ko\",\"portal\":\"zum\"}")
                .build());
        
        return sources;
    }
}
