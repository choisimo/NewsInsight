package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.AiResponseMessage;
import com.newsinsight.collector.mongo.AiResponseDocument;
import com.newsinsight.collector.mongo.AiResponseRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.time.Instant;

@Service
@RequiredArgsConstructor
@Slf4j
public class AiResultConsumerService {

    private final AiResponseRepository aiResponseRepository;

    @KafkaListener(
            topics = "${collector.ai.topic.response:newsinsight.ai.responses}",
            groupId = "${spring.application.name}-ai",
            containerFactory = "aiResponseKafkaListenerContainerFactory"
    )
    public void handleAiResponse(AiResponseMessage message) {
        log.info("Received AI response requestId={} status={} model={}",
                message.requestId(), message.status(), message.modelId());

        AiResponseDocument document = new AiResponseDocument(
                message.requestId(),
                message.status(),
                message.completedAt(),
                message.providerId(),
                message.modelId(),
                message.text(),
                message.raw(),
                Instant.now()
        );

        aiResponseRepository.save(document);
    }
}
