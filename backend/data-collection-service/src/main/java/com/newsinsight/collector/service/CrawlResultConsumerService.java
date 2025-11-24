package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.CrawlResultMessage;
import com.newsinsight.collector.entity.CollectedData;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
@Slf4j
public class CrawlResultConsumerService {

    private final CollectedDataService collectedDataService;

    @KafkaListener(
            topics = "${collector.crawl.topic.result:newsinsight.crawl.results}",
            groupId = "${spring.application.name}-crawl-result",
            containerFactory = "crawlResultKafkaListenerContainerFactory"
    )
    public void handleCrawlResult(CrawlResultMessage message) {
        log.info("Received crawl result jobId={} sourceId={} url={}",
                message.jobId(), message.sourceId(), message.url());

        LocalDateTime publishedDate = null;
        if (message.publishedAt() != null && !message.publishedAt().isBlank()) {
            try {
                publishedDate = LocalDateTime.parse(message.publishedAt());
            } catch (Exception e) {
                log.warn("Failed to parse publishedAt '{}' for url {}: {}",
                        message.publishedAt(), message.url(), e.getMessage());
            }
        }

        CollectedData data = CollectedData.builder()
                .sourceId(message.sourceId())
                .title(message.title())
                .content(message.content())
                .url(message.url())
                .publishedDate(publishedDate)
                .metadataJson(message.metadataJson())
                .processed(false)
                .hasContent(true)
                .duplicate(false)
                .normalized(true)
                .build();

        collectedDataService.save(data);
    }
}
