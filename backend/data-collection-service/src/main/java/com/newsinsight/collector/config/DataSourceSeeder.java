package com.newsinsight.collector.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.entity.BrowserAgentConfig;
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

        int created = 0;
        int skipped = 0;
        for (DataSource desired : sources) {
            DataSource existing = dataSourceRepository
                    .findFirstByUrl(desired.getUrl())
                    .or(() -> dataSourceRepository.findByName(desired.getName()))
                    .orElse(null);

            if (existing == null) {
                dataSourceRepository.save(desired);
                created++;
                continue;
            }
            skipped++;
        }

        log.info(
                "Successfully seeded data sources. created={}, skipped={}, totalDesired={}",
                created,
                skipped,
                sources.size()
        );
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
        
        DataSource.DataSourceBuilder builder = DataSource.builder()
                .name(entry.getName())
                .url(entry.getUrl())
                .sourceType(parseSourceType(entry.getSourceType()))
                .isActive(entry.isActive())
                .collectionFrequency(entry.getCollectionFrequency())
                .metadataJson(metadataJson);
        
        // Add search-related fields for WEB_SEARCH sources
        if (entry.getSearchUrlTemplate() != null) {
            builder.searchUrlTemplate(entry.getSearchUrlTemplate());
        }
        if (entry.getSearchPriority() != null) {
            builder.searchPriority(entry.getSearchPriority());
        }
        
        return builder.build();
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
                .build(),
                
            // ========== BROWSER_AGENT Sources (AI-based crawling) ==========
            // 네이버 뉴스 (Browser Agent)
            DataSource.builder()
                .name("네이버 뉴스 (Browser Agent)")
                .url("https://news.naver.com/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(1800) // 30 min
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"portal\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // 다음 뉴스 (Browser Agent)
            DataSource.builder()
                .name("다음 뉴스 (Browser Agent)")
                .url("https://news.daum.net/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(1800)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"portal\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // 구글 뉴스 한국 (Browser Agent)
            DataSource.builder()
                .name("구글 뉴스 한국 (Browser Agent)")
                .url("https://news.google.com/home?hl=ko&gl=KR&ceid=KR:ko")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"aggregator\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // 네이버 실시간 검색어 트렌드 (Browser Agent - Breaking News)
            DataSource.builder()
                .name("네이버 트렌드 (Browser Agent)")
                .url("https://datalab.naver.com/keyword/realtimeList.naver")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(900) // 15 min - 트렌드는 자주 확인
                .browserAgentConfig(BrowserAgentConfig.forBreakingNews())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"trending\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // 조선일보 (Browser Agent - Archive mode for non-RSS content)
            DataSource.builder()
                .name("조선일보 (Browser Agent)")
                .url("https://www.chosun.com/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(false) // RSS가 있으므로 기본 비활성
                .collectionFrequency(7200)
                .browserAgentConfig(BrowserAgentConfig.forNewsArchive())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"crawler\":\"browser_agent\",\"stance\":\"conservative\"}")
                .build(),
                
            // 한겨레 (Browser Agent)
            DataSource.builder()
                .name("한겨레 (Browser Agent)")
                .url("https://www.hani.co.kr/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(false) // RSS가 있으므로 기본 비활성
                .collectionFrequency(7200)
                .browserAgentConfig(BrowserAgentConfig.forNewsArchive())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"newspaper\",\"crawler\":\"browser_agent\",\"stance\":\"progressive\"}")
                .build(),
                
            // ========== WEB_SEARCH Sources (Portal Search Integration) ==========
            DataSource.builder()
                .name("네이버 뉴스 검색")
                .url("https://search.naver.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.naver.com/search.naver?where=news&query={query}")
                .searchPriority(1)
                .isActive(true)
                .collectionFrequency(0) // 검색은 주기적 수집 없음
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"portal_search\"}")
                .build(),
                
            DataSource.builder()
                .name("다음 뉴스 검색")
                .url("https://search.daum.net")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.daum.net/search?w=news&q={query}")
                .searchPriority(2)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"portal_search\"}")
                .build(),
                
            DataSource.builder()
                .name("구글 뉴스 검색 (한국)")
                .url("https://news.google.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://news.google.com/search?q={query}&hl=ko&gl=KR")
                .searchPriority(3)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"high\",\"category\":\"aggregator_search\"}")
                .build(),
                
            DataSource.builder()
                .name("빙 뉴스 검색 (한국)")
                .url("https://www.bing.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://www.bing.com/news/search?q={query}&cc=kr")
                .searchPriority(4)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"aggregator_search\"}")
                .build(),
                
            // ========== COMMUNITY Sources (커뮤니티 여론 수집) ==========
            // DCInside (디시인사이드)
            DataSource.builder()
                .name("디시인사이드 (Browser Agent)")
                .url("https://www.dcinside.com/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // Clien (클리앙)
            DataSource.builder()
                .name("클리앙 (Browser Agent)")
                .url("https://www.clien.net/service/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // Ruliweb (루리웹)
            DataSource.builder()
                .name("루리웹 (Browser Agent)")
                .url("https://bbs.ruliweb.com/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // Ppomppu (뽐뿌)
            DataSource.builder()
                .name("뽐뿌 (Browser Agent)")
                .url("https://www.ppomppu.co.kr/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // TheQoo (더쿠)
            DataSource.builder()
                .name("더쿠 (Browser Agent)")
                .url("https://theqoo.net/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // FMKorea (에펨코리아)
            DataSource.builder()
                .name("에펨코리아 (Browser Agent)")
                .url("https://www.fmkorea.com/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // MLB Park (엠팍)
            DataSource.builder()
                .name("엠엘비파크 (Browser Agent)")
                .url("https://mlbpark.donga.com/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(3600)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // Bobaedream (보배드림 - 자동차)
            DataSource.builder()
                .name("보배드림 (Browser Agent)")
                .url("https://www.bobaedream.co.kr/")
                .sourceType(SourceType.BROWSER_AGENT)
                .isActive(true)
                .collectionFrequency(7200)
                .browserAgentConfig(BrowserAgentConfig.forNewsExploration())
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"community\",\"source_category\":\"community\",\"crawler\":\"browser_agent\"}")
                .build(),
                
            // ========== COMMUNITY Search Sources (커뮤니티 검색) ==========
            DataSource.builder()
                .name("Reddit 검색")
                .url("https://www.reddit.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://www.reddit.com/search/?q={query}&type=link")
                .searchPriority(5)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"global\",\"language\":\"en\",\"reliability\":\"medium\",\"category\":\"community_search\",\"source_category\":\"community\"}")
                .build(),
                
            DataSource.builder()
                .name("Twitter/X 검색")
                .url("https://twitter.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://twitter.com/search?q={query}&f=live")
                .searchPriority(6)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"global\",\"language\":\"multi\",\"reliability\":\"low\",\"category\":\"social_search\",\"source_category\":\"community\"}")
                .build(),
                
            // ========== BLOG Sources (블로그/의견) ==========
            DataSource.builder()
                .name("네이버 블로그 검색")
                .url("https://search.naver.com")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://search.naver.com/search.naver?where=blog&query={query}")
                .searchPriority(7)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"low\",\"category\":\"blog_search\",\"source_category\":\"blog\"}")
                .build(),
                
            DataSource.builder()
                .name("브런치 검색")
                .url("https://brunch.co.kr")
                .sourceType(SourceType.WEB_SEARCH)
                .searchUrlTemplate("https://brunch.co.kr/search?q={query}")
                .searchPriority(8)
                .isActive(true)
                .collectionFrequency(0)
                .metadataJson("{\"region\":\"korea\",\"language\":\"ko\",\"reliability\":\"medium\",\"category\":\"blog_search\",\"source_category\":\"blog\"}")
                .build()
        );
    }
}
