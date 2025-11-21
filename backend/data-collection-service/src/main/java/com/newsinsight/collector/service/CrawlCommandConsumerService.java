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

import java.time.LocalDateTime;
import java.util.Optional;

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
    public void handleCrawlCommand(CrawlCommandMessage command) {
        log.info("Received crawl command jobId={} sourceId={}", command.jobId(), command.sourceId());

        Optional<CollectionJob> jobOpt = collectionJobRepository.findById(command.jobId());
        if (jobOpt.isEmpty()) {
            log.warn("Collection job not found for crawl command: jobId={}", command.jobId());
            return;
        }

        Optional<DataSource> sourceOpt = dataSourceService.findById(command.sourceId());
        if (sourceOpt.isEmpty()) {
            log.error("Data source not found for crawl command: jobId={} sourceId={}", command.jobId(), command.sourceId());
            CollectionJob job = jobOpt.get();
            job.setStatus(JobStatus.FAILED);
            job.setCompletedAt(LocalDateTime.now());
            job.setErrorMessage("Data source not found for sourceId=" + command.sourceId());
            collectionJobRepository.save(job);
            return;
        }

        DataSource source = sourceOpt.get();

        if (!source.getIsActive()) {
            log.warn("Data source is not active for crawl command: jobId={} sourceId={}", command.jobId(), command.sourceId());
            CollectionJob job = jobOpt.get();
            job.setStatus(JobStatus.FAILED);
            job.setCompletedAt(LocalDateTime.now());
            job.setErrorMessage("Data source is not active for sourceId=" + command.sourceId());
            collectionJobRepository.save(job);
            return;
        }

        collectionService.executeCollection(command.jobId(), source);
    }
}
