package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.CrawlResultMessage;
import com.newsinsight.collector.entity.CollectedData;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Kafka Consumer for crawl results.
 * Handles idempotency via content hash deduplication in CollectedDataService.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CrawlResultConsumerService {

    private final CollectedDataService collectedDataService;

    /**
     * Supported date formats for parsing publishedAt from various sources.
     * Order matters - more specific formats should come first.
     */
    private static final List<DateTimeFormatter> DATE_FORMATTERS = List.of(
            DateTimeFormatter.ISO_OFFSET_DATE_TIME,      // 2025-11-29T01:20:00+09:00
            DateTimeFormatter.ISO_ZONED_DATE_TIME,       // 2025-11-29T01:20:00+09:00[Asia/Seoul]
            DateTimeFormatter.ISO_LOCAL_DATE_TIME,       // 2025-11-29T01:20:00
            DateTimeFormatter.RFC_1123_DATE_TIME,        // Fri, 29 Nov 2025 01:20:00 GMT
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ssXXX"),
            DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm:ss"),
            DateTimeFormatter.ofPattern("dd-MM-yyyy HH:mm:ss"),
            DateTimeFormatter.ofPattern("MMM dd, yyyy HH:mm:ss")
    );

    @KafkaListener(
            topics = "${collector.crawl.topic.result:newsinsight.crawl.results}",
            groupId = "${spring.application.name}-crawl-result",
            containerFactory = "crawlResultKafkaListenerContainerFactory"
    )
    public void handleCrawlResult(CrawlResultMessage message) {
        log.info("Processing crawl result: jobId={}, sourceId={}, url={}",
                message.jobId(), message.sourceId(), message.url());

        // Pre-compute content hash for idempotency check
        String contentHash = collectedDataService.computeContentHash(
                message.url(), message.title(), message.content());

        // Early duplicate detection - skip processing if already exists
        if (collectedDataService.isDuplicate(contentHash)) {
            log.info("Duplicate detected, skipping: jobId={}, url={}, hash={}",
                    message.jobId(), message.url(), contentHash.substring(0, 8));
            return;
        }

        // Parse published date with multiple format support
        LocalDateTime publishedDate = parsePublishedDate(message.publishedAt(), message.url());

        // Validate content
        boolean hasContent = message.content() != null && !message.content().isBlank() 
                && message.content().length() >= 50;

        CollectedData data = CollectedData.builder()
                .sourceId(message.sourceId())
                .title(message.title())
                .content(message.content())
                .url(message.url())
                .publishedDate(publishedDate)
                .metadataJson(message.metadataJson())
                .contentHash(contentHash)
                .processed(false)
                .hasContent(hasContent)
                .duplicate(false)
                .normalized(false) // Will be set true after normalization pipeline
                .build();

        CollectedData saved = collectedDataService.save(data);
        
        log.info("Saved crawl result: id={}, jobId={}, sourceId={}, url={}, hasContent={}, duplicate={}",
                saved.getId(), message.jobId(), message.sourceId(), message.url(), 
                hasContent, saved.getDuplicate());
    }

    /**
     * Parse publishedAt string with multiple format support.
     * Returns null if parsing fails for all formats.
     */
    private LocalDateTime parsePublishedDate(String publishedAt, String url) {
        if (publishedAt == null || publishedAt.isBlank()) {
            return null;
        }

        String trimmed = publishedAt.trim();

        for (DateTimeFormatter formatter : DATE_FORMATTERS) {
            try {
                // Try parsing as OffsetDateTime first (has timezone)
                if (formatter == DateTimeFormatter.ISO_OFFSET_DATE_TIME ||
                    formatter == DateTimeFormatter.RFC_1123_DATE_TIME) {
                    OffsetDateTime odt = OffsetDateTime.parse(trimmed, formatter);
                    return odt.toLocalDateTime();
                }
                
                // Try parsing as ZonedDateTime
                if (formatter == DateTimeFormatter.ISO_ZONED_DATE_TIME) {
                    ZonedDateTime zdt = ZonedDateTime.parse(trimmed, formatter);
                    return zdt.toLocalDateTime();
                }

                // Try parsing as LocalDateTime
                return LocalDateTime.parse(trimmed, formatter);
            } catch (DateTimeParseException e) {
                // Try next formatter
            }
        }

        log.warn("Failed to parse publishedAt with any known format: value='{}', url={}",
                publishedAt, url);
        return null;
    }
}
