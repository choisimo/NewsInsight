package com.newsinsight.collector.service.factcheck;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.xml.XmlMapper;
import com.newsinsight.collector.config.TrustScoreConfig;
import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * PubMed/NCBI API를 통한 의학/생명과학 학술 논문 검색
 * 
 * PubMed는 미국 국립의학도서관(NLM)에서 제공하는 의생명과학 문헌 데이터베이스로,
 * 3,500만 건 이상의 논문을 무료로 검색할 수 있습니다.
 * 
 * API 문서: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 * 
 * 특징:
 * - 의학/건강 관련 주장 검증에 최적
 * - 피어리뷰된 고품질 논문
 * - API 키 없이 초당 3회 요청 가능
 * - API 키 있으면 초당 10회 가능
 */
@Component
@Slf4j
public class PubMedSource implements FactCheckSource {

    private final WebClient webClient;
    private final ObjectMapper objectMapper;
    private final XmlMapper xmlMapper;
    private final TrustScoreConfig trustScoreConfig;

    @Value("${collector.fact-check.pubmed.enabled:true}")
    private boolean enabled;

    @Value("${collector.fact-check.pubmed.api-key:}")
    private String apiKey;

    @Value("${collector.fact-check.timeout-seconds:15}")
    private int timeoutSeconds;

    private static final String ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
    private static final String EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
    private static final String ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

    public PubMedSource(WebClient webClient, ObjectMapper objectMapper, TrustScoreConfig trustScoreConfig) {
        this.webClient = webClient;
        this.objectMapper = objectMapper;
        this.xmlMapper = new XmlMapper();
        this.trustScoreConfig = trustScoreConfig;
    }

    @Override
    public String getSourceId() {
        return "pubmed";
    }

    @Override
    public String getSourceName() {
        return "PubMed (의학 논문)";
    }

    @Override
    public double getTrustScore() {
        try {
            return trustScoreConfig.getFactCheck().getCrossref(); // CrossRef과 동일한 수준
        } catch (Exception e) {
            return 0.90; // 의학 논문은 높은 신뢰도
        }
    }

    @Override
    public SourceType getSourceType() {
        return SourceType.ACADEMIC;
    }

    @Override
    public boolean isAvailable() {
        return enabled;
    }

    @Override
    public Flux<SourceEvidence> fetchEvidence(String topic, String language) {
        if (!enabled) {
            return Flux.empty();
        }

        return Flux.defer(() -> {
            try {
                // 1. 먼저 검색하여 PubMed ID 목록 가져오기
                List<String> pmids = searchPubMed(topic);
                if (pmids.isEmpty()) {
                    log.debug("No PubMed results found for topic: {}", topic);
                    return Flux.empty();
                }

                // 2. ID로 상세 정보 가져오기
                return Flux.fromIterable(fetchSummaries(pmids, topic));
            } catch (Exception e) {
                log.warn("PubMed API call failed for topic '{}': {}", topic, e.getMessage());
                return Flux.empty();
            }
        });
    }

    @Override
    public Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language) {
        // 의학 관련 키워드 추출 및 검색어 최적화
        String[] words = claim.split("[\\s,\\.!?]+");
        String searchQuery = String.join(" ", 
                java.util.Arrays.stream(words)
                        .filter(w -> w.length() > 3)
                        .filter(w -> !isCommonWord(w))
                        .limit(6)
                        .toList());
        
        if (searchQuery.isBlank()) {
            searchQuery = claim.length() > 60 ? claim.substring(0, 60) : claim;
        }
        
        return fetchEvidence(searchQuery, language);
    }

    private boolean isCommonWord(String word) {
        return List.of("that", "this", "with", "from", "have", "been", "were", "will",
                "about", "which", "their", "there", "would", "could", "should",
                "이것", "저것", "그것", "있는", "없는", "하는", "되는", "대한").contains(word.toLowerCase());
    }

    private List<String> searchPubMed(String query) {
        try {
            String encodedQuery = URLEncoder.encode(query, StandardCharsets.UTF_8);
            StringBuilder urlBuilder = new StringBuilder();
            urlBuilder.append(ESEARCH_URL)
                    .append("?db=pubmed")
                    .append("&term=").append(encodedQuery)
                    .append("&retmax=5")
                    .append("&retmode=json")
                    .append("&sort=relevance");
            
            if (apiKey != null && !apiKey.isBlank()) {
                urlBuilder.append("&api_key=").append(apiKey);
            }

            String response = webClient.get()
                    .uri(urlBuilder.toString())
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .block();

            if (response == null) return List.of();

            JsonNode root = objectMapper.readTree(response);
            JsonNode idList = root.path("esearchresult").path("idlist");

            List<String> pmids = new ArrayList<>();
            if (idList.isArray()) {
                for (JsonNode id : idList) {
                    pmids.add(id.asText());
                }
            }
            return pmids;
        } catch (Exception e) {
            log.warn("PubMed search failed: {}", e.getMessage());
            return List.of();
        }
    }

    private List<SourceEvidence> fetchSummaries(List<String> pmids, String query) {
        List<SourceEvidence> evidenceList = new ArrayList<>();
        
        if (pmids.isEmpty()) return evidenceList;

        try {
            String ids = String.join(",", pmids);
            StringBuilder urlBuilder = new StringBuilder();
            urlBuilder.append(ESUMMARY_URL)
                    .append("?db=pubmed")
                    .append("&id=").append(ids)
                    .append("&retmode=json");
            
            if (apiKey != null && !apiKey.isBlank()) {
                urlBuilder.append("&api_key=").append(apiKey);
            }

            String response = webClient.get()
                    .uri(urlBuilder.toString())
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(String.class)
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .block();

            if (response == null) return evidenceList;

            JsonNode root = objectMapper.readTree(response);
            JsonNode result = root.path("result");

            for (String pmid : pmids) {
                try {
                    JsonNode article = result.path(pmid);
                    if (article.isMissingNode()) continue;

                    String title = article.path("title").asText("");
                    if (title.isBlank()) continue;

                    String source = article.path("source").asText(""); // 저널명
                    String pubDate = article.path("pubdate").asText("");
                    
                    // 저자 추출
                    String authors = extractAuthors(article.path("authors"));

                    // 발췌문 구성
                    StringBuilder excerpt = new StringBuilder();
                    excerpt.append("📄 ").append(title).append("\n");
                    
                    if (!source.isBlank()) {
                        excerpt.append("📚 저널: ").append(source);
                        if (!pubDate.isBlank()) {
                            excerpt.append(" (").append(pubDate).append(")");
                        }
                        excerpt.append("\n");
                    }
                    
                    if (!authors.isBlank()) {
                        excerpt.append("저자: ").append(authors).append("\n");
                    }

                    // PubMed URL
                    String url = "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/";

                    // 관련성 점수 계산
                    double relevance = calculateRelevance(query, title, source);

                    evidenceList.add(SourceEvidence.builder()
                            .sourceType("academic")
                            .sourceName(getSourceName())
                            .url(url)
                            .excerpt(truncate(excerpt.toString(), 500))
                            .relevanceScore(relevance)
                            .stance("neutral")
                            .build());
                } catch (Exception e) {
                    log.debug("Failed to parse PubMed article {}: {}", pmid, e.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("Failed to fetch PubMed summaries: {}", e.getMessage());
        }

        return evidenceList;
    }

    private String extractAuthors(JsonNode authorsNode) {
        if (!authorsNode.isArray() || authorsNode.isEmpty()) {
            return "";
        }

        List<String> authorNames = new ArrayList<>();
        for (JsonNode author : authorsNode) {
            String name = author.path("name").asText("");
            if (!name.isBlank()) {
                authorNames.add(name);
                if (authorNames.size() >= 3) break;
            }
        }

        if (authorNames.isEmpty()) return "";
        if (authorNames.size() < 3) return String.join(", ", authorNames);
        return authorNames.get(0) + " 외 " + (authorsNode.size() - 1) + "명";
    }

    private double calculateRelevance(String query, String title, String source) {
        double score = 0.6; // PubMed 기본 점수 (피어리뷰 저널)

        String lowerQuery = query.toLowerCase();
        String lowerTitle = title.toLowerCase();

        String[] queryWords = lowerQuery.split("\\s+");
        int matches = 0;
        for (String word : queryWords) {
            if (word.length() > 2 && lowerTitle.contains(word)) {
                matches++;
            }
        }
        score += Math.min(0.3, matches * 0.1);

        // 유명 저널 보너스
        String lowerSource = source.toLowerCase();
        if (lowerSource.contains("nature") || lowerSource.contains("science") ||
            lowerSource.contains("lancet") || lowerSource.contains("nejm") ||
            lowerSource.contains("jama") || lowerSource.contains("bmj")) {
            score += 0.1;
        }

        return Math.min(1.0, Math.max(0.5, score));
    }

    private String truncate(String text, int maxLength) {
        if (text == null) return "";
        if (text.length() <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    }
}
