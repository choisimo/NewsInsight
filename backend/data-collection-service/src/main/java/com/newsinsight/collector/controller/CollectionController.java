package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.CollectionJobDTO;
import com.newsinsight.collector.dto.CollectionRequest;
import com.newsinsight.collector.dto.CollectionResponse;
import com.newsinsight.collector.dto.CollectionStatsDTO;
import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.CollectionService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/v1/collections")
public class CollectionController {

    private final CollectionService collectionService;
    private final EntityMapper entityMapper;

    public CollectionController(CollectionService collectionService, EntityMapper entityMapper) {
        this.collectionService = collectionService;
        this.entityMapper = entityMapper;
    }

    /**
     * POST /api/v1/collections/start - 수집 작업 시작 (전체 또는 특정 소스)
     */
    @PostMapping("/start")
    public ResponseEntity<CollectionResponse> startCollection(
            @Valid @RequestBody CollectionRequest request) {

        List<CollectionJob> jobs;

        if (request.sourceIds().isEmpty()) {
            // 활성화된 모든 소스 대상으로 수집
            jobs = collectionService.startCollectionForAllActive();
        } else {
            // 지정된 소스들만 수집
            jobs = collectionService.startCollectionForSources(request.sourceIds());
        }

        List<CollectionJobDTO> jobDTOs = jobs.stream()
                .map(entityMapper::toCollectionJobDTO)
                .toList();

        CollectionResponse response = new CollectionResponse(
                "Collection started for " + jobs.size() + " source(s)",
                jobDTOs,
                jobs.size(),
                LocalDateTime.now()
        );

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
    }

    /**
     * GET /api/v1/collections/jobs - 수집 작업 목록 조회 (상태별 필터링)
     */
    @GetMapping("/jobs")
    public ResponseEntity<PageResponse<CollectionJobDTO>> listJobs(
            Pageable pageable,
            @RequestParam(required = false) JobStatus status) {

        Page<CollectionJob> jobs = (status != null)
                ? collectionService.getJobsByStatus(status, pageable)
                : collectionService.getAllJobs(pageable);

        Page<CollectionJobDTO> jobDTOs = jobs.map(entityMapper::toCollectionJobDTO);

        return ResponseEntity.ok(PageResponse.from(jobDTOs));
    }

    /**
     * GET /api/v1/collections/jobs/{id} - 특정 작업 상세 조회
     */
    @GetMapping("/jobs/{id}")
    public ResponseEntity<CollectionJobDTO> getJob(@PathVariable Long id) {
        return collectionService.getJobById(id)
                .map(entityMapper::toCollectionJobDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/collections/jobs/{id}/cancel - 수집 작업 취소
     */
    @PostMapping("/jobs/{id}/cancel")
    public ResponseEntity<Void> cancelJob(@PathVariable Long id) {
        boolean cancelled = collectionService.cancelJob(id);
        return cancelled ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * GET /api/v1/collections/stats - 수집 통계 조회
     */
    @GetMapping("/stats")
    public ResponseEntity<CollectionStatsDTO> getStats() {
        CollectionStatsDTO stats = collectionService.getStatistics();
        return ResponseEntity.ok(stats);
    }

    /**
     * DELETE /api/v1/collections/jobs/cleanup - 오래된 작업 정리
     */
    @DeleteMapping("/jobs/cleanup")
    public ResponseEntity<String> cleanupOldJobs(
            @RequestParam(defaultValue = "30") int daysOld) {
        
        int cleaned = collectionService.cleanupOldJobs(daysOld);
        return ResponseEntity.ok("Cleaned up " + cleaned + " old jobs");
    }
}
