package com.newsinsight.collector.config;

import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.service.autocrawl.AutoCrawlDiscoveryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;

/**
 * AutoCrawl 초기화 컴포넌트.
 * 
 * 애플리케이션 시작 시 seed URL들을 크롤링 큐에 자동으로 추가합니다.
 * docker-compose 실행 시 즉시 크롤링이 시작되도록 합니다.
 */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "autocrawl.enabled", havingValue = "true", matchIfMissing = false)
public class AutoCrawlInitializer {

    private final AutoCrawlDiscoveryService autoCrawlDiscoveryService;

    @Value("${autocrawl.seed.enabled:true}")
    private boolean seedEnabled;

    @Value("${autocrawl.seed.urls:}")
    private String seedUrlsConfig;

    @Value("${autocrawl.seed.keywords:뉴스,정치,경제,사회,IT,기술}")
    private String seedKeywords;

    @Value("${autocrawl.seed.priority:70}")
    private int seedPriority;

    /**
     * 기본 seed URL 목록 (한국 주요 뉴스 포털)
     */
    private static final List<String> DEFAULT_SEED_URLS = List.of(
            // 네이버 뉴스 메인
            "https://news.naver.com",
            "https://news.naver.com/section/100",  // 정치
            "https://news.naver.com/section/101",  // 경제
            "https://news.naver.com/section/102",  // 사회
            "https://news.naver.com/section/103",  // 생활/문화
            "https://news.naver.com/section/104",  // 세계
            "https://news.naver.com/section/105",  // IT/과학
            
            // 다음 뉴스 메인
            "https://news.daum.net",
            "https://news.daum.net/politics",
            "https://news.daum.net/economic",
            "https://news.daum.net/society",
            "https://news.daum.net/culture",
            "https://news.daum.net/digital",
            
            // 주요 언론사 메인
            "https://www.chosun.com",
            "https://www.donga.com",
            "https://www.joongang.co.kr",
            "https://www.hani.co.kr",
            "https://www.khan.co.kr",
            "https://www.yna.co.kr",
            
            // IT/기술 뉴스
            "https://www.etnews.com",
            "https://zdnet.co.kr",
            "https://www.bloter.net"
    );

    @EventListener(ApplicationReadyEvent.class)
    public void initializeSeedUrls() {
        if (!seedEnabled) {
            log.info("[AutoCrawl Init] Seed initialization is disabled. Set AUTOCRAWL_SEED_ENABLED=true to enable.");
            return;
        }

        log.info("[AutoCrawl Init] Starting seed URL initialization...");

        try {
            List<String> seedUrls = getSeedUrls();
            
            if (seedUrls.isEmpty()) {
                log.warn("[AutoCrawl Init] No seed URLs configured");
                return;
            }

            log.info("[AutoCrawl Init] Adding {} seed URLs to crawl queue", seedUrls.size());

            List<CrawlTarget> addedTargets = autoCrawlDiscoveryService.addManualTargets(
                    seedUrls,
                    seedKeywords,
                    seedPriority
            );

            log.info("[AutoCrawl Init] Successfully added {} seed URLs to crawl queue (skipped {} duplicates)",
                    addedTargets.size(),
                    seedUrls.size() - addedTargets.size());

            // 추가된 URL 로깅
            if (!addedTargets.isEmpty() && log.isDebugEnabled()) {
                addedTargets.forEach(target -> 
                    log.debug("[AutoCrawl Init] Added: {} (priority={})", target.getUrl(), target.getPriority())
                );
            }

        } catch (Exception e) {
            log.error("[AutoCrawl Init] Failed to initialize seed URLs: {}", e.getMessage(), e);
        }
    }

    /**
     * Seed URL 목록 가져오기
     * 환경 변수로 설정된 URL이 있으면 사용, 없으면 기본 URL 사용
     */
    private List<String> getSeedUrls() {
        if (seedUrlsConfig != null && !seedUrlsConfig.isBlank()) {
            // 환경 변수로 설정된 커스텀 URL 사용 (콤마로 구분)
            List<String> customUrls = Arrays.stream(seedUrlsConfig.split(","))
                    .map(String::trim)
                    .filter(url -> !url.isBlank())
                    .filter(url -> url.startsWith("http://") || url.startsWith("https://"))
                    .toList();
            
            if (!customUrls.isEmpty()) {
                log.info("[AutoCrawl Init] Using {} custom seed URLs from configuration", customUrls.size());
                return customUrls;
            }
        }

        // 기본 seed URL 사용
        log.info("[AutoCrawl Init] Using {} default seed URLs", DEFAULT_SEED_URLS.size());
        return DEFAULT_SEED_URLS;
    }
}
