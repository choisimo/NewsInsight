package com.newsinsight.collector.service.autocrawl;

import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.autocrawl.ContentType;
import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.entity.autocrawl.CrawlTargetStatus;
import com.newsinsight.collector.entity.autocrawl.DiscoverySource;
import com.newsinsight.collector.repository.CrawlTargetRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 자동 크롤링 대상 URL 발견 서비스.
 * 
 * 검색 결과, 기사 내 링크, 트렌딩 토픽 등에서 크롤링 대상 URL을 자동으로 발견합니다.
 * 발견된 URL은 CrawlTarget 엔티티로 저장되어 크롤링 큐에 추가됩니다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AutoCrawlDiscoveryService {

    private final CrawlTargetRepository crawlTargetRepository;

    // ========================================
    // URL 패턴 매칭
    // ========================================
    
    /**
     * 뉴스 URL 패턴 (한국 주요 언론사)
     */
    private static final Pattern NEWS_URL_PATTERN = Pattern.compile(
            ".*(?:news\\.naver\\.com|news\\.daum\\.net|news\\.kakao\\.com|" +
            "n\\.news\\.naver\\.com|v\\.media\\.daum\\.net|" +
            "chosun\\.com|donga\\.com|joongang\\.co\\.kr|hani\\.co\\.kr|" +
            "khan\\.co\\.kr|yna\\.co\\.kr|yonhapnews\\.co\\.kr|" +
            "hankookilbo\\.com|mk\\.co\\.kr|mt\\.co\\.kr|sedaily\\.com|" +
            "etnews\\.com|zdnet\\.co\\.kr|inews24\\.com|itworld\\.co\\.kr|" +
            "bloter\\.net|techholic\\.co\\.kr|" +
            "reuters\\.com|apnews\\.com|bbc\\.com\\/news|cnn\\.com).*"
    );

    /**
     * 제외할 URL 패턴 (광고, 로그인, 정적 리소스 등)
     */
    private static final Pattern EXCLUDED_URL_PATTERN = Pattern.compile(
            ".*(?:login|logout|signin|signup|register|auth|oauth|" +
            "advertisement|ad\\.|ads\\.|banner|popup|tracking|" +
            "\\.css|\\.js|\\.jpg|\\.jpeg|\\.png|\\.gif|\\.ico|\\.svg|\\.webp|" +
            "\\.pdf|\\.doc|\\.xls|\\.ppt|\\.zip|\\.rar|" +
            "facebook\\.com|twitter\\.com|instagram\\.com|youtube\\.com|" +
            "play\\.google\\.com|apps\\.apple\\.com|" +
            "javascript:|mailto:|tel:|#).*",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * 도메인별 콘텐츠 타입 매핑
     */
    private static final Map<Pattern, ContentType> DOMAIN_CONTENT_TYPE_MAP = Map.of(
            Pattern.compile(".*(?:news\\.naver|news\\.daum|chosun|donga|joongang|hani|khan|yna).*"), ContentType.NEWS,
            Pattern.compile(".*(?:blog\\.naver|tistory|brunch|velog|medium).*"), ContentType.BLOG,
            Pattern.compile(".*(?:reddit|dcinside|ruliweb|clien|ppomppu).*"), ContentType.FORUM,
            Pattern.compile(".*(?:twitter|x\\.com|facebook|instagram).*"), ContentType.SOCIAL,
            Pattern.compile(".*(?:\\.go\\.kr|\\.or\\.kr|\\.gov\\.|assembly).*"), ContentType.OFFICIAL,
            Pattern.compile(".*(?:arxiv|scholar\\.google|dbpia|riss|sciencedirect).*"), ContentType.ACADEMIC
    );

    // ========================================
    // 검색 결과에서 URL 발견
    // ========================================

    /**
     * 검색 쿼리와 검색 결과 HTML에서 URL 발견
     * 
     * @param query 검색 쿼리
     * @param htmlContent 검색 결과 HTML
     * @param baseUrl 검색 페이지 URL (상대 경로 해결용)
     * @return 발견된 CrawlTarget 목록
     */
    @Transactional
    public List<CrawlTarget> discoverFromSearchResult(String query, String htmlContent, String baseUrl) {
        log.info("Discovering URLs from search result for query: '{}'", query);
        
        List<String> extractedUrls = extractUrlsFromHtml(htmlContent, baseUrl);
        List<CrawlTarget> targets = new ArrayList<>();
        
        for (String url : extractedUrls) {
            if (!isValidCrawlUrl(url)) {
                continue;
            }
            
            CrawlTarget target = createOrUpdateTarget(
                    url,
                    DiscoverySource.SEARCH,
                    "search_query:" + query,
                    calculateSearchPriority(url, query),
                    query
            );
            
            if (target != null) {
                targets.add(target);
            }
        }
        
        log.info("Discovered {} URLs from search result for query: '{}'", targets.size(), query);
        return targets;
    }

    /**
     * 검색 결과 URL 목록에서 직접 발견
     */
    @Transactional
    public List<CrawlTarget> discoverFromSearchUrls(String query, List<String> urls) {
        log.info("Discovering from {} search result URLs for query: '{}'", urls.size(), query);
        
        List<CrawlTarget> targets = new ArrayList<>();
        
        for (String url : urls) {
            if (!isValidCrawlUrl(url)) {
                continue;
            }
            
            CrawlTarget target = createOrUpdateTarget(
                    url,
                    DiscoverySource.SEARCH,
                    "search_query:" + query,
                    calculateSearchPriority(url, query),
                    query
            );
            
            if (target != null) {
                targets.add(target);
            }
        }
        
        return targets;
    }

    // ========================================
    // 기사 내 링크에서 URL 발견
    // ========================================

    /**
     * 수집된 기사 콘텐츠에서 외부 링크 발견
     * 
     * @param collectedData 수집된 기사 데이터
     * @return 발견된 CrawlTarget 목록
     */
    @Transactional
    public List<CrawlTarget> discoverFromArticle(CollectedData collectedData) {
        if (collectedData.getContent() == null || collectedData.getContent().isBlank()) {
            return Collections.emptyList();
        }
        
        log.debug("Discovering URLs from article: id={}, url={}", 
                collectedData.getId(), collectedData.getUrl());
        
        List<String> extractedUrls = extractUrlsFromHtml(collectedData.getContent(), collectedData.getUrl());
        List<CrawlTarget> targets = new ArrayList<>();
        
        String context = "article_id:" + collectedData.getId();
        String keywords = collectedData.getTitle(); // 기사 제목을 키워드로 사용
        
        for (String url : extractedUrls) {
            if (!isValidCrawlUrl(url)) {
                continue;
            }
            
            // 같은 도메인 링크는 낮은 우선순위
            int priority = isSameDomain(url, collectedData.getUrl()) ? 30 : 50;
            
            CrawlTarget target = createOrUpdateTarget(
                    url,
                    DiscoverySource.ARTICLE_LINK,
                    context,
                    priority,
                    keywords
            );
            
            if (target != null) {
                targets.add(target);
            }
        }
        
        log.debug("Discovered {} URLs from article: id={}", targets.size(), collectedData.getId());
        return targets;
    }

    // ========================================
    // 트렌딩 토픽에서 URL 발견
    // ========================================

    /**
     * 트렌딩 키워드에서 URL 발견 (포털 실시간 검색어 등)
     */
    @Transactional
    public List<CrawlTarget> discoverFromTrendingTopic(String topic, List<String> relatedUrls) {
        log.info("Discovering from trending topic: '{}' with {} URLs", topic, relatedUrls.size());
        
        List<CrawlTarget> targets = new ArrayList<>();
        
        for (String url : relatedUrls) {
            if (!isValidCrawlUrl(url)) {
                continue;
            }
            
            // 트렌딩 토픽은 높은 우선순위
            CrawlTarget target = createOrUpdateTarget(
                    url,
                    DiscoverySource.TRENDING,
                    "trending_topic:" + topic,
                    80,
                    topic
            );
            
            if (target != null) {
                targets.add(target);
            }
        }
        
        return targets;
    }

    // ========================================
    // Deep Search 결과에서 URL 발견
    // ========================================

    /**
     * Deep Search 결과에서 URL 발견
     */
    @Transactional
    public List<CrawlTarget> discoverFromDeepSearch(String searchId, String query, List<String> urls) {
        log.info("Discovering from deep search: id={}, query='{}', urls={}", searchId, query, urls.size());
        
        List<CrawlTarget> targets = new ArrayList<>();
        
        for (String url : urls) {
            if (!isValidCrawlUrl(url)) {
                continue;
            }
            
            // Deep Search는 높은 우선순위
            CrawlTarget target = createOrUpdateTarget(
                    url,
                    DiscoverySource.DEEP_SEARCH,
                    "deep_search:" + searchId,
                    75,
                    query
            );
            
            if (target != null) {
                targets.add(target);
            }
        }
        
        return targets;
    }

    // ========================================
    // AI 추천 URL 발견
    // ========================================

    /**
     * AI가 추천한 URL 발견
     */
    @Transactional
    public List<CrawlTarget> discoverFromAiRecommendation(String context, List<String> urls, String keywords) {
        log.info("Discovering from AI recommendation: {} URLs", urls.size());
        
        List<CrawlTarget> targets = new ArrayList<>();
        
        for (String url : urls) {
            if (!isValidCrawlUrl(url)) {
                continue;
            }
            
            CrawlTarget target = createOrUpdateTarget(
                    url,
                    DiscoverySource.AI_RECOMMENDATION,
                    "ai_context:" + context,
                    70,
                    keywords
            );
            
            if (target != null) {
                targets.add(target);
            }
        }
        
        return targets;
    }

    // ========================================
    // 수동 URL 추가
    // ========================================

    /**
     * 수동으로 URL 추가
     */
    @Transactional
    public CrawlTarget addManualTarget(String url, String keywords, int priority) {
        if (!isValidCrawlUrl(url)) {
            throw new IllegalArgumentException("Invalid URL: " + url);
        }
        
        return createOrUpdateTarget(
                url,
                DiscoverySource.MANUAL,
                "manual_add:" + LocalDateTime.now(),
                Math.min(100, Math.max(0, priority)),
                keywords
        );
    }

    /**
     * 수동으로 여러 URL 추가
     */
    @Transactional
    public List<CrawlTarget> addManualTargets(List<String> urls, String keywords, int priority) {
        return urls.stream()
                .filter(this::isValidCrawlUrl)
                .map(url -> createOrUpdateTarget(
                        url,
                        DiscoverySource.MANUAL,
                        "manual_add:" + LocalDateTime.now(),
                        Math.min(100, Math.max(0, priority)),
                        keywords))
                .filter(Objects::nonNull)
                .toList();
    }

    // ========================================
    // 내부 유틸리티 메서드
    // ========================================

    /**
     * HTML에서 URL 추출
     */
    private List<String> extractUrlsFromHtml(String htmlContent, String baseUrl) {
        if (htmlContent == null || htmlContent.isBlank()) {
            return Collections.emptyList();
        }
        
        Set<String> urls = new LinkedHashSet<>();
        
        try {
            Document doc = Jsoup.parse(htmlContent, baseUrl != null ? baseUrl : "");
            
            // <a> 태그에서 href 추출
            Elements links = doc.select("a[href]");
            for (Element link : links) {
                String href = link.absUrl("href");
                if (!href.isBlank()) {
                    urls.add(normalizeUrl(href));
                }
            }
            
            // 추가로 텍스트에서 URL 패턴 추출
            String text = doc.text();
            Pattern urlPattern = Pattern.compile("https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+");
            var matcher = urlPattern.matcher(text);
            while (matcher.find()) {
                String url = matcher.group();
                urls.add(normalizeUrl(url));
            }
            
        } catch (Exception e) {
            log.warn("Failed to parse HTML for URL extraction: {}", e.getMessage());
        }
        
        return new ArrayList<>(urls);
    }

    /**
     * URL 정규화
     */
    private String normalizeUrl(String url) {
        if (url == null) return null;
        
        // Fragment 제거 (#...)
        int fragmentIndex = url.indexOf('#');
        if (fragmentIndex > 0) {
            url = url.substring(0, fragmentIndex);
        }
        
        // 후행 슬래시 정규화
        if (url.endsWith("/")) {
            url = url.substring(0, url.length() - 1);
        }
        
        return url.trim();
    }

    /**
     * URL 해시 생성
     */
    private String computeUrlHash(String url) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(url.getBytes(StandardCharsets.UTF_8));
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    /**
     * 도메인 추출
     */
    private String extractDomain(String url) {
        try {
            URI uri = URI.create(url);
            return uri.getHost();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 같은 도메인인지 확인
     */
    private boolean isSameDomain(String url1, String url2) {
        String domain1 = extractDomain(url1);
        String domain2 = extractDomain(url2);
        return domain1 != null && domain1.equals(domain2);
    }

    /**
     * 유효한 크롤링 대상 URL인지 확인
     */
    private boolean isValidCrawlUrl(String url) {
        if (url == null || url.isBlank()) {
            return false;
        }
        
        // HTTP/HTTPS만 허용
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return false;
        }
        
        // 제외 패턴 체크
        if (EXCLUDED_URL_PATTERN.matcher(url).matches()) {
            return false;
        }
        
        return true;
    }

    /**
     * 콘텐츠 타입 추정
     */
    private ContentType inferContentType(String url) {
        for (var entry : DOMAIN_CONTENT_TYPE_MAP.entrySet()) {
            if (entry.getKey().matcher(url).matches()) {
                return entry.getValue();
            }
        }
        return ContentType.UNKNOWN;
    }

    /**
     * 검색 우선순위 계산
     */
    private int calculateSearchPriority(String url, String query) {
        int priority = 50; // 기본값
        
        // 뉴스 URL은 우선순위 상승
        if (NEWS_URL_PATTERN.matcher(url).matches()) {
            priority += 20;
        }
        
        // URL에 검색어가 포함되면 우선순위 상승
        String lowerUrl = url.toLowerCase();
        if (query != null && !query.isBlank()) {
            for (String keyword : query.toLowerCase().split("\\s+")) {
                if (keyword.length() >= 2 && lowerUrl.contains(keyword)) {
                    priority += 5;
                }
            }
        }
        
        return Math.min(100, priority);
    }

    /**
     * CrawlTarget 생성 또는 업데이트
     */
    private CrawlTarget createOrUpdateTarget(
            String url,
            DiscoverySource source,
            String context,
            int priority,
            String keywords) {
        
        String urlHash = computeUrlHash(url);
        
        Optional<CrawlTarget> existingOpt = crawlTargetRepository.findByUrlHash(urlHash);
        
        if (existingOpt.isPresent()) {
            CrawlTarget existing = existingOpt.get();
            
            // 이미 완료된 대상은 업데이트하지 않음
            if (existing.getStatus() == CrawlTargetStatus.COMPLETED) {
                return null;
            }
            
            // 우선순위가 더 높으면 업데이트
            if (priority > existing.getPriority()) {
                existing.setPriority(priority);
                
                // 키워드 병합
                if (keywords != null && !keywords.isBlank()) {
                    String existingKeywords = existing.getRelatedKeywords();
                    if (existingKeywords == null || existingKeywords.isBlank()) {
                        existing.setRelatedKeywords(keywords);
                    } else if (!existingKeywords.contains(keywords)) {
                        existing.setRelatedKeywords(existingKeywords + ", " + keywords);
                    }
                }
                
                return crawlTargetRepository.save(existing);
            }
            
            return null; // 변경 없음
        }
        
        // 새 대상 생성
        CrawlTarget target = CrawlTarget.builder()
                .url(url)
                .urlHash(urlHash)
                .discoverySource(source)
                .discoveryContext(context)
                .priority(priority)
                .status(CrawlTargetStatus.PENDING)
                .domain(extractDomain(url))
                .expectedContentType(inferContentType(url))
                .relatedKeywords(keywords)
                .build();
        
        return crawlTargetRepository.save(target);
    }

    // ========================================
    // 통계/조회 메서드
    // ========================================

    /**
     * 대기 중인 대상 수 조회
     */
    public long countPending() {
        return crawlTargetRepository.countByStatus(CrawlTargetStatus.PENDING);
    }

    /**
     * 발견 출처별 통계 조회
     */
    public Map<DiscoverySource, Long> getDiscoveryStats() {
        List<Object[]> stats = crawlTargetRepository.getDiscoveryStatsSince(
                LocalDateTime.now().minusDays(7));
        return stats.stream()
                .collect(Collectors.toMap(
                        row -> (DiscoverySource) row[0],
                        row -> (Long) row[1]
                ));
    }
}
