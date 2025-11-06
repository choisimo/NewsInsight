package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.CollectionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/v1/collections")
@RequiredArgsConstructor
public class CollectionController {

    private final CollectionService collectionService;
    private final EntityMapper entityMapper;

    /**
     * POST /api/v1/collections/start - Start collection for sources
     */
    @PostMapping("/start")
    public ResponseEntity<CollectionResponse> startCollection(
            @Valid @RequestBody CollectionRequest request) {
        
        List<CollectionJob> jobs;
        
        if (request.getSourceIds() == null || request.getSourceIds().isEmpty()) {
            // Collect from all active sources
            jobs = collectionService.startCollectionForAllActive();
        } else {
            // Collect from specified sources
            jobs = collectionService.startCollectionForSources(request.getSourceIds());
        }
        
        List<CollectionJobDTO> jobDTOs = jobs.stream()
                .map(entityMapper::toCollectionJobDTO)
                .toList();
        
        CollectionResponse response = CollectionResponse.builder()
                .message("Collection started for " + jobs.size() + " source(s)")
                .jobs(jobDTOs)
                .totalJobsStarted(jobs.size())
                .timestamp(LocalDateTime.now())
                .build();
        
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(response);
    }

    /**
     * GET /api/v1/collections/jobs - List all collection jobs
     */
    @GetMapping("/jobs")
    public ResponseEntity<Page<CollectionJobDTO>> listJobs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        
        Page<CollectionJob> jobs;
        if (status != null && !status.isBlank()) {
            jobs = collectionService.getJobsByStatus(status, pageable);
        } else {
            jobs = collectionService.getAllJobs(pageable);
        }
        
        Page<CollectionJobDTO> jobDTOs = jobs.map(entityMapper::toCollectionJobDTO);
        
        return ResponseEntity.ok(jobDTOs);
    }

    /**
     * GET /api/v1/collections/jobs/{id} - Get collection job by ID
     */
    @GetMapping("/jobs/{id}")
    public ResponseEntity<CollectionJobDTO> getJob(@PathVariable Long id) {
        return collectionService.getJobById(id)
                .map(entityMapper::toCollectionJobDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/collections/jobs/{id}/cancel - Cancel collection job
     */
    @PostMapping("/jobs/{id}/cancel")
    public ResponseEntity<Void> cancelJob(@PathVariable Long id) {
        boolean cancelled = collectionService.cancelJob(id);
        return cancelled ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * GET /api/v1/collections/stats - Get collection statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<CollectionStatsDTO> getStats() {
        CollectionStatsDTO stats = collectionService.getStatistics();
        return ResponseEntity.ok(stats);
    }

    /**
     * DELETE /api/v1/collections/jobs/cleanup - Cleanup old jobs
     */
    @DeleteMapping("/jobs/cleanup")
    public ResponseEntity<String> cleanupOldJobs(
            @RequestParam(defaultValue = "30") int daysOld) {
        
        int cleaned = collectionService.cleanupOldJobs(daysOld);
        return ResponseEntity.ok("Cleaned up " + cleaned + " old jobs");
    }
}
