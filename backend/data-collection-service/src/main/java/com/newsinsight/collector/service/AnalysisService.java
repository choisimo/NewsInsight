package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.AnalysisResponseDto;
import com.newsinsight.collector.dto.ArticleDto;
import com.newsinsight.collector.dto.ArticlesResponseDto;
import com.newsinsight.collector.dto.KeywordDataDto;
import com.newsinsight.collector.dto.SentimentDataDto;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.repository.CollectedDataRepository;
import com.newsinsight.collector.repository.DataSourceRepository;
import lombok.RequiredArgsConstructor;
import org.jsoup.Jsoup;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AnalysisService {

    private static final int MAX_KEYWORD_DOCS = 200;
    private static final int SNIPPET_MAX_LENGTH = 200;

    private static final Set<String> STOP_WORDS = Set.of(
            "the", "and", "or", "a", "an", "of", "to", "in", "on", "for", "with",
            "이", "그", "저", "에서", "으로", "에게", "하다", "되다"
    );

    private final CollectedDataRepository collectedDataRepository;
    private final DataSourceRepository dataSourceRepository;
    private final AiMessagingService aiMessagingService;

    public AnalysisResponseDto analyze(String query, String window) {
        LocalDateTime now = LocalDateTime.now();
        String effectiveWindow = window;
        LocalDateTime since;
        switch (window) {
            case "1d" -> since = now.minusDays(1);
            case "30d" -> since = now.minusDays(30);
            case "7d" -> since = now.minusDays(7);
            default -> {
                since = now.minusDays(7);
                effectiveWindow = "7d";
            }
        }

        String normalizedQuery = (query != null && !query.isBlank()) ? query : null;
        String message = normalizedQuery != null ? normalizedQuery : "";
        aiMessagingService.sendAnalysisRequest(normalizedQuery, window, message, Map.of());
        Page<CollectedData> page = collectedDataRepository.searchByQueryAndSince(normalizedQuery, since, Pageable.unpaged());
        long articleCount = page.getTotalElements();

        List<CollectedData> documents = page.getContent();

        double pos = 0.0;
        double neg = 0.0;
        double neu = 0.0;

        for (CollectedData data : documents) {
            Double quality = data.getQualityScore();
            if (quality == null) {
                neu += 1.0;
            } else if (quality >= 0.66) {
                pos += 1.0;
            } else if (quality <= 0.33) {
                neg += 1.0;
            } else {
                neu += 1.0;
            }
        }

        if (pos == 0.0 && neg == 0.0 && neu == 0.0) {
            neu = 1.0;
        }

        SentimentDataDto sentiments = new SentimentDataDto(pos, neg, neu);
        List<KeywordDataDto> topKeywords = extractTopKeywords(documents, query);

        String analyzedAt = OffsetDateTime.now().toString();

        return new AnalysisResponseDto(query, effectiveWindow, articleCount, sentiments, topKeywords, analyzedAt);
    }

    public ArticlesResponseDto searchArticles(String query, int limit) {
        int pageSize = limit > 0 ? limit : 50;
        PageRequest pageRequest = PageRequest.of(0, pageSize,
                Sort.by(Sort.Direction.DESC, "publishedDate")
                        .and(Sort.by(Sort.Direction.DESC, "collectedAt")));
        String normalizedQuery = (query != null && !query.isBlank()) ? query : null;
        Page<CollectedData> page = collectedDataRepository.searchByQuery(normalizedQuery, pageRequest);

        List<ArticleDto> articles = page.getContent().stream()
                .map(this::toArticleDto)
                .toList();

        return new ArticlesResponseDto(query, articles, page.getTotalElements());
    }

    private ArticleDto toArticleDto(CollectedData data) {
        String id = data.getId() != null ? data.getId().toString() : null;
        String title = data.getTitle();
        DataSource source = data.getSourceId() != null
                ? dataSourceRepository.findById(data.getSourceId()).orElse(null)
                : null;
        String sourceName = source != null ? source.getName() : "Unknown";

        String publishedAt;
        if (data.getPublishedDate() != null) {
            publishedAt = data.getPublishedDate().toString();
        } else if (data.getCollectedAt() != null) {
            publishedAt = data.getCollectedAt().toString();
        } else {
            publishedAt = null;
        }

        String url = data.getUrl();
        // 원본 콘텐츠를 보존하면서 정제된 텍스트 생성
        String rawContent = data.getContent();
        String cleanedContent = cleanContent(rawContent);
        String snippet = buildSnippetFromCleanText(cleanedContent);

        return new ArticleDto(id, title, sourceName, publishedAt, url, snippet, cleanedContent);
    }

    private List<KeywordDataDto> extractTopKeywords(List<CollectedData> documents, String query) {
        if (documents == null || documents.isEmpty()) {
            return List.of();
        }

        Map<String, Integer> freq = new HashMap<>();
        int docCount = 0;

        for (CollectedData data : documents) {
            if (docCount >= MAX_KEYWORD_DOCS) {
                break;
            }
            docCount++;

            StringBuilder sb = new StringBuilder();
            if (data.getTitle() != null) {
                sb.append(data.getTitle()).append(' ');
            }
            if (data.getContent() != null) {
                sb.append(data.getContent());
            }

            String text;
            try {
                text = Jsoup.parse(sb.toString()).text();
            } catch (Exception e) {
                text = sb.toString();
            }

            text = text.toLowerCase(Locale.ROOT);
            String[] tokens = text.split("[^\\p{L}0-9]+");
            for (String token : tokens) {
                if (token == null || token.isBlank()) continue;
                if (token.length() <= 1) continue;
                if (STOP_WORDS.contains(token)) continue;
                if (query != null && token.equalsIgnoreCase(query)) continue;

                // @CHECK 
                // token이 null이 될 수 있음 
                freq.merge(token, 1, Integer::sum);
            }
        }

        if (freq.isEmpty()) {
            return query == null || query.isBlank()
                    ? List.of()
                    : List.of(new KeywordDataDto(query, 1.0));
        }

        return freq.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(10)
                .map(e -> new KeywordDataDto(e.getKey(), e.getValue()))
                .toList();
    }

    /**
     * 이미 정제된 텍스트에서 snippet 생성 (HTML 파싱 불필요)
     */
    private String buildSnippetFromCleanText(String cleanText) {
        if (cleanText == null || cleanText.isBlank()) {
            return null;
        }

        if (cleanText.length() <= SNIPPET_MAX_LENGTH) {
            return cleanText;
        }

        // 단어 경계에서 자르기
        int cut = SNIPPET_MAX_LENGTH;
        for (int i = Math.min(SNIPPET_MAX_LENGTH - 1, cleanText.length() - 1); 
             i > SNIPPET_MAX_LENGTH * 0.6 && i >= 0; i--) {
            if (Character.isWhitespace(cleanText.charAt(i))) {
                cut = i;
                break;
            }
        }

        return cleanText.substring(0, cut).trim() + "...";
    }

    /**
     * 레거시 호환성을 위한 buildSnippet (HTML 파싱 포함)
     */
    private String buildSnippet(String content) {
        if (content == null || content.isBlank()) {
            return null;
        }

        String text;
        try {
            text = Jsoup.parse(content).text();
        } catch (Exception e) {
            text = content;
        }

        text = text.replaceAll("\\s+", " ").trim();
        if (text.isEmpty()) {
            return null;
        }

        if (text.length() <= SNIPPET_MAX_LENGTH) {
            return text;
        }

        int startIdx = Math.min(SNIPPET_MAX_LENGTH - 1, text.length() - 1);
        int cut = SNIPPET_MAX_LENGTH;
        for (int i = startIdx; i > SNIPPET_MAX_LENGTH * 0.6 && i >= 0; i--) {
            if (Character.isWhitespace(text.charAt(i))) {
                cut = i;
                break;
            }
        }

        return text.substring(0, cut).trim() + "...";
    }

    /**
     * HTML 태그를 제거하고 정리된 전체 텍스트를 반환합니다.
     * snippet과 달리 길이 제한 없이 전체 내용을 반환합니다.
     * 
     * 중요: 이 메서드는 원본 텍스트 내용을 최대한 보존하며,
     * HTML 태그만 제거하고 실제 텍스트 데이터는 변경하지 않습니다.
     *
     * @param content 원본 콘텐츠 (HTML 포함 가능)
     * @return 정리된 전체 텍스트 (원본 데이터 보존)
     */
    private String cleanContent(String content) {
        if (content == null || content.isBlank()) {
            return null;
        }

        String text;
        try {
            // Jsoup을 사용하여 HTML 태그만 제거, 텍스트 내용은 보존
            text = Jsoup.parse(content).text();
        } catch (Exception e) {
            // HTML 파싱 실패 시 원본 그대로 사용
            text = content;
        }

        // 연속 공백만 정리 (실제 텍스트 내용은 변경하지 않음)
        text = text.replaceAll("\\s+", " ").trim();
        
        return text.isEmpty() ? null : text;
    }
}
