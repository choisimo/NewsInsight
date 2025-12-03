package com.newsinsight.collector.config;

import com.newsinsight.collector.dto.AiRequestMessage;
import com.newsinsight.collector.dto.AiResponseMessage;
import com.newsinsight.collector.dto.AiTaskRequestMessage;
import com.newsinsight.collector.dto.BrowserTaskMessage;
import com.newsinsight.collector.dto.CrawlCommandMessage;
import com.newsinsight.collector.dto.CrawlResultMessage;
import com.newsinsight.collector.dto.SearchHistoryMessage;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.*;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.ContainerProperties;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;
import org.springframework.kafka.support.serializer.JsonDeserializer;
import org.springframework.kafka.support.serializer.JsonSerializer;

import java.util.HashMap;
import java.util.Map;

/**
 * Kafka Configuration with Production-grade reliability features:
 * - Dead Letter Queue (DLQ) for failed messages
 * - Exponential backoff retry with max attempts
 * - Producer reliability settings (acks=all, retries, idempotence)
 * - Manual acknowledgment mode for consumer reliability
 * - Centralized configuration to reduce duplication
 */
@Configuration
@Slf4j
public class KafkaConfig {

    // ========== Configuration Properties ==========
    
    @Value("${spring.kafka.bootstrap-servers:localhost:9092}")
    private String bootstrapServers;

    @Value("${spring.application.name:collector-service}")
    private String applicationName;

    // Producer reliability settings
    @Value("${spring.kafka.producer.acks:all}")
    private String producerAcks;

    @Value("${spring.kafka.producer.retries:3}")
    private int producerRetries;

    @Value("${spring.kafka.producer.retry-backoff-ms:1000}")
    private int producerRetryBackoffMs;

    @Value("${spring.kafka.producer.delivery-timeout-ms:120000}")
    private int producerDeliveryTimeoutMs;

    @Value("${spring.kafka.producer.enable-idempotence:true}")
    private boolean producerIdempotence;

    // Consumer reliability settings
    @Value("${spring.kafka.consumer.max-retry-attempts:3}")
    private int consumerMaxRetryAttempts;

    @Value("${spring.kafka.consumer.retry-backoff-ms:1000}")
    private long consumerRetryBackoffMs;

    @Value("${spring.kafka.consumer.retry-max-backoff-ms:30000}")
    private long consumerRetryMaxBackoffMs;

    @Value("${spring.kafka.consumer.concurrency:1}")
    private int consumerConcurrency;

    // DLQ suffix
    private static final String DLQ_SUFFIX = ".dlq";

    // ========== Common Producer Configuration ==========

    private Map<String, Object> buildProducerProps() {
        Map<String, Object> props = new HashMap<>();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, JsonSerializer.class);
        
        // Reliability settings
        props.put(ProducerConfig.ACKS_CONFIG, producerAcks);
        props.put(ProducerConfig.RETRIES_CONFIG, producerRetries);
        props.put(ProducerConfig.RETRY_BACKOFF_MS_CONFIG, producerRetryBackoffMs);
        props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, producerDeliveryTimeoutMs);
        props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, producerIdempotence);
        
        // Batching for throughput (can be tuned)
        props.put(ProducerConfig.LINGER_MS_CONFIG, 5);
        props.put(ProducerConfig.BATCH_SIZE_CONFIG, 16384);
        
        return props;
    }

    // ========== Common Consumer Configuration ==========

    private Map<String, Object> buildConsumerProps(String groupIdSuffix) {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, applicationName + "-" + groupIdSuffix);
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, JsonDeserializer.class);
        props.put(JsonDeserializer.TRUSTED_PACKAGES, "com.newsinsight.collector.dto");
        
        // Reliability settings
        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false); // Manual ack
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 100);
        props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 300000); // 5 minutes
        
        return props;
    }

    // ========== DLQ Producer (Generic) ==========

    @Bean
    public ProducerFactory<String, Object> dlqProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, Object> dlqKafkaTemplate() {
        return new KafkaTemplate<>(dlqProducerFactory());
    }

    /**
     * Dead Letter Publishing Recoverer - sends failed messages to DLQ topic.
     * Topic naming convention: original-topic.dlq
     */
    @Bean
    public DeadLetterPublishingRecoverer deadLetterPublishingRecoverer() {
        return new DeadLetterPublishingRecoverer(dlqKafkaTemplate(),
                (ConsumerRecord<?, ?> record, Exception ex) -> {
                    String dlqTopic = record.topic() + DLQ_SUFFIX;
                    log.error("Sending to DLQ: topic={}, key={}, offset={}, error={}",
                            dlqTopic, record.key(), record.offset(), ex.getMessage());
                    return new TopicPartition(dlqTopic, record.partition());
                });
    }

    /**
     * Common Error Handler with exponential backoff and DLQ.
     */
    @Bean
    public CommonErrorHandler kafkaErrorHandler(DeadLetterPublishingRecoverer recoverer) {
        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(consumerMaxRetryAttempts);
        backOff.setInitialInterval(consumerRetryBackoffMs);
        backOff.setMaxInterval(consumerRetryMaxBackoffMs);
        backOff.setMultiplier(2.0);

        DefaultErrorHandler errorHandler = new DefaultErrorHandler(recoverer, backOff);
        
        // Log retries
        errorHandler.setRetryListeners((record, ex, attempt) -> {
            log.warn("Retry attempt {} for record: topic={}, key={}, offset={}, error={}",
                    attempt, record.topic(), record.key(), record.offset(), ex.getMessage());
        });
        
        return errorHandler;
    }

    // ========== AI Request Producer ==========

    @Bean
    public ProducerFactory<String, AiRequestMessage> aiRequestProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, AiRequestMessage> aiRequestKafkaTemplate() {
        KafkaTemplate<String, AiRequestMessage> template = new KafkaTemplate<>(aiRequestProducerFactory());
        template.setObservationEnabled(true); // Enable metrics
        return template;
    }

    // ========== Crawl Command Producer ==========

    @Bean
    public ProducerFactory<String, CrawlCommandMessage> crawlCommandProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, CrawlCommandMessage> crawlCommandKafkaTemplate() {
        KafkaTemplate<String, CrawlCommandMessage> template = new KafkaTemplate<>(crawlCommandProducerFactory());
        template.setObservationEnabled(true);
        return template;
    }

    // ========== Crawl Result Producer ==========

    @Bean
    public ProducerFactory<String, CrawlResultMessage> crawlResultProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, CrawlResultMessage> crawlResultKafkaTemplate() {
        KafkaTemplate<String, CrawlResultMessage> template = new KafkaTemplate<>(crawlResultProducerFactory());
        template.setObservationEnabled(true);
        return template;
    }

    // ========== AI Task Request Producer (for Orchestration) ==========

    @Bean
    public ProducerFactory<String, AiTaskRequestMessage> aiTaskRequestProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, AiTaskRequestMessage> aiTaskRequestKafkaTemplate() {
        KafkaTemplate<String, AiTaskRequestMessage> template = new KafkaTemplate<>(aiTaskRequestProducerFactory());
        template.setObservationEnabled(true);
        return template;
    }

    // ========== Browser Task Producer (for autonomous browser crawling) ==========

    @Bean
    public ProducerFactory<String, BrowserTaskMessage> browserTaskProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, BrowserTaskMessage> browserTaskKafkaTemplate() {
        KafkaTemplate<String, BrowserTaskMessage> template = new KafkaTemplate<>(browserTaskProducerFactory());
        template.setObservationEnabled(true);
        return template;
    }

    // ========== AI Response Consumer ==========

    @Bean
    public ConsumerFactory<String, AiResponseMessage> aiResponseConsumerFactory() {
        return new DefaultKafkaConsumerFactory<>(
                buildConsumerProps("ai"),
                new StringDeserializer(),
                new JsonDeserializer<>(AiResponseMessage.class)
        );
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, AiResponseMessage> aiResponseKafkaListenerContainerFactory(
            CommonErrorHandler kafkaErrorHandler) {
        ConcurrentKafkaListenerContainerFactory<String, AiResponseMessage> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(aiResponseConsumerFactory());
        factory.setConcurrency(consumerConcurrency);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.RECORD);
        factory.setCommonErrorHandler(kafkaErrorHandler);
        return factory;
    }

    // ========== Crawl Command Consumer ==========

    @Bean
    public ConsumerFactory<String, CrawlCommandMessage> crawlCommandConsumerFactory() {
        return new DefaultKafkaConsumerFactory<>(
                buildConsumerProps("crawl"),
                new StringDeserializer(),
                new JsonDeserializer<>(CrawlCommandMessage.class)
        );
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, CrawlCommandMessage> crawlCommandKafkaListenerContainerFactory(
            CommonErrorHandler kafkaErrorHandler) {
        ConcurrentKafkaListenerContainerFactory<String, CrawlCommandMessage> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(crawlCommandConsumerFactory());
        factory.setConcurrency(consumerConcurrency);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.RECORD);
        factory.setCommonErrorHandler(kafkaErrorHandler);
        return factory;
    }

    // ========== Crawl Result Consumer ==========

    @Bean
    public ConsumerFactory<String, CrawlResultMessage> crawlResultConsumerFactory() {
        return new DefaultKafkaConsumerFactory<>(
                buildConsumerProps("crawl-result"),
                new StringDeserializer(),
                new JsonDeserializer<>(CrawlResultMessage.class)
        );
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, CrawlResultMessage> crawlResultKafkaListenerContainerFactory(
            CommonErrorHandler kafkaErrorHandler) {
        ConcurrentKafkaListenerContainerFactory<String, CrawlResultMessage> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(crawlResultConsumerFactory());
        factory.setConcurrency(consumerConcurrency);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.RECORD);
        factory.setCommonErrorHandler(kafkaErrorHandler);
        return factory;
    }

    // ========== Search History Producer (for async persistence) ==========

    @Bean
    public ProducerFactory<String, SearchHistoryMessage> searchHistoryProducerFactory() {
        return new DefaultKafkaProducerFactory<>(buildProducerProps());
    }

    @Bean
    public KafkaTemplate<String, SearchHistoryMessage> searchHistoryKafkaTemplate() {
        KafkaTemplate<String, SearchHistoryMessage> template = new KafkaTemplate<>(searchHistoryProducerFactory());
        template.setObservationEnabled(true);
        return template;
    }

    // ========== Search History Consumer ==========

    @Bean
    public ConsumerFactory<String, SearchHistoryMessage> searchHistoryConsumerFactory() {
        return new DefaultKafkaConsumerFactory<>(
                buildConsumerProps("search-history"),
                new StringDeserializer(),
                new JsonDeserializer<>(SearchHistoryMessage.class)
        );
    }

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, SearchHistoryMessage> searchHistoryKafkaListenerContainerFactory(
            CommonErrorHandler kafkaErrorHandler) {
        ConcurrentKafkaListenerContainerFactory<String, SearchHistoryMessage> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(searchHistoryConsumerFactory());
        factory.setConcurrency(consumerConcurrency);
        factory.getContainerProperties().setAckMode(ContainerProperties.AckMode.RECORD);
        factory.setCommonErrorHandler(kafkaErrorHandler);
        return factory;
    }
}
