package com.newsinsight.collector.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import com.newsinsight.collector.repository.DataSourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Seeds the database with default Korean news sources on application startup.
 * Only runs if the data_sources table is empty.
 * 
 * Sources can be configured via:
 * 1. application.yml (collector.data-sources.sources)
 * 2. Default hardcoded sources (if no external config provided)
 * 
 * Profiles:
 * - default: Runs automatically
 * - no-seed: Skip seeding (for production or when using external config)
 */
@Component
@Profile("!no-seed")
@RequiredArgsConstructor
@Slf4j
public class DataSourceSeeder implements ApplicationRunner {

    private final DataSourceRepository dataSourceRepository;
    private final DataSourcesConfig dataSourcesConfig;
    private final ObjectMapper objectMapper;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!dataSourcesConfig.isSeedEnabled()) {
            log.info("DataSource seeding is disabled via configuration.");
            return;
        }

        long existingCount = dataSourceRepository.count();
        if (existingCount > 0) {
            log.info("DataSource table already has {} entries, skipping seed.", existingCount);
            return;
        }

        log.info("Seeding data sources...");
        
        List<DataSource> sources;
        
        // Check if external configuration is provided
        if (dataSourcesConfig.getSources() != null && !dataSourcesConfig.getSources().isEmpty()) {
            log.info("Using {} data sources from external configuration.", dataSourcesConfig.getSources().size());
            sources = dataSourcesConfig.getSources().stream()
                    .map(this::convertToDataSource)
                    .collect(Collectors.toList());
        } else {
            log.info("No external configuration found, using default Korean news sources.");
            sources = createDefaultSources();
        }
        
        dataSourceRepository.saveAll(sources);
        
        log.info("Successfully seeded {} data sources.", sources.size());
    }

    /**
     * Convert external configuration entry to DataSource entity
     */
    private DataSource convertToDataSource(DataSourcesConfig.DataSourceEntry entry) {
        // Build metadata JSON from entry fields
        Map<String, String> metadata = new HashMap<>();
        if (entry.getRegion() != null) metadata.put("region", entry.getRegion());
        if (entry.getLanguage() != null) metadata.put("language", entry.getLanguage());
        if (entry.getReliability() != null) metadata.put("reliability", entry.getReliability());
        if (entry.getCategory() != null) metadata.put("category", entry.getCategory());
        if (entry.getStance() != null) metadata.put("stance", entry.getStance());
        
        // Merge with any additional metadata provided
        if (entry.getMetadata() != null) {
            metadata.putAll(entry.getMetadata());
        }
        
        String metadataJson;
        try {
            metadataJson = objectMapper.writeValueAsString(metadata);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize metadata for source {}: {}", entry.getName(), e.getMessage());
            metadataJson = "{}";
        }
        
        return DataSource.builder()
                .name(entry.getName())
                .url(entry.getUrl())
                .sourceType(parseSourceType(entry.getSourceType()))
                .isActive(entry.isActive())
                .collectionFrequency(entry.getCollectionFrequency())
                .metadataJson(metadataJson)
                .build();
    }

    private SourceType parseSourceType(String type) {
        if (type == null) return SourceType.RSS;
        try {
            return SourceType.valueOf(type.toUpperCase());
        } catch (IllegalArgumentException e) {
            log.warn("Unknown source type '{}', defaulting to RSS", type);
            return SourceType.RSS;
        }
    }

    private List<DataSource> createDefaultSources() {
        return List.of(
            // ========== Korean Major News (High Reliability) ==========
            DataSource.builder()
                .name("연합뉴스 (Yonhap)")
                .url("https://www.yna.co.kr/rss/news.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800) // 30 min
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"news_agency\"}")
                .build(),
                
            DataSource.builder()
                .name("KBS 뉴스")
                .url("https://news.kbs.co.kr/rss/rss.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"broadcast\"}")
                .build(),
                
            DataSource.builder()
                .name("MBC 뉴스")
                .url("https://imnews.imbc.com/rss/news.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"broadcast\"}")
                .build(),
                
            DataSource.builder()
                .name("SBS 뉴스")
                .url("https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"broadcast\"}")
                .build(),
                
            // ========== Korean Major Newspapers ==========
            DataSource.builder()
                .name("조선일보")
                .url("https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"stance\":\"conservative\"}")
                .build(),
                
            DataSource.builder()
                .name("중앙일보")
                .url("https://rss.joins.com/joins_news_list.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"stance\":\"center-right\"}")
                .build(),
                
            DataSource.builder()
                .name("동아일보")
                .url("https://rss.donga.com/total.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"stance\":\"conservative\"}")
                .build(),
                
            DataSource.builder()
                .name("한겨레")
                .url("https://www.hani.co.kr/rss/")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"stance\":\"progressive\"}")
                .build(),
                
            DataSource.builder()
                .name("경향신문")
                .url("https://www.khan.co.kr/rss/rssdata/total_news.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"stance\":\"progressive\"}")
                .build(),
                
            // ========== Korean Business/Economy News ==========
            DataSource.builder()
                .name("매일경제")
                .url("https://www.mk.co.kr/rss/30000001/")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"business\"}")
                .build(),
                
            DataSource.builder()
                .name("한국경제")
                .url("https://www.hankyung.com/feed/all-news")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"business\"}")
                .build(),
                
            // ========== Korean IT/Tech News ==========
            DataSource.builder()
                .name("ZDNet Korea")
                .url("https://zdnet.co.kr/rss/")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"tech\"}")
                .build(),
                
            DataSource.builder()
                .name("전자신문 (ETNews)")
                .url("https://www.etnews.com/rss")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(3600)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"tech\"}")
                .build(),
                
            DataSource.builder()
                .name("블로터 (Bloter)")
                .url("https://www.bloter.net/feed")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(7200)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"tech_startup\"}")
                .build(),
                
            // ========== International News (Korean Edition) ==========
            DataSource.builder()
                .name("BBC 코리아")
                .url("https://feeds.bbci.co.uk/korean/rss.xml")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800)
                .metadataJson("{\"region\":\"international\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"international\"}")
                .build(),
                
            DataSource.builder()
                .name("뉴시스 (Newsis)")
                .url("https://newsis.com/RSS/")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"news_agency\"}")
                .build(),
                
            DataSource.builder()
                .name("뉴스1")
                .url("https://www.news1.kr/rss/")
                .sourceType(SourceType.RSS)
                .isActive(true)
                .collectionFrequency(1800)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"news_agency\"}")
                .build()
        );
    }
}
