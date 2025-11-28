package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.CrawlCommandMessage;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.repository.CollectionJobRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * Kafka Consumer for crawl commands.
 * Validates job and source before delegating to CollectionService.
 * Failed messages will be retried and eventually sent to DLQ by KafkaConfig error handler.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class CrawlCommandConsumerService {

    private final CollectionService collectionService;
    private final DataSourceService dataSourceService;
    private final CollectionJobRepository collectionJobRepository;

    @KafkaListener(
            topics = "${collector.crawl.topic.command:newsinsight.crawl.commands}",
            groupId = "${spring.application.name}-crawl",
            containerFactory = "crawlCommandKafkaListenerContainerFactory"
    )
    @Transactional
    public void handleCrawlCommand(CrawlCommandMessage command) {
        log.info("Processing crawl command: jobId={}, sourceId={}, sourceType={}, url={}",
                command.jobId(), command.sourceId(), command.sourceType(), command.url());

        // Validate job exists
        Optional<CollectionJob> jobOpt = collectionJobRepository.findById(command.jobId());
        if (jobOpt.isEmpty()) {
            log.error("CollectionJob not found: jobId={}, sourceId={}. Message will be sent to DLQ.",
                    command.jobId(), command.sourceId());
            throw new IllegalStateException("CollectionJob not found: " + command.jobId());
        }

        CollectionJob job = jobOpt.get();

        // Validate source exists
        Optional<DataSource> sourceOpt = dataSourceService.findById(command.sourceId());
        if (sourceOpt.isEmpty()) {
            String errorMsg = "DataSource not found: sourceId=" + command.sourceId();
            log.error("DataSource not found: jobId={}, sourceId={}. Marking job as FAILED.",
                    command.jobId(), command.sourceId());
            markJobFailed(job, errorMsg);
            return; // Don't retry - source doesn't exist
        }

        DataSource source = sourceOpt.get();

        // Validate source is active
        if (!source.getIsActive()) {
            String errorMsg = "DataSource is not active: sourceId=" + command.sourceId();
            log.warn("DataSource is inactive: jobId={}, sourceId={}. Marking job as FAILED.",
                    command.jobId(), command.sourceId());
            markJobFailed(job, errorMsg);
            return; // Don't retry - intentionally disabled
        }

        // Execute collection - exceptions here will trigger retry + DLQ
        log.info("Starting collection execution: jobId={}, source={}, type={}",
                command.jobId(), source.getName(), source.getSourceType());
        
        collectionService.executeCollection(command.jobId(), source);
        
        log.info("Completed crawl command: jobId={}, sourceId={}",
                command.jobId(), command.sourceId());
    }

    private void markJobFailed(CollectionJob job, String errorMessage) {
        job.setStatus(JobStatus.FAILED);
        job.setCompletedAt(LocalDateTime.now());
        job.setErrorMessage(errorMessage);
        collectionJobRepository.save(job);
    }
}
