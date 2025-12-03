package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.SearchHistoryMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Service;

/**
 * Kafka consumer service for search history persistence.
 * Listens to search history topic and persists records to database.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SearchHistoryConsumerService {

    private final SearchHistoryService searchHistoryService;

    /**
     * Consume search history messages and persist to database.
     */
    @KafkaListener(
            topics = "newsinsight.search.history",
            containerFactory = "searchHistoryKafkaListenerContainerFactory",
            groupId = "${spring.application.name:collector-service}-search-history"
    )
    public void consumeSearchHistory(
            @Payload SearchHistoryMessage message,
            @Header(KafkaHeaders.RECEIVED_KEY) String key,
            @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
            @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
            @Header(KafkaHeaders.OFFSET) long offset,
            Acknowledgment acknowledgment
    ) {
        log.debug("Received search history message: key={}, topic={}, partition={}, offset={}",
                key, topic, partition, offset);

        try {
            // Persist to database
            searchHistoryService.saveFromMessage(message);
            
            // Acknowledge successful processing
            acknowledgment.acknowledge();
            
            log.debug("Successfully processed search history: externalId={}, type={}, query='{}'",
                    message.getExternalId(), message.getSearchType(), message.getQuery());
                    
        } catch (Exception e) {
            log.error("Failed to process search history message: key={}, error={}", 
                    key, e.getMessage(), e);
            // Don't acknowledge - message will be retried or sent to DLQ
            throw e;
        }
    }
}
