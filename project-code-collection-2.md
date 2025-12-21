# Project Code Snapshot

Generated at 2025-12-21T18:10:03.167Z

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/SourceController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.DataSourceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sources")
@RequiredArgsConstructor
public class SourceController {

    private final DataSourceService dataSourceService;
    private final EntityMapper entityMapper;

    /**
     * GET /api/v1/sources - 모든 데이터 소스 목록 조회 (페이징/정렬 지원)
     */
    @GetMapping
    public ResponseEntity<Page<DataSourceDTO>> listSources(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "id") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection) {
        
        Sort.Direction direction = Sort.Direction.fromString(sortDirection);
        Pageable pageable = PageRequest.of(page, size, Sort.by(direction, sortBy));
        
        Page<DataSource> sources = dataSourceService.findAll(pageable);
        Page<DataSourceDTO> sourceDTOs = sources.map(entityMapper::toDataSourceDTO);
        
        return ResponseEntity.ok(sourceDTOs);
    }

    /**
     * GET /api/v1/sources/active - 활성 데이터 소스 목록 조회
     */
    @GetMapping("/active")
    public ResponseEntity<Page<DataSourceDTO>> listActiveSources(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
        Page<DataSource> sources = dataSourceService.findAllActive(pageable);
        Page<DataSourceDTO> sourceDTOs = sources.map(entityMapper::toDataSourceDTO);
        
        return ResponseEntity.ok(sourceDTOs);
    }

    /**
     * GET /api/v1/sources/{id} - ID로 데이터 소스 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<DataSourceDTO> getSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(entityMapper::toDataSourceDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources - 새로운 데이터 소스 등록
     */
    @PostMapping
    public ResponseEntity<DataSourceDTO> createSource(@Valid @RequestBody DataSourceCreateRequest request) {
        DataSource source = entityMapper.toDataSource(request);
        DataSource savedSource = dataSourceService.create(source);
        DataSourceDTO dto = entityMapper.toDataSourceDTO(savedSource);
        
        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
    }

    /**
     * PUT /api/v1/sources/{id} - 데이터 소스 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<DataSourceDTO> updateSource(
            @PathVariable Long id,
            @Valid @RequestBody DataSourceUpdateRequest request) {
        
        return dataSourceService.findById(id)
                .map(existingSource -> {
                    entityMapper.updateDataSourceFromRequest(request, existingSource);
                    DataSource updated = dataSourceService.save(existingSource);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * DELETE /api/v1/sources/{id} - 데이터 소스 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSource(@PathVariable Long id) {
        boolean deleted = dataSourceService.delete(id);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * POST /api/v1/sources/{id}/activate - 데이터 소스 활성화
     */
    @PostMapping("/{id}/activate")
    public ResponseEntity<DataSourceDTO> activateSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(source -> {
                    source.setIsActive(true);
                    DataSource updated = dataSourceService.save(source);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources/{id}/deactivate - 데이터 소스 비활성화
     */
    @PostMapping("/{id}/deactivate")
    public ResponseEntity<DataSourceDTO> deactivateSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(source -> {
                    source.setIsActive(false);
                    DataSource updated = dataSourceService.save(source);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/UnifiedSearchController.java

```java
package com.newsinsight.collector.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.service.AnalysisEventService;
import com.newsinsight.collector.service.FactVerificationService;
import com.newsinsight.collector.service.UnifiedSearchEventService;
import com.newsinsight.collector.service.UnifiedSearchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 통합 검색 컨트롤러
 * 
 * 병렬 검색 및 심층 분석 기능을 SSE 스트리밍으로 제공합니다.
 * 특정 기술/API 이름을 노출하지 않고 통합된 경험을 제공합니다.
 */
@RestController
@RequestMapping("/api/v1/search")
@RequiredArgsConstructor
@Slf4j
public class UnifiedSearchController {

    private final UnifiedSearchService unifiedSearchService;
    private final UnifiedSearchEventService unifiedSearchEventService;
    private final FactVerificationService factVerificationService;
    private final AnalysisEventService analysisEventService;
    private final ObjectMapper objectMapper;

    /**
     * 통합 병렬 검색 (SSE 스트리밍)
     * 
     * DB, 웹, AI 검색을 병렬로 실행하고 결과가 나오는 대로 스트리밍합니다.
     * 
     * @param query 검색어
     * @param window 시간 범위 (1d, 7d, 30d)
     * @return SSE 이벤트 스트림
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamSearch(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        log.info("Starting streaming search for query: '{}', window: {}", query, window);

        // 즉시 연결 확인 이벤트 전송 (클라이언트가 연결 성공을 확인할 수 있도록)
        Flux<ServerSentEvent<String>> initialEvent = Flux.just(
                ServerSentEvent.<String>builder()
                        .id("init")
                        .event("connected")
                        .data("{\"message\": \"검색 시스템에 연결되었습니다. 병렬 검색을 시작합니다...\", \"query\": \"" + query + "\"}")
                        .build()
        );

        Flux<ServerSentEvent<String>> searchEvents = unifiedSearchService.searchParallel(query, window)
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(java.util.UUID.randomUUID().toString())
                                .event(event.getEventType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize search event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                });

        Flux<ServerSentEvent<String>> doneEvent = Flux.just(
                ServerSentEvent.<String>builder()
                        .event("done")
                        .data("{\"message\": \"Search completed\"}")
                        .build()
        );

        return Flux.concat(initialEvent, searchEvents, doneEvent)
                .doOnError(e -> log.error("Stream search error: {}", e.getMessage()))
                .timeout(Duration.ofMinutes(2))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"" + e.getMessage() + "\"}")
                                .build()
                ));
    }

    /**
     * 심층 분석 및 팩트 검증 (SSE 스트리밍)
     * 
     * 주어진 주제에 대해 Wikipedia 등 신뢰할 수 있는 출처와 대조하여
     * 타당성을 검증하고 심층 분석을 수행합니다.
     * 
     * @param request 분석 요청 (topic, claims)
     * @return SSE 이벤트 스트림
     */
    @PostMapping(value = "/deep/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> streamDeepAnalysis(
            @RequestBody DeepAnalysisRequest request
    ) {
        log.info("Starting deep analysis for topic: '{}'", request.getTopic());

        return factVerificationService.analyzeAndVerify(request.getTopic(), request.getClaims())
                .map(event -> {
                    try {
                        String data = objectMapper.writeValueAsString(event);
                        return ServerSentEvent.<String>builder()
                                .id(java.util.UUID.randomUUID().toString())
                                .event(event.getEventType())
                                .data(data)
                                .build();
                    } catch (Exception e) {
                        log.error("Failed to serialize deep analysis event: {}", e.getMessage());
                        return ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"Serialization failed\"}")
                                .build();
                    }
                })
                .concatWith(Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("done")
                                .data("{\"message\": \"Analysis completed\"}")
                                .build()
                ))
                .timeout(Duration.ofMinutes(3))
                .onErrorResume(e -> Flux.just(
                        ServerSentEvent.<String>builder()
                                .event("error")
                                .data("{\"error\": \"" + e.getMessage() + "\"}")
                                .build()
                ));
    }

    // ============================================
    // Job-based Search API (supports SSE reconnection)
    // ============================================

    /**
     * Start a new search job.
     * Returns immediately with jobId. Results are streamed via SSE.
     * 
     * @param request Search request with query and window
     * @return 202 Accepted with job details
     */
    @PostMapping("/jobs")
    public ResponseEntity<Map<String, Object>> startSearchJob(@RequestBody SearchJobRequest request) {
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }

        String jobId = UUID.randomUUID().toString();
        String window = request.getWindow() != null ? request.getWindow() : "7d";
        List<String> priorityUrls = request.getPriorityUrls();
        String startDate = request.getStartDate();
        String endDate = request.getEndDate();
        
        log.info("Starting search job: {} for query: '{}', window: {}, priorityUrls: {}, startDate: {}, endDate: {}", 
                jobId, request.getQuery(), window, 
                priorityUrls != null ? priorityUrls.size() : 0,
                startDate, endDate);

        // Create job in event service
        var metadata = unifiedSearchEventService.createJob(jobId, request.getQuery(), window);
        
        // Start async search execution with priorityUrls and custom date range
        unifiedSearchService.executeSearchAsync(jobId, request.getQuery(), window, priorityUrls, startDate, endDate);

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "jobId", jobId,
                "query", request.getQuery(),
                "window", window,
                "status", metadata.status(),
                "createdAt", metadata.createdAt(),
                "streamUrl", "/api/v1/search/jobs/" + jobId + "/stream"
        ));
    }

    /**
     * Get job status.
     * 
     * @param jobId The job ID
     * @return Job status
     */
    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<Map<String, Object>> getJobStatus(@PathVariable String jobId) {
        var metadata = unifiedSearchEventService.getJobMetadata(jobId);
        
        if (metadata == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(Map.of(
                "jobId", metadata.jobId(),
                "query", metadata.query(),
                "window", metadata.window(),
                "status", metadata.status(),
                "createdAt", metadata.createdAt(),
                "completedAt", metadata.completedAt() != null ? metadata.completedAt() : ""
        ));
    }

    /**
     * Stream search job results via SSE.
     * Supports reconnection - client can reconnect with same jobId.
     * 
     * @param jobId The job ID
     * @return SSE event stream
     */
    @GetMapping(value = "/jobs/{jobId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamJobResults(@PathVariable String jobId) {
        log.info("SSE connection request for search job: {}", jobId);

        if (!unifiedSearchEventService.hasJob(jobId)) {
            return Flux.just(ServerSentEvent.builder()
                    .event("error")
                    .data(Map.of("error", "Job not found: " + jobId))
                    .build());
        }

        return unifiedSearchEventService.getJobEventStream(jobId)
                .timeout(Duration.ofMinutes(5))
                .onErrorResume(e -> {
                    log.error("SSE stream error for job: {}", jobId, e);
                    return Flux.just(ServerSentEvent.builder()
                            .event("error")
                            .data(Map.of("error", e.getMessage()))
                            .build());
                });
    }

    /**
     * 검색 서비스 상태 확인
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "parallelSearch", true,
                        "deepAnalysis", true,
                        "factVerification", true,
                        "analysisStreaming", true
                ),
                "description", "통합 검색 및 심층 분석 서비스"
        ));
    }

    /**
     * 분석 결과 실시간 업데이트 스트림 (SSE)
     * 
     * 특정 기사 ID들의 분석 완료 이벤트를 실시간으로 구독합니다.
     * 검색 결과 페이지에서 분석 중인 기사들의 상태를 실시간으로 업데이트할 때 사용합니다.
     * 
     * @param articleIds 구독할 기사 ID 목록 (comma-separated)
     * @return SSE 이벤트 스트림
     */
    @GetMapping(value = "/analysis/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> streamAnalysisUpdates(
            @RequestParam(required = false) String articleIds
    ) {
        Set<Long> ids = new HashSet<>();
        if (articleIds != null && !articleIds.isBlank()) {
            try {
                for (String idStr : articleIds.split(",")) {
                    ids.add(Long.parseLong(idStr.trim()));
                }
            } catch (NumberFormatException e) {
                log.warn("Invalid article IDs format: {}", articleIds);
            }
        }

        log.info("Starting analysis stream for {} article IDs", ids.size());

        return analysisEventService.subscribeToAnalysisUpdates(ids)
                .timeout(Duration.ofMinutes(30))
                .onErrorResume(e -> {
                    log.error("Analysis stream error: {}", e.getMessage());
                    return Flux.just(
                            ServerSentEvent.builder()
                                    .event("error")
                                    .data(Map.of("error", e.getMessage()))
                                    .build()
                    );
                });
    }

    /**
     * 분석 구독 기사 추가
     * 
     * @param articleIds 추가할 기사 ID 목록
     */
    @PostMapping("/analysis/watch")
    public ResponseEntity<Map<String, Object>> watchArticles(@RequestBody List<Long> articleIds) {
        if (articleIds != null && !articleIds.isEmpty()) {
            analysisEventService.watchArticles(new HashSet<>(articleIds));
        }
        return ResponseEntity.ok(Map.of(
                "message", "Articles added to watch list",
                "watchedCount", analysisEventService.getWatchedCount()
        ));
    }

    /**
     * 분석 스트리밍 상태 확인
     */
    @GetMapping("/analysis/stream/status")
    public ResponseEntity<Map<String, Object>> analysisStreamStatus() {
        return ResponseEntity.ok(Map.of(
                "subscriberCount", analysisEventService.getSubscriberCount(),
                "watchedArticleCount", analysisEventService.getWatchedCount()
        ));
    }

    // ============================================
    // Request DTOs
    // ============================================

    public static class DeepAnalysisRequest {
        private String topic;
        private List<String> claims;

        public String getTopic() {
            return topic;
        }

        public void setTopic(String topic) {
            this.topic = topic;
        }

        public List<String> getClaims() {
            return claims;
        }

        public void setClaims(List<String> claims) {
            this.claims = claims;
        }
    }

    public static class SearchJobRequest {
        private String query;
        private String window;
        private List<String> priorityUrls;
        private String startDate;  // ISO 8601 format (e.g., "2024-01-01T00:00:00")
        private String endDate;    // ISO 8601 format (e.g., "2024-01-31T23:59:59")

        public String getQuery() {
            return query;
        }

        public void setQuery(String query) {
            this.query = query;
        }

        public String getWindow() {
            return window;
        }

        public void setWindow(String window) {
            this.window = window;
        }

        public List<String> getPriorityUrls() {
            return priorityUrls;
        }

        public void setPriorityUrls(List<String> priorityUrls) {
            this.priorityUrls = priorityUrls;
        }

        public String getStartDate() {
            return startDate;
        }

        public void setStartDate(String startDate) {
            this.startDate = startDate;
        }

        public String getEndDate() {
            return endDate;
        }

        public void setEndDate(String endDate) {
            this.endDate = endDate;
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/controller/WorkspaceController.java

```java
package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.workspace.WorkspaceFile;
import com.newsinsight.collector.service.WorkspaceFileService;
import com.newsinsight.collector.service.WorkspaceFileService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * REST Controller for Workspace File API.
 * Provides endpoints for file upload, download, listing, and deletion.
 */
@RestController
@RequestMapping("/api/v1/workspace/files")
@RequiredArgsConstructor
@Slf4j
public class WorkspaceController {

    private final WorkspaceFileService fileService;

    // ============================================
    // File Upload
    // ============================================

    /**
     * Upload a file.
     * Supports both session-based (anonymous) and user-based uploads.
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<WorkspaceFile> uploadFile(
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId,
            @RequestParam(value = "description", required = false) String description
    ) {
        log.info("File upload request: name='{}', size={}, sessionId={}, userId={}",
                file.getOriginalFilename(), file.getSize(), sessionId, userId);

        if (sessionId == null && userId == null) {
            log.warn("Neither sessionId nor userId provided for file upload");
            return ResponseEntity.badRequest().build();
        }

        try {
            UploadRequest request = UploadRequest.builder()
                    .projectId(projectId)
                    .description(description)
                    .build();

            WorkspaceFile uploaded;
            if (userId != null) {
                uploaded = fileService.uploadFileForUser(file, userId, request);
            } else {
                uploaded = fileService.uploadFile(file, sessionId, request);
            }

            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);

        } catch (IllegalArgumentException e) {
            log.warn("Invalid upload request: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (IllegalStateException e) {
            log.warn("Upload denied: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        } catch (Exception e) {
            log.error("File upload failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Upload multiple files.
     */
    @PostMapping(value = "/batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<WorkspaceFile>> uploadFiles(
            @RequestParam("files") MultipartFile[] files,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId
    ) {
        log.info("Batch upload request: {} files, sessionId={}, userId={}", files.length, sessionId, userId);

        if (sessionId == null && userId == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            UploadRequest request = UploadRequest.builder()
                    .projectId(projectId)
                    .build();

            List<WorkspaceFile> uploaded = java.util.Arrays.stream(files)
                    .map(file -> {
                        if (userId != null) {
                            return fileService.uploadFileForUser(file, userId, request);
                        } else {
                            return fileService.uploadFile(file, sessionId, request);
                        }
                    })
                    .toList();

            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);

        } catch (Exception e) {
            log.error("Batch upload failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // ============================================
    // File Download
    // ============================================

    /**
     * Download a file by UUID.
     */
    @GetMapping("/{fileUuid}/download")
    public ResponseEntity<Resource> downloadFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        log.info("File download request: uuid={}, sessionId={}, userId={}", fileUuid, sessionId, userId);

        try {
            FileDownloadResponse download = fileService.getFileForDownload(fileUuid, sessionId, userId);

            String encodedFilename = URLEncoder.encode(download.getFilename(), StandardCharsets.UTF_8)
                    .replace("+", "%20");

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(
                            download.getContentType() != null ? download.getContentType() : "application/octet-stream"))
                    .contentLength(download.getFileSize())
                    .header(HttpHeaders.CONTENT_DISPOSITION, 
                            "attachment; filename=\"" + encodedFilename + "\"; filename*=UTF-8''" + encodedFilename)
                    .body(download.getResource());

        } catch (IllegalArgumentException e) {
            log.warn("File not found: {}", fileUuid);
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            log.warn("Access denied to file: {}", fileUuid);
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        } catch (Exception e) {
            log.error("File download failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Get file metadata by UUID.
     */
    @GetMapping("/{fileUuid}")
    public ResponseEntity<WorkspaceFile> getFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        return fileService.getFileWithAccess(fileUuid, sessionId, userId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // ============================================
    // File Listing
    // ============================================

    /**
     * List files for current session/user.
     */
    @GetMapping
    public ResponseEntity<PageResponse<WorkspaceFile>> listFiles(
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId,
            @RequestParam(value = "type", required = false) String fileType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        log.debug("List files request: sessionId={}, userId={}, projectId={}, type={}", 
                sessionId, userId, projectId, fileType);

        Page<WorkspaceFile> result;

        if (projectId != null) {
            result = fileService.listFilesForProject(projectId, page, size);
        } else if (userId != null) {
            if (fileType != null) {
                WorkspaceFile.FileType type = WorkspaceFile.FileType.valueOf(fileType.toUpperCase());
                result = fileService.listFilesByTypeForSession(userId, type, page, size);
            } else {
                result = fileService.listFilesForUser(userId, page, size);
            }
        } else if (sessionId != null) {
            if (fileType != null) {
                WorkspaceFile.FileType type = WorkspaceFile.FileType.valueOf(fileType.toUpperCase());
                result = fileService.listFilesByTypeForSession(sessionId, type, page, size);
            } else {
                result = fileService.listFilesForSession(sessionId, page, size);
            }
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(PageResponse.from(result));
    }

    /**
     * Search files by name.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<WorkspaceFile>> searchFiles(
            @RequestParam String q,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<WorkspaceFile> result;

        if (userId != null) {
            result = fileService.searchFilesForUser(userId, q, page, size);
        } else if (sessionId != null) {
            result = fileService.searchFilesForSession(sessionId, q, page, size);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(PageResponse.from(result));
    }

    // ============================================
    // File Deletion
    // ============================================

    /**
     * Delete a file.
     */
    @DeleteMapping("/{fileUuid}")
    public ResponseEntity<Void> deleteFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        log.info("File delete request: uuid={}, sessionId={}, userId={}", fileUuid, sessionId, userId);

        try {
            fileService.deleteFile(fileUuid, sessionId, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Delete all files for session (for cleanup).
     */
    @DeleteMapping("/session/{sessionId}")
    public ResponseEntity<Void> deleteAllSessionFiles(@PathVariable String sessionId) {
        log.info("Delete all files for session: {}", sessionId);
        fileService.deleteAllFilesForSession(sessionId);
        return ResponseEntity.noContent().build();
    }

    // ============================================
    // File Migration
    // ============================================

    /**
     * Transfer session files to user (when anonymous user logs in).
     */
    @PostMapping("/transfer")
    public ResponseEntity<Map<String, Object>> transferFiles(
            @RequestParam String sessionId,
            @RequestParam String userId
    ) {
        log.info("Transfer files from session {} to user {}", sessionId, userId);

        int count = fileService.transferSessionFilesToUser(sessionId, userId);
        
        return ResponseEntity.ok(Map.of(
                "transferred", count,
                "sessionId", sessionId,
                "userId", userId
        ));
    }

    // ============================================
    // Storage Statistics
    // ============================================

    /**
     * Get storage statistics.
     */
    @GetMapping("/stats")
    public ResponseEntity<StorageStats> getStorageStats(
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        StorageStats stats;

        if (userId != null) {
            stats = fileService.getStorageStatsForUser(userId);
        } else if (sessionId != null) {
            stats = fileService.getStorageStatsForSession(sessionId);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(stats);
    }

    // ============================================
    // Admin Operations (Internal)
    // ============================================

    /**
     * Cleanup expired files (should be called by scheduler).
     */
    @PostMapping("/admin/cleanup/expired")
    public ResponseEntity<Map<String, Object>> cleanupExpiredFiles() {
        int count = fileService.cleanupExpiredFiles();
        return ResponseEntity.ok(Map.of("markedForDeletion", count));
    }

    /**
     * Cleanup old session files.
     */
    @PostMapping("/admin/cleanup/sessions")
    public ResponseEntity<Map<String, Object>> cleanupOldSessionFiles(
            @RequestParam(defaultValue = "48") int olderThanHours
    ) {
        int count = fileService.cleanupOldSessionFiles(olderThanHours);
        return ResponseEntity.ok(Map.of("markedForDeletion", count));
    }

    /**
     * Purge deleted files permanently.
     */
    @PostMapping("/admin/purge")
    public ResponseEntity<Map<String, Object>> purgeDeletedFiles() {
        int count = fileService.purgeDeletedFiles();
        return ResponseEntity.ok(Map.of("purged", count));
    }

    // ============================================
    // Health Check
    // ============================================

    /**
     * Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "upload", true,
                        "download", true,
                        "delete", true,
                        "search", true,
                        "transfer", true
                )
        ));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiJobDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for AI Job response (includes sub-tasks status).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiJobDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String overallStatus;
    private List<AiSubTaskDto> subTasks;
    private int totalTasks;
    private int completedTasks;
    private int failedTasks;
    private String errorMessage;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiRequestMessage.java

```java
package com.newsinsight.collector.dto;

import java.util.Map;

public record AiRequestMessage(
        String requestId,
        String type,
        String query,
        String window,
        String message,
        Map<String, Object> context,
        String providerId,
        String modelId,
        String agentRole,
        String outputSchema,
        String source
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiResponseMessage.java

```java
package com.newsinsight.collector.dto;

import java.util.Map;

public record AiResponseMessage(
        String requestId,
        String status,
        String completedAt,
        String providerId,
        String modelId,
        String text,
        Map<String, Object> raw
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiSubTaskDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO for AI Sub-Task response.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiSubTaskDto {
    private String subTaskId;
    private String jobId;
    private String providerId;
    private String taskType;
    private String status;
    private String resultJson;
    private String errorMessage;
    private int retryCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime completedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiTaskCallbackRequest.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

/**
 * Callback request payload from AI worker/n8n.
 * Received at /api/v1/ai/callback endpoint.
 */
public record AiTaskCallbackRequest(
        /**
         * Parent job ID
         */
        String jobId,

        /**
         * Individual sub-task ID
         */
        String subTaskId,

        /**
         * AI provider identifier
         */
        String providerId,

        /**
         * Task completion status (COMPLETED, FAILED, etc.)
         */
        String status,

        /**
         * JSON result data from the AI task
         */
        String resultJson,

        /**
         * Error message if task failed
         */
        String errorMessage,

        /**
         * Callback authentication token
         */
        String callbackToken,

        /**
         * Evidence list (for DEEP_READER provider)
         */
        List<EvidenceDto> evidence
) {
    /**
     * Check if the callback indicates success
     */
    public boolean isSuccess() {
        return "COMPLETED".equalsIgnoreCase(status) || "completed".equalsIgnoreCase(status);
    }

    /**
     * Check if the callback indicates failure
     */
    public boolean isFailed() {
        return "FAILED".equalsIgnoreCase(status) || "failed".equalsIgnoreCase(status);
    }

    /**
     * Create a builder for AiTaskCallbackRequest
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String jobId;
        private String subTaskId;
        private String providerId;
        private String status;
        private String resultJson;
        private String errorMessage;
        private String callbackToken;
        private List<EvidenceDto> evidence;

        public Builder jobId(String jobId) {
            this.jobId = jobId;
            return this;
        }

        public Builder subTaskId(String subTaskId) {
            this.subTaskId = subTaskId;
            return this;
        }

        public Builder providerId(String providerId) {
            this.providerId = providerId;
            return this;
        }

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public Builder resultJson(String resultJson) {
            this.resultJson = resultJson;
            return this;
        }

        public Builder errorMessage(String errorMessage) {
            this.errorMessage = errorMessage;
            return this;
        }

        public Builder callbackToken(String callbackToken) {
            this.callbackToken = callbackToken;
            return this;
        }

        public Builder evidence(List<EvidenceDto> evidence) {
            this.evidence = evidence;
            return this;
        }

        public AiTaskCallbackRequest build() {
            return new AiTaskCallbackRequest(
                    jobId, subTaskId, providerId, status,
                    resultJson, errorMessage, callbackToken, evidence
            );
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AiTaskRequestMessage.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka message for AI task requests.
 * Sent to ai.tasks.requests topic for worker/n8n processing.
 */
public record AiTaskRequestMessage(
        /**
         * Parent job ID
         */
        String jobId,

        /**
         * Individual sub-task ID
         */
        String subTaskId,

        /**
         * AI provider identifier (UNIVERSAL_AGENT, DEEP_READER, SCOUT, etc.)
         */
        String providerId,

        /**
         * Type of task to perform
         */
        String taskType,

        /**
         * Search topic/query
         */
        String topic,

        /**
         * Base URL for crawling (optional)
         */
        String baseUrl,

        /**
         * Additional payload data for the provider
         */
        Map<String, Object> payload,

        /**
         * URL for callback after task completion
         */
        String callbackUrl,

        /**
         * Token for callback authentication
         */
        String callbackToken,

        /**
         * Message creation timestamp
         */
        LocalDateTime createdAt
) {
    /**
     * Create a builder for AiTaskRequestMessage
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String jobId;
        private String subTaskId;
        private String providerId;
        private String taskType;
        private String topic;
        private String baseUrl;
        private Map<String, Object> payload;
        private String callbackUrl;
        private String callbackToken;
        private LocalDateTime createdAt;

        public Builder jobId(String jobId) {
            this.jobId = jobId;
            return this;
        }

        public Builder subTaskId(String subTaskId) {
            this.subTaskId = subTaskId;
            return this;
        }

        public Builder providerId(String providerId) {
            this.providerId = providerId;
            return this;
        }

        public Builder taskType(String taskType) {
            this.taskType = taskType;
            return this;
        }

        public Builder topic(String topic) {
            this.topic = topic;
            return this;
        }

        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        public Builder payload(Map<String, Object> payload) {
            this.payload = payload;
            return this;
        }

        public Builder callbackUrl(String callbackUrl) {
            this.callbackUrl = callbackUrl;
            return this;
        }

        public Builder callbackToken(String callbackToken) {
            this.callbackToken = callbackToken;
            return this;
        }

        public Builder createdAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public AiTaskRequestMessage build() {
            return new AiTaskRequestMessage(
                    jobId, subTaskId, providerId, taskType, topic, baseUrl,
                    payload, callbackUrl, callbackToken,
                    createdAt != null ? createdAt : LocalDateTime.now()
            );
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/AnalysisResponseDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record AnalysisResponseDto(
        String query,
        String window,
        @JsonProperty("article_count") long articleCount,
        SentimentDataDto sentiments,
        @JsonProperty("top_keywords") List<KeywordDataDto> topKeywords,
        @JsonProperty("analyzed_at") String analyzedAt
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ArticleDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ArticleDto(
        String id,
        String title,
        String source,
        @JsonProperty("published_at") String publishedAt,
        String url,
        String snippet,
        String content  // 전체 본문 (export/저장용)
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ArticleWithAnalysisDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 검색 결과에 분석 정보를 포함한 DTO.
 * 
 * 프론트엔드가 검색 결과를 표시할 때 사용.
 * 분석이 완료되지 않은 경우 null로 표시하여 skeleton UI 렌더링 유도.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleWithAnalysisDto {

    // ========== 기본 기사 정보 ==========
    private Long id;
    private String title;
    private String content;
    private String url;
    private String source;
    private LocalDateTime publishedDate;
    private LocalDateTime collectedAt;

    // ========== 분석 상태 ==========
    /**
     * 분석 완료 여부 (true면 analysis 필드 사용 가능)
     */
    private Boolean analyzed;
    
    /**
     * 분석 진행 상태 (pending, partial, complete)
     */
    private String analysisStatus;

    // ========== 요약 정보 (간략 표시용) ==========
    /**
     * AI 생성 요약 (1-2문장)
     */
    private String summary;

    // ========== 신뢰도 배지 ==========
    /**
     * 신뢰도 점수 (0-100)
     */
    private Double reliabilityScore;
    
    /**
     * 신뢰도 등급 (high, medium, low)
     */
    private String reliabilityGrade;
    
    /**
     * 신뢰도 색상 코드 (green, yellow, red)
     */
    private String reliabilityColor;

    // ========== 감정 분석 ==========
    /**
     * 감정 레이블 (positive, negative, neutral)
     */
    private String sentimentLabel;
    
    /**
     * 감정 점수 (-1 ~ 1)
     */
    private Double sentimentScore;
    
    /**
     * 감정 분포 (긍정/부정/중립 비율)
     */
    private Map<String, Double> sentimentDistribution;

    // ========== 편향도 ==========
    /**
     * 편향 레이블 (left, right, center 등)
     */
    private String biasLabel;
    
    /**
     * 편향 점수 (-1 ~ 1)
     */
    private Double biasScore;

    // ========== 팩트체크 ==========
    /**
     * 팩트체크 상태 (verified, suspicious, conflicting, unverified)
     */
    private String factcheckStatus;
    
    /**
     * 허위정보 위험도 (low, mid, high)
     */
    private String misinfoRisk;

    // ========== 위험 태그 ==========
    /**
     * 경고 태그 목록 (clickbait, sensational 등)
     */
    private List<String> riskTags;

    // ========== 토픽/키워드 ==========
    /**
     * 주요 토픽
     */
    private List<String> topics;

    // ========== 커뮤니티 여론 요약 ==========
    /**
     * 여론 있음 여부
     */
    private Boolean hasDiscussion;
    
    /**
     * 전체 댓글 수
     */
    private Integer totalCommentCount;
    
    /**
     * 전체 여론 감정 (positive, negative, neutral, mixed)
     */
    private String discussionSentiment;
    
    /**
     * 여론 감정 분포
     */
    private Map<String, Double> discussionSentimentDistribution;
    
    /**
     * 여론 요약 문장
     */
    private String discussionSummary;

    // ========== 정적 팩토리 메서드 ==========

    /**
     * 분석 결과가 없는 기사용
     */
    public static ArticleWithAnalysisDto fromArticleOnly(
            Long id, String title, String content, String url, 
            String source, LocalDateTime publishedDate, LocalDateTime collectedAt
    ) {
        return ArticleWithAnalysisDto.builder()
                .id(id)
                .title(title)
                .content(content)
                .url(url)
                .source(source)
                .publishedDate(publishedDate)
                .collectedAt(collectedAt)
                .analyzed(false)
                .analysisStatus("pending")
                .build();
    }

    /**
     * 분석 결과 포함
     */
    public static ArticleWithAnalysisDto fromArticleWithAnalysis(
            Long id, String title, String content, String url,
            String source, LocalDateTime publishedDate, LocalDateTime collectedAt,
            ArticleAnalysis analysis, ArticleDiscussion discussion
    ) {
        ArticleWithAnalysisDtoBuilder builder = ArticleWithAnalysisDto.builder()
                .id(id)
                .title(title)
                .content(content)
                .url(url)
                .source(source)
                .publishedDate(publishedDate)
                .collectedAt(collectedAt);

        if (analysis != null) {
            builder.analyzed(true)
                    .analysisStatus(analysis.getFullyAnalyzed() ? "complete" : "partial")
                    .summary(analysis.getSummary())
                    .reliabilityScore(analysis.getReliabilityScore())
                    .reliabilityGrade(analysis.getReliabilityGrade())
                    .reliabilityColor(analysis.getReliabilityColor())
                    .sentimentLabel(analysis.getSentimentLabel())
                    .sentimentScore(analysis.getSentimentScore())
                    .sentimentDistribution(analysis.getSentimentDistribution())
                    .biasLabel(analysis.getBiasLabel())
                    .biasScore(analysis.getBiasScore())
                    .factcheckStatus(analysis.getFactcheckStatus())
                    .misinfoRisk(analysis.getMisinfoRisk())
                    .riskTags(analysis.getRiskTags())
                    .topics(analysis.getTopics());
        } else {
            builder.analyzed(false)
                    .analysisStatus("pending");
        }

        if (discussion != null) {
            builder.hasDiscussion(true)
                    .totalCommentCount(discussion.getTotalCommentCount())
                    .discussionSentiment(discussion.getOverallSentiment())
                    .discussionSentimentDistribution(discussion.getSentimentDistribution())
                    .discussionSummary(discussion.getSentimentSummary());
        } else {
            builder.hasDiscussion(false);
        }

        return builder.build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ArticlesResponseDto.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

public record ArticlesResponseDto(
        String query,
        List<ArticleDto> articles,
        long total
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/BrowserAgentConfigDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.BrowserAgentConfig;
import com.newsinsight.collector.entity.BrowserAgentPolicy;

/**
 * DTO for browser agent configuration in API requests/responses.
 */
public record BrowserAgentConfigDto(
        Integer maxDepth,
        Integer maxPages,
        Integer budgetSeconds,
        String policy,
        String focusKeywords,
        String customPrompt,
        Boolean captureScreenshots,
        Boolean extractStructured,
        String excludedDomains
) {
    /**
     * Convert to entity.
     */
    public BrowserAgentConfig toEntity() {
        return BrowserAgentConfig.builder()
                .maxDepth(maxDepth != null ? maxDepth : 2)
                .maxPages(maxPages != null ? maxPages : 50)
                .budgetSeconds(budgetSeconds != null ? budgetSeconds : 300)
                .policy(policy != null ? BrowserAgentPolicy.fromValue(policy) : BrowserAgentPolicy.FOCUSED_TOPIC)
                .focusKeywords(focusKeywords)
                .customPrompt(customPrompt)
                .captureScreenshots(captureScreenshots != null ? captureScreenshots : false)
                .extractStructured(extractStructured != null ? extractStructured : true)
                .excludedDomains(excludedDomains)
                .build();
    }

    /**
     * Create from entity.
     */
    public static BrowserAgentConfigDto fromEntity(BrowserAgentConfig config) {
        if (config == null) {
            return null;
        }
        return new BrowserAgentConfigDto(
                config.getMaxDepth(),
                config.getMaxPages(),
                config.getBudgetSeconds(),
                config.getPolicy() != null ? config.getPolicy().getValue() : null,
                config.getFocusKeywords(),
                config.getCustomPrompt(),
                config.getCaptureScreenshots(),
                config.getExtractStructured(),
                config.getExcludedDomains()
        );
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/BrowserTaskMessage.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Builder;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Kafka message for browser-based autonomous crawling tasks.
 * Consumed by autonomous-crawler-service (Python/Browser-use).
 */
@Builder
public record BrowserTaskMessage(
        /**
         * Unique job ID for tracking.
         */
        Long jobId,
        
        /**
         * Data source ID.
         */
        Long sourceId,
        
        /**
         * Source name for logging/display.
         */
        String sourceName,
        
        /**
         * Seed URL to start exploration from.
         */
        String seedUrl,
        
        /**
         * Maximum link traversal depth.
         */
        Integer maxDepth,
        
        /**
         * Maximum pages to visit.
         */
        Integer maxPages,
        
        /**
         * Time budget in seconds.
         */
        Integer budgetSeconds,
        
        /**
         * Exploration policy (focused_topic, domain_wide, news_only, etc.)
         */
        String policy,
        
        /**
         * Focus keywords for FOCUSED_TOPIC policy.
         */
        String focusKeywords,
        
        /**
         * Custom prompt/instructions for AI agent.
         */
        String customPrompt,
        
        /**
         * Whether to capture screenshots.
         */
        Boolean captureScreenshots,
        
        /**
         * Whether to extract structured data.
         */
        Boolean extractStructured,
        
        /**
         * Domains to exclude.
         */
        String excludedDomains,
        
        /**
         * Callback URL for session completion notification.
         */
        String callbackUrl,
        
        /**
         * Callback authentication token.
         */
        String callbackToken,
        
        /**
         * Additional metadata.
         */
        Map<String, Object> metadata,
        
        /**
         * Task creation timestamp.
         * Serialized as ISO-8601 string for Python compatibility.
         */
        @JsonFormat(shape = JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss")
        LocalDateTime createdAt
) {
    public BrowserTaskMessage {
        createdAt = createdAt != null ? createdAt : LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ClaimExtractionRequest.java

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for extracting claims from a URL
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClaimExtractionRequest {
    
    @NotBlank(message = "URL is required")
    private String url;
    
    /** Optional: Maximum number of claims to extract */
    private Integer maxClaims;
    
    /** Optional: Minimum confidence threshold (0.0 - 1.0) */
    private Double minConfidence;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/ClaimExtractionResponse.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response DTO for claim extraction
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClaimExtractionResponse {
    
    /** The URL that was analyzed */
    private String url;
    
    /** Title of the page */
    private String pageTitle;
    
    /** List of extracted claims */
    private List<ExtractedClaim> claims;
    
    /** Processing time in milliseconds */
    private Long processingTimeMs;
    
    /** Source of extraction (e.g., "crawl4ai", "direct", "browser-use") */
    private String extractionSource;
    
    /** Any warning or info messages */
    private String message;
    
    /**
     * Individual claim extracted from the content
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExtractedClaim {
        /** Unique identifier for the claim */
        private String id;
        
        /** The claim text */
        private String text;
        
        /** Confidence score (0.0 - 1.0) */
        private Double confidence;
        
        /** Context where the claim was found */
        private String context;
        
        /** Type of claim: factual, opinion, prediction, etc. */
        private String claimType;
        
        /** Whether this claim is verifiable */
        private Boolean verifiable;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectedDataDTO.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record CollectedDataDTO(
        Long id,
        Long sourceId,
        String title,
        String content,
        String url,
        LocalDateTime publishedDate,
        LocalDateTime collectedAt,
        String contentHash,
        Map<String, Object> metadata,
        Boolean processed
) {
    public CollectedDataDTO {
        /**
         * Map.copyOf()는 원본 맵의 '읽기 전용 복사본'을 만듭니다.
         * 이로써 이 record는 외부의 어떤 변경에도 영향을 받지 않는
         * 완전한 불변 객체로써 동작합니다.
         */
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionJobDTO.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.CollectionJob.JobStatus;

import java.time.LocalDateTime;

public record CollectionJobDTO(
        Long id,
        Long sourceId,
        JobStatus status,
        LocalDateTime startedAt,
        LocalDateTime completedAt,
        Integer itemsCollected,
        String errorMessage,
        LocalDateTime createdAt
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionRequest.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

public record CollectionRequest(List<Long> sourceIds, boolean force) {
    public CollectionRequest {
        sourceIds = sourceIds == null ? List.of() : List.copyOf(sourceIds);
    }

    public CollectionRequest(List<Long> sourceIds) {
        this(sourceIds, false);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionResponse.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.List;

public record CollectionResponse(
        String message,
        List<CollectionJobDTO> jobs,
        Integer totalJobsStarted,
        LocalDateTime timestamp
) {
    public CollectionResponse {
        jobs = jobs == null ? List.of() : List.copyOf(jobs);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CollectionStatsDTO.java

```java
package com.newsinsight.collector.dto;

import java.time.LocalDateTime;

public record CollectionStatsDTO(
        Long totalSources,
        Long activeSources,
        Long totalItemsCollected,
        Long itemsCollectedToday,
        LocalDateTime lastCollection
) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CrawlCommandMessage.java

```java
package com.newsinsight.collector.dto;

public record CrawlCommandMessage(
        Long jobId,
        Long sourceId,
        String sourceType,
        String url,
        String sourceName
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CrawlResultMessage.java

```java
package com.newsinsight.collector.dto;

public record CrawlResultMessage(
        Long jobId,
        Long sourceId,
        String title,
        String content,
        String url,
        String publishedAt,
        String metadataJson
) {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/CrawledPage.java

```java
package com.newsinsight.collector.dto;

import java.util.List;

/**
 * DTO representing a crawled web page
 * Used by IntegratedCrawlerService to pass crawl results
 */
public record CrawledPage(
        String url,
        String title,
        String content,
        String source,  // e.g., "crawl4ai", "browser-use", "direct"
        List<String> links
) {
    /**
     * Create a CrawledPage with no extracted links
     */
    public static CrawledPage of(String url, String title, String content, String source) {
        return new CrawledPage(url, title, content, source, List.of());
    }

    /**
     * Check if this page has valid content
     */
    public boolean hasContent() {
        return content != null && !content.isBlank();
    }

    /**
     * Get a truncated snippet of the content
     */
    public String getSnippet(int maxLength) {
        if (content == null) return "";
        if (content.length() <= maxLength) return content;
        return content.substring(0, maxLength) + "...";
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DashboardEventDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;

/**
 * 대시보드 실시간 이벤트 DTO.
 * SSE를 통해 클라이언트에 전송되는 이벤트 데이터를 담습니다.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class DashboardEventDto {

    /**
     * 이벤트 타입
     */
    private EventType eventType;

    /**
     * 이벤트 발생 시각
     */
    @Builder.Default
    private Instant timestamp = Instant.now();

    /**
     * 이벤트 메시지
     */
    private String message;

    /**
     * 추가 데이터 (이벤트 타입에 따라 다름)
     */
    private Map<String, Object> data;

    /**
     * 이벤트 타입 열거형
     */
    public enum EventType {
        HEARTBEAT,      // 연결 유지용 하트비트
        NEW_DATA,       // 새로운 데이터 수집됨
        SOURCE_UPDATED, // 소스 상태 변경
        STATS_UPDATED,  // 통계 갱신
        COLLECTION_STARTED,  // 수집 시작
        COLLECTION_COMPLETED, // 수집 완료
        ERROR           // 에러 발생
    }

    /**
     * 하트비트 이벤트 생성
     */
    public static DashboardEventDto heartbeat() {
        return DashboardEventDto.builder()
                .eventType(EventType.HEARTBEAT)
                .message("Connection alive")
                .build();
    }

    /**
     * 새 데이터 수집 이벤트 생성
     */
    public static DashboardEventDto newData(String message, Map<String, Object> data) {
        return DashboardEventDto.builder()
                .eventType(EventType.NEW_DATA)
                .message(message)
                .data(data)
                .build();
    }

    /**
     * 통계 갱신 이벤트 생성
     */
    public static DashboardEventDto statsUpdated(Map<String, Object> stats) {
        return DashboardEventDto.builder()
                .eventType(EventType.STATS_UPDATED)
                .message("Statistics updated")
                .data(stats)
                .build();
    }

    /**
     * 소스 업데이트 이벤트 생성
     */
    public static DashboardEventDto sourceUpdated(String sourceId, String status) {
        return DashboardEventDto.builder()
                .eventType(EventType.SOURCE_UPDATED)
                .message("Source " + sourceId + " status changed to " + status)
                .data(Map.of("sourceId", sourceId, "status", status))
                .build();
    }

    /**
     * 에러 이벤트 생성
     */
    public static DashboardEventDto error(String message) {
        return DashboardEventDto.builder()
                .eventType(EventType.ERROR)
                .message(message)
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DataSourceCreateRequest.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record DataSourceCreateRequest(
        @NotBlank(message = "Name is required") String name,
        @NotBlank(message = "URL is required") String url,
        @NotNull(message = "Source type is required") SourceType sourceType,
        @Min(value = 60, message = "Collection frequency must be at least 60 seconds") Integer collectionFrequency,
        Map<String, Object> metadata,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceCreateRequest {
        collectionFrequency = collectionFrequency == null ? 3600 : collectionFrequency;
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DataSourceDTO.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.SourceType;

import java.time.LocalDateTime;
import java.util.Map;

public record DataSourceDTO(
        Long id,
        String name,
        String url,
        SourceType sourceType,
        Boolean isActive,
        LocalDateTime lastCollected,
        Integer collectionFrequency,
        Map<String, Object> metadata,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceDTO {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DataSourceUpdateRequest.java

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.Min;

import java.util.Map;

public record DataSourceUpdateRequest(
        String name,
        String url,
        Boolean isActive,
        @Min(value = 60, message = "Collection frequency must be at least 60 seconds") Integer collectionFrequency,
        Map<String, Object> metadata,
        BrowserAgentConfigDto browserAgentConfig
) {
    public DataSourceUpdateRequest {
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchCallbackDto.java

```java
package com.newsinsight.collector.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * DTO for n8n callback payload
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchCallbackDto {
    
    @JsonProperty("job_id")
    private String jobId;
    
    private String status;
    
    private String topic;
    
    @JsonProperty("base_url")
    private String baseUrl;
    
    private List<CallbackEvidence> evidence;
    
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CallbackEvidence {
        private String url;
        private String title;
        private String stance;
        private String snippet;
        private String source;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchJobDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * DTO for deep search job status
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchJobDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String status;
    private Integer evidenceCount;
    private String errorMessage;
    private String failureReason;      // Code like "timeout_job_overall"
    private String failureCategory;     // High-level category like "timeout", "network", "service"
    private LocalDateTime createdAt;
    private LocalDateTime completedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchRequest.java

```java
package com.newsinsight.collector.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request DTO for starting a deep search
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchRequest {
    
    @NotBlank(message = "Topic is required")
    private String topic;
    
    /**
     * Optional base URL to start crawling from.
     * If not provided, a default news aggregator will be used.
     */
    private String baseUrl;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/DeepSearchResultDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO for deep search result including evidence
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DeepSearchResultDto {
    private String jobId;
    private String topic;
    private String baseUrl;
    private String status;
    private Integer evidenceCount;
    private List<EvidenceDto> evidence;
    private StanceDistributionDto stanceDistribution;
    private LocalDateTime createdAt;
    private LocalDateTime completedAt;
    private String errorMessage;
    private String failureReason;      // Code like "timeout_job_overall"
    private String failureCategory;     // High-level category like "timeout", "network", "service"
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/EvidenceDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for evidence item from deep search
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EvidenceDto {
    private Long id;
    private String url;
    private String title;
    private String stance;  // pro, con, neutral
    private String snippet;
    private String source;
    private String sourceCategory;  // news, community, blog, official, academic
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/KeywordDataDto.java

```java
package com.newsinsight.collector.dto;

public record KeywordDataDto(String word, double score) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/PageResponse.java

```java
package com.newsinsight.collector.dto;

import java.util.List;
import java.util.Objects;

import org.springframework.data.domain.Page;

public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean first,
        boolean last,
        boolean hasNext,
        boolean hasPrevious
) {
    public PageResponse {
        content = content == null ? List.of() : List.copyOf(content);
    }

    public static <T> PageResponse<T> from(Page<T> page) {
        Objects.requireNonNull(page, "page must not be null");
        return new PageResponse<>(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.isFirst(),
                page.isLast(),
                page.hasNext(),
                page.hasPrevious()
        );
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchHistoryDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * DTO for SearchHistory API responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistoryDto {

    private Long id;
    private String externalId;
    private SearchType searchType;
    private String query;
    private String timeWindow;
    private String userId;
    private String sessionId;
    private Long parentSearchId;
    private Integer depthLevel;
    private Integer resultCount;
    private List<Map<String, Object>> results;
    private Map<String, Object> aiSummary;
    private List<String> discoveredUrls;
    private List<Map<String, Object>> factCheckResults;
    private Double credibilityScore;
    private Map<String, Object> stanceDistribution;
    private Map<String, Object> metadata;
    private Boolean bookmarked;
    private List<String> tags;
    private String notes;
    private Long durationMs;
    private String errorMessage;
    private Boolean success;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /**
     * Convert entity to DTO.
     */
    public static SearchHistoryDto fromEntity(SearchHistory entity) {
        return SearchHistoryDto.builder()
                .id(entity.getId())
                .externalId(entity.getExternalId())
                .searchType(entity.getSearchType())
                .query(entity.getQuery())
                .timeWindow(entity.getTimeWindow())
                .userId(entity.getUserId())
                .sessionId(entity.getSessionId())
                .parentSearchId(entity.getParentSearchId())
                .depthLevel(entity.getDepthLevel())
                .resultCount(entity.getResultCountSafe())
                .results(entity.getResults())
                .aiSummary(entity.getAiSummary())
                .discoveredUrls(entity.getDiscoveredUrls())
                .factCheckResults(entity.getFactCheckResults())
                .credibilityScore(entity.getCredibilityScore())
                .stanceDistribution(entity.getStanceDistribution())
                .metadata(entity.getMetadata())
                .bookmarked(entity.getBookmarked())
                .tags(entity.getTags())
                .notes(entity.getNotes())
                .durationMs(entity.getDurationMs())
                .errorMessage(entity.getErrorMessage())
                .success(entity.getSuccess())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    /**
     * Convert DTO to message for Kafka.
     */
    public SearchHistoryMessage toMessage() {
        return SearchHistoryMessage.builder()
                .externalId(this.externalId)
                .searchType(this.searchType)
                .query(this.query)
                .timeWindow(this.timeWindow)
                .userId(this.userId)
                .sessionId(this.sessionId)
                .parentSearchId(this.parentSearchId)
                .depthLevel(this.depthLevel)
                .resultCount(this.resultCount)
                .results(this.results)
                .aiSummary(this.aiSummary)
                .discoveredUrls(this.discoveredUrls)
                .factCheckResults(this.factCheckResults)
                .credibilityScore(this.credibilityScore)
                .stanceDistribution(this.stanceDistribution)
                .metadata(this.metadata)
                .durationMs(this.durationMs)
                .errorMessage(this.errorMessage)
                .success(this.success)
                .timestamp(System.currentTimeMillis())
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchHistoryMessage.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Kafka message DTO for search history events.
 * Used for asynchronous search result persistence via Kafka.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistoryMessage {

    /**
     * External reference ID (e.g., jobId)
     */
    private String externalId;

    /**
     * Type of search performed
     */
    private SearchType searchType;

    /**
     * The search query or topic
     */
    private String query;

    /**
     * Time window for search (e.g., 1d, 7d, 30d)
     */
    private String timeWindow;

    /**
     * Optional user ID
     */
    private String userId;

    /**
     * Session ID for grouping searches
     */
    private String sessionId;

    /**
     * Parent search ID for derived searches
     */
    private Long parentSearchId;

    /**
     * Depth level for drilldown searches
     */
    @Builder.Default
    private Integer depthLevel = 0;

    /**
     * Total number of results
     */
    @Builder.Default
    private Integer resultCount = 0;

    /**
     * Search results as JSON list
     */
    private List<Map<String, Object>> results;

    /**
     * AI summary/response
     */
    private Map<String, Object> aiSummary;

    /**
     * URLs discovered during search
     */
    private List<String> discoveredUrls;

    /**
     * Fact check results
     */
    private List<Map<String, Object>> factCheckResults;

    /**
     * Overall credibility score (0-100)
     */
    private Double credibilityScore;

    /**
     * Stance distribution
     */
    private Map<String, Object> stanceDistribution;

    /**
     * Additional metadata
     */
    private Map<String, Object> metadata;

    /**
     * Search duration in milliseconds
     */
    private Long durationMs;

    /**
     * Error message if search failed
     */
    private String errorMessage;

    /**
     * Whether the search succeeded
     */
    @Builder.Default
    private Boolean success = true;

    /**
     * Timestamp when search was performed (epoch millis)
     */
    private Long timestamp;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchResultSummaryDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * 검색 결과 페이지 전체 요약 DTO.
 * 
 * 검색 결과 상단에 표시되는 종합 분석 정보.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchResultSummaryDto {

    /**
     * 총 검색 결과 수
     */
    private Integer totalResults;

    /**
     * 분석 완료된 결과 수
     */
    private Integer analyzedResults;

    // ========== 주제 요약 ==========
    
    /**
     * 주요 키워드/토픽 (상위 5개)
     */
    private List<String> mainTopics;

    /**
     * AI 생성 이슈 요약 (1-2문장)
     */
    private String issueSummary;

    /**
     * 상반된 관점 요약
     * [{"view": "찬성측", "summary": "..."}, {"view": "반대측", "summary": "..."}]
     */
    private List<Map<String, String>> contrastingViews;

    // ========== 신뢰도/편향 요약 ==========

    /**
     * 신뢰도 분포
     * {"high": 0.3, "medium": 0.5, "low": 0.2}
     */
    private Map<String, Double> reliabilityDistribution;

    /**
     * 편향도 분포
     * {"left": 0.2, "center": 0.6, "right": 0.2}
     */
    private Map<String, Double> biasDistribution;

    /**
     * 허위정보 위험 기사 비율
     */
    private Double misinfoRiskRatio;

    // ========== 감정 요약 ==========

    /**
     * 전체 기사 감정 분포
     */
    private Map<String, Double> overallSentiment;

    // ========== 여론 요약 ==========

    /**
     * 전체 댓글 수 합계
     */
    private Integer totalCommentCount;

    /**
     * 전체 여론 감정 분포
     */
    private Map<String, Double> overallDiscussionSentiment;

    /**
     * 여론 요약 문장
     */
    private String discussionSummary;

    /**
     * 시간대별 여론 변화 (그래프용)
     */
    private List<Map<String, Object>> discussionTimeSeries;

    // ========== 경고/주의 ==========

    /**
     * 검색 결과 관련 경고 메시지
     */
    private List<String> warnings;

    /**
     * 팩트체크 필요 기사 수
     */
    private Integer factcheckNeededCount;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SearchTemplateDto.java

```java
package com.newsinsight.collector.dto;

import com.newsinsight.collector.entity.search.SearchTemplate;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * DTO for SearchTemplate API requests and responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchTemplateDto {

    private Long id;
    private String name;
    private String query;
    private String mode;
    private String userId;
    private List<Map<String, Object>> items;
    private String description;
    private Boolean favorite;
    private List<String> tags;
    private Map<String, Object> metadata;
    private Long sourceSearchId;
    private Integer useCount;
    private LocalDateTime lastUsedAt;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    
    // Computed field
    private Integer itemCount;

    /**
     * Convert entity to DTO
     */
    public static SearchTemplateDto fromEntity(SearchTemplate entity) {
        return SearchTemplateDto.builder()
                .id(entity.getId())
                .name(entity.getName())
                .query(entity.getQuery())
                .mode(entity.getMode())
                .userId(entity.getUserId())
                .items(entity.getItems())
                .description(entity.getDescription())
                .favorite(entity.getFavorite())
                .tags(entity.getTags())
                .metadata(entity.getMetadata())
                .sourceSearchId(entity.getSourceSearchId())
                .useCount(entity.getUseCount())
                .lastUsedAt(entity.getLastUsedAt())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .itemCount(entity.getItemCount())
                .build();
    }

    /**
     * Convert DTO to entity for creation
     */
    public SearchTemplate toEntity() {
        return SearchTemplate.builder()
                .name(this.name)
                .query(this.query)
                .mode(this.mode)
                .userId(this.userId)
                .items(this.items)
                .description(this.description)
                .favorite(this.favorite != null ? this.favorite : false)
                .tags(this.tags)
                .metadata(this.metadata)
                .sourceSearchId(this.sourceSearchId)
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/SentimentDataDto.java

```java
package com.newsinsight.collector.dto;

public record SentimentDataDto(double pos, double neg, double neu) {}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/StanceDistributionDto.java

```java
package com.newsinsight.collector.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * DTO for stance distribution statistics
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StanceDistributionDto {
    private Long pro;
    private Long con;
    private Long neutral;
    private Double proRatio;
    private Double conRatio;
    private Double neutralRatio;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/addon/AddonRequest.java

```java
package com.newsinsight.collector.dto.addon;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Add-on으로 보내는 분석 요청 DTO.
 * 
 * 모든 Add-on은 이 형식의 요청을 받아서 처리.
 * 내부 서비스, 외부 Colab, 서드파티 API 모두 동일한 스펙 사용.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddonRequest {

    /**
     * 요청 고유 ID (추적용)
     */
    @JsonProperty("request_id")
    private String requestId;

    /**
     * Add-on 식별자
     */
    @JsonProperty("addon_id")
    private String addonId;

    /**
     * 작업 유형 (article_analysis, comment_analysis, batch_analysis 등)
     */
    @JsonProperty("task")
    private String task;

    /**
     * 입력 스키마 버전
     */
    @JsonProperty("input_schema_version")
    @Builder.Default
    private String inputSchemaVersion = "1.0";

    /**
     * 분석 대상 기사 정보
     */
    @JsonProperty("article")
    private ArticleInput article;

    /**
     * 분석 대상 댓글/커뮤니티 (해당되는 경우)
     */
    @JsonProperty("comments")
    private CommentsInput comments;

    /**
     * 추가 컨텍스트 (언어, 국가, 이전 분석 결과 등)
     */
    @JsonProperty("context")
    private AnalysisContext context;

    /**
     * 실행 옵션
     */
    @JsonProperty("options")
    private ExecutionOptions options;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ArticleInput {
        /**
         * 기사 ID
         */
        private Long id;

        /**
         * 기사 제목
         */
        private String title;

        /**
         * 기사 본문
         */
        private String content;

        /**
         * 기사 URL
         */
        private String url;

        /**
         * 출처/언론사
         */
        private String source;

        /**
         * 발행일시 (ISO 8601)
         */
        @JsonProperty("published_at")
        private String publishedAt;

        /**
         * 추가 메타데이터
         */
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class CommentsInput {
        /**
         * 대상 기사 ID
         */
        @JsonProperty("article_id")
        private Long articleId;

        /**
         * 댓글 목록
         */
        private java.util.List<CommentItem> items;

        /**
         * 수집 플랫폼
         */
        private String platform;

        @Data
        @Builder
        @NoArgsConstructor
        @AllArgsConstructor
        public static class CommentItem {
            private String id;
            private String content;
            @JsonProperty("created_at")
            private String createdAt;
            private Integer likes;
            private Integer replies;
            @JsonProperty("author_id")
            private String authorId;
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnalysisContext {
        /**
         * 언어 코드 (ko, en, ja 등)
         */
        private String language;

        /**
         * 국가 코드
         */
        private String country;

        /**
         * 이전 Add-on들의 분석 결과 (의존성 체인에서 사용)
         */
        @JsonProperty("previous_results")
        private Map<String, Object> previousResults;

        /**
         * 관련 기사 ID들 (교차 검증용)
         */
        @JsonProperty("related_article_ids")
        private java.util.List<Long> relatedArticleIds;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ExecutionOptions {
        /**
         * 중요도 (realtime: 즉시 처리, batch: 배치 처리)
         */
        @Builder.Default
        private String importance = "batch";

        /**
         * 디버그 모드 (상세 로그 포함)
         */
        @Builder.Default
        private Boolean debug = false;

        /**
         * 타임아웃 (ms)
         */
        @JsonProperty("timeout_ms")
        private Integer timeoutMs;

        /**
         * 추가 파라미터
         */
        private Map<String, Object> params;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/addon/AddonResponse.java

```java
package com.newsinsight.collector.dto.addon;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Add-on이 반환하는 분석 결과 DTO.
 * 
 * 모든 Add-on은 이 형식으로 결과를 반환.
 * Orchestrator가 이를 파싱하여 ArticleAnalysis/ArticleDiscussion에 저장.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AddonResponse {

    /**
     * 요청 ID (추적용)
     */
    @JsonProperty("request_id")
    private String requestId;

    /**
     * Add-on 식별자
     */
    @JsonProperty("addon_id")
    private String addonId;

    /**
     * 처리 상태 (success, error, partial)
     */
    private String status;

    /**
     * 출력 스키마 버전
     */
    @JsonProperty("output_schema_version")
    @Builder.Default
    private String outputSchemaVersion = "1.0";

    /**
     * 분석 결과 (Add-on 카테고리별로 다른 구조)
     */
    private AnalysisResults results;

    /**
     * 에러 정보 (실패 시)
     */
    private ErrorInfo error;

    /**
     * 메타데이터
     */
    private ResponseMeta meta;

    // ========== 결과 구조 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnalysisResults {

        // === 감정 분석 (SENTIMENT) ===
        @JsonProperty("sentiment")
        private SentimentResult sentiment;

        // === 신뢰도 분석 (SOURCE_QUALITY) ===
        @JsonProperty("reliability")
        private ReliabilityResult reliability;

        // === 편향도 분석 ===
        @JsonProperty("bias")
        private BiasResult bias;

        // === 팩트체크 (FACTCHECK) ===
        @JsonProperty("factcheck")
        private FactcheckResult factcheck;

        // === 개체명 인식 (ENTITY_EXTRACTION) ===
        @JsonProperty("entities")
        private EntitiesResult entities;

        // === 요약 (SUMMARIZATION) ===
        @JsonProperty("summary")
        private SummaryResult summary;

        // === 주제 분류 (TOPIC_CLASSIFICATION) ===
        @JsonProperty("topics")
        private TopicsResult topics;

        // === 커뮤니티 분석 (COMMUNITY) ===
        @JsonProperty("discussion")
        private DiscussionResult discussion;

        // === 독성 분석 (TOXICITY) ===
        @JsonProperty("toxicity")
        private ToxicityResult toxicity;

        // === 허위정보 탐지 (MISINFORMATION) ===
        @JsonProperty("misinformation")
        private MisinfoResult misinformation;

        // === 원시 결과 (구조화되지 않은 추가 데이터) ===
        @JsonProperty("raw")
        private Map<String, Object> raw;
    }

    // ========== 개별 결과 타입들 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SentimentResult {
        private Double score; // -1 ~ 1 or 0 ~ 100
        private String label; // positive, negative, neutral
        private Map<String, Double> distribution;
        private Map<String, Double> emotions; // anger, joy, sadness, etc.
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ReliabilityResult {
        private Double score; // 0 ~ 100
        private String grade; // high, medium, low
        private Map<String, Double> factors;
        private List<String> warnings;
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BiasResult {
        private String label; // left, right, center
        private Double score; // -1 ~ 1
        private Map<String, Double> details;
        private List<String> explanations;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class FactcheckResult {
        private String status; // verified, suspicious, conflicting, unverified
        private Double confidence;
        private List<ClaimVerification> claims;
        private List<String> sources;
        private String notes;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ClaimVerification {
        private String claim;
        private Boolean verified;
        private Double confidence;
        private List<String> supportingSources;
        private List<String> conflictingSources;
        private String verdict;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EntitiesResult {
        private List<Entity> persons;
        private List<Entity> organizations;
        private List<Entity> locations;
        private List<Entity> misc;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Entity {
        private String text;
        private String type;
        private Integer startPos;
        private Integer endPos;
        private Double confidence;
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SummaryResult {
        @JsonProperty("abstractive")
        private String abstractiveSummary;
        @JsonProperty("extractive")
        private List<String> extractiveSentences;
        private List<String> keyPoints;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TopicsResult {
        private List<String> labels;
        private Map<String, Double> scores;
        private String primaryTopic;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DiscussionResult {
        @JsonProperty("overall_sentiment")
        private String overallSentiment;
        @JsonProperty("sentiment_distribution")
        private Map<String, Double> sentimentDistribution;
        @JsonProperty("stance_distribution")
        private Map<String, Double> stanceDistribution;
        @JsonProperty("toxicity_score")
        private Double toxicityScore;
        @JsonProperty("top_keywords")
        private List<Map<String, Object>> topKeywords;
        @JsonProperty("time_series")
        private List<Map<String, Object>> timeSeries;
        @JsonProperty("bot_likelihood")
        private Double botLikelihood;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ToxicityResult {
        private Double score;
        private Map<String, Double> categories; // hate, threat, insult, etc.
        private List<String> flaggedPhrases;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MisinfoResult {
        @JsonProperty("risk_level")
        private String riskLevel; // low, mid, high
        private Double score;
        private List<String> indicators;
        private List<String> explanations;
    }

    // ========== 에러/메타 ==========

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ErrorInfo {
        private String code;
        private String message;
        private String details;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ResponseMeta {
        @JsonProperty("model_version")
        private String modelVersion;

        @JsonProperty("latency_ms")
        private Long latencyMs;

        @JsonProperty("processed_at")
        private String processedAt;

        @JsonProperty("token_usage")
        private Map<String, Integer> tokenUsage;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/llm/LlmProviderSettingsDto.java

```java
package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * LLM Provider 설정 응답 DTO.
 * API 키는 마스킹되어 반환됨.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettingsDto {

    private Long id;

    /**
     * Provider 타입
     */
    private LlmProviderType providerType;

    /**
     * Provider 표시명
     */
    private String providerDisplayName;

    /**
     * 사용자 ID (null이면 전역 설정)
     */
    private String userId;

    /**
     * 전역 설정 여부
     */
    private Boolean isGlobal;

    /**
     * 마스킹된 API 키 (예: sk-a***...xyz)
     */
    private String apiKeyMasked;

    /**
     * API 키 존재 여부
     */
    private Boolean hasApiKey;

    /**
     * 기본 모델
     */
    private String defaultModel;

    /**
     * Base URL
     */
    private String baseUrl;

    /**
     * 활성화 여부
     */
    private Boolean enabled;

    /**
     * 우선순위
     */
    private Integer priority;

    /**
     * 최대 토큰
     */
    private Integer maxTokens;

    /**
     * Temperature
     */
    private Double temperature;

    /**
     * 타임아웃 (ms)
     */
    private Integer timeoutMs;

    /**
     * 분당 최대 요청 수
     */
    private Integer maxRequestsPerMinute;

    /**
     * Azure Deployment Name
     */
    private String azureDeploymentName;

    /**
     * Azure API Version
     */
    private String azureApiVersion;

    /**
     * 마지막 테스트 시간
     */
    private LocalDateTime lastTestedAt;

    /**
     * 마지막 테스트 성공 여부
     */
    private Boolean lastTestSuccess;

    /**
     * 생성일시
     */
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    private LocalDateTime updatedAt;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/llm/LlmProviderSettingsRequest.java

```java
package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * LLM Provider 설정 요청 DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettingsRequest {

    /**
     * Provider 타입 (필수)
     */
    @NotNull(message = "Provider type is required")
    private LlmProviderType providerType;

    /**
     * API 키
     */
    private String apiKey;

    /**
     * 기본 모델명
     */
    private String defaultModel;

    /**
     * Base URL (커스텀 엔드포인트용)
     */
    private String baseUrl;

    /**
     * 활성화 여부
     */
    private Boolean enabled;

    /**
     * 우선순위 (1-999)
     */
    @Min(value = 1, message = "Priority must be at least 1")
    @Max(value = 999, message = "Priority must be at most 999")
    private Integer priority;

    /**
     * 최대 토큰 수
     */
    @Min(value = 1, message = "Max tokens must be positive")
    @Max(value = 128000, message = "Max tokens must be at most 128000")
    private Integer maxTokens;

    /**
     * Temperature (0.0 ~ 2.0)
     */
    @Min(value = 0, message = "Temperature must be at least 0")
    @Max(value = 2, message = "Temperature must be at most 2")
    private Double temperature;

    /**
     * 요청 타임아웃 (밀리초)
     */
    @Min(value = 1000, message = "Timeout must be at least 1000ms")
    @Max(value = 300000, message = "Timeout must be at most 300000ms")
    private Integer timeoutMs;

    /**
     * 분당 최대 요청 수
     */
    @Min(value = 1, message = "Max requests per minute must be positive")
    private Integer maxRequestsPerMinute;

    /**
     * Azure Deployment Name
     */
    private String azureDeploymentName;

    /**
     * Azure API Version
     */
    private String azureApiVersion;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/llm/LlmTestResult.java

```java
package com.newsinsight.collector.dto.llm;

import com.newsinsight.collector.entity.settings.LlmProviderType;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * LLM Provider 연결 테스트 결과 DTO.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmTestResult {

    /**
     * 테스트 성공 여부
     */
    private boolean success;

    /**
     * Provider 타입
     */
    private LlmProviderType providerType;

    /**
     * 결과 메시지
     */
    private String message;

    /**
     * 에러 메시지 (실패 시)
     */
    private String error;

    /**
     * 응답 시간 (밀리초)
     */
    private Long responseTime;

    /**
     * 사용 가능한 모델 목록 (성공 시)
     */
    private java.util.List<String> availableModels;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/report/ChartData.java

```java
package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 차트 데이터 DTO - 서버 사이드 차트 생성용
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChartData {

    /**
     * 차트 유형
     */
    private ChartType chartType;

    /**
     * 차트 제목
     */
    private String title;

    /**
     * X축 라벨
     */
    private String xAxisLabel;

    /**
     * Y축 라벨
     */
    private String yAxisLabel;

    /**
     * 데이터 라벨 목록
     */
    private List<String> labels;

    /**
     * 데이터 값 목록
     */
    private List<Number> values;

    /**
     * 다중 시리즈 데이터
     */
    private List<DataSeries> series;

    /**
     * 색상 팔레트
     */
    private List<String> colors;

    /**
     * 차트 너비 (픽셀)
     */
    @Builder.Default
    private int width = 600;

    /**
     * 차트 높이 (픽셀)
     */
    @Builder.Default
    private int height = 400;

    /**
     * 차트 유형 Enum
     */
    public enum ChartType {
        PIE,            // 파이 차트
        DOUGHNUT,       // 도넛 차트
        BAR,            // 바 차트
        HORIZONTAL_BAR, // 수평 바 차트
        LINE,           // 라인 차트
        AREA,           // 영역 차트
        RADAR,          // 레이더 차트
        GAUGE,          // 게이지 차트
        STACKED_BAR,    // 스택 바 차트
        HISTOGRAM       // 히스토그램
    }

    /**
     * 데이터 시리즈 (다중 라인/바 차트용)
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DataSeries {
        private String name;
        private List<Number> data;
        private String color;
    }

    // ===== 빌더 헬퍼 메서드 =====

    /**
     * 파이 차트 생성 헬퍼
     */
    public static ChartData pie(String title, List<String> labels, List<Number> values, List<String> colors) {
        return ChartData.builder()
                .chartType(ChartType.PIE)
                .title(title)
                .labels(labels)
                .values(values)
                .colors(colors)
                .build();
    }

    /**
     * 바 차트 생성 헬퍼
     */
    public static ChartData bar(String title, String xLabel, String yLabel, List<String> labels, List<Number> values) {
        return ChartData.builder()
                .chartType(ChartType.BAR)
                .title(title)
                .xAxisLabel(xLabel)
                .yAxisLabel(yLabel)
                .labels(labels)
                .values(values)
                .build();
    }

    /**
     * 라인 차트 생성 헬퍼
     */
    public static ChartData line(String title, String xLabel, String yLabel, List<String> labels, List<DataSeries> series) {
        return ChartData.builder()
                .chartType(ChartType.LINE)
                .title(title)
                .xAxisLabel(xLabel)
                .yAxisLabel(yLabel)
                .labels(labels)
                .series(series)
                .build();
    }

    /**
     * 게이지 차트 생성 헬퍼
     */
    public static ChartData gauge(String title, double value, double min, double max) {
        return ChartData.builder()
                .chartType(ChartType.GAUGE)
                .title(title)
                .values(List.of(value, min, max))
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/report/ReportMetadata.java

```java
package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 생성된 보고서 메타데이터 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportMetadata {

    /**
     * 보고서 고유 ID
     */
    private String reportId;

    /**
     * 보고서 제목
     */
    private String title;

    /**
     * 보고서 유형
     */
    private ReportRequest.ReportType reportType;

    /**
     * 대상 ID (jobId 또는 articleId)
     */
    private String targetId;

    /**
     * 검색 쿼리
     */
    private String query;

    /**
     * 생성 상태: PENDING, GENERATING, COMPLETED, FAILED
     */
    private ReportStatus status;

    /**
     * 파일 크기 (bytes)
     */
    private Long fileSize;

    /**
     * 페이지 수
     */
    private Integer pageCount;

    /**
     * 생성 소요 시간 (ms)
     */
    private Long generationTimeMs;

    /**
     * 생성 일시
     */
    private LocalDateTime createdAt;

    /**
     * 만료 일시 (자동 삭제 예정)
     */
    private LocalDateTime expiresAt;

    /**
     * 다운로드 URL
     */
    private String downloadUrl;

    /**
     * 에러 메시지 (실패 시)
     */
    private String errorMessage;

    /**
     * 보고서 상태 Enum
     */
    public enum ReportStatus {
        PENDING,
        GENERATING,
        COMPLETED,
        FAILED,
        EXPIRED
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/dto/report/ReportRequest.java

```java
package com.newsinsight.collector.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * PDF 보고서 생성 요청 DTO
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReportRequest {

    /**
     * 보고서 유형: UNIFIED_SEARCH, DEEP_SEARCH, ML_ANALYSIS
     */
    private ReportType reportType;

    /**
     * 관련 Job ID 또는 Article ID
     */
    private String targetId;

    /**
     * 검색 쿼리 (통합검색, DeepSearch용)
     */
    private String query;

    /**
     * 시간 범위 (1d, 7d, 30d)
     */
    private String timeWindow;

    /**
     * 포함할 섹션 목록
     */
    @Builder.Default
    private List<ReportSection> includeSections = List.of(ReportSection.values());

    /**
     * 프론트엔드에서 생성한 차트 이미지 (Base64)
     */
    private Map<String, String> chartImages;

    /**
     * 보고서 제목 (커스텀)
     */
    private String customTitle;

    /**
     * 회사 로고 URL 또는 Base64
     */
    private String logoImage;

    /**
     * 워터마크 텍스트
     */
    private String watermark;

    /**
     * 언어 설정 (ko, en)
     */
    @Builder.Default
    private String language = "ko";

    /**
     * 보고서 유형 Enum
     */
    public enum ReportType {
        UNIFIED_SEARCH,
        DEEP_SEARCH,
        ML_ANALYSIS,
        ARTICLE_DETAIL
    }

    /**
     * 보고서 섹션 Enum
     */
    public enum ReportSection {
        COVER,              // 표지
        EXECUTIVE_SUMMARY,  // 요약
        DATA_SOURCE,        // 데이터 소스 분석
        TREND_ANALYSIS,     // 시간별 트렌드
        KEYWORD_ANALYSIS,   // 키워드 분석
        SENTIMENT_ANALYSIS, // 감정 분석
        RELIABILITY,        // 신뢰도 분석
        BIAS_ANALYSIS,      // 편향성 분석
        FACTCHECK,          // 팩트체크
        EVIDENCE_LIST,      // 증거 목록
        DETAILED_RESULTS    // 상세 결과
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/BrowserAgentConfig.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Configuration for browser-based AI agent exploration.
 * Embedded in DataSource for BROWSER_AGENT source type.
 * 
 * autonomous-crawler-service의 BrowserTaskMessage와 매핑됩니다.
 */
@Embeddable
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BrowserAgentConfig {

    /**
     * Maximum depth of link traversal from seed URL.
     * 0 = seed page only, 1 = seed + direct links, etc.
     */
    @Column(name = "agent_max_depth")
    @Builder.Default
    private Integer maxDepth = 2;

    /**
     * Maximum number of pages to visit in a single session.
     */
    @Column(name = "agent_max_pages")
    @Builder.Default
    private Integer maxPages = 50;

    /**
     * Maximum time budget for exploration in seconds.
     */
    @Column(name = "agent_budget_seconds")
    @Builder.Default
    private Integer budgetSeconds = 300; // 5 minutes

    /**
     * Exploration behavior policy.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "agent_policy", length = 50)
    @Builder.Default
    private BrowserAgentPolicy policy = BrowserAgentPolicy.FOCUSED_TOPIC;

    /**
     * Keywords or topics for focused exploration.
     * Comma-separated list.
     */
    @Column(name = "agent_focus_keywords", columnDefinition = "TEXT")
    private String focusKeywords;

    /**
     * Custom prompt/instructions for the AI agent.
     */
    @Column(name = "agent_custom_prompt", columnDefinition = "TEXT")
    private String customPrompt;

    /**
     * Whether to capture screenshots during exploration.
     */
    @Column(name = "agent_capture_screenshots")
    @Builder.Default
    private Boolean captureScreenshots = false;

    /**
     * Whether to extract structured data (tables, lists).
     */
    @Column(name = "agent_extract_structured")
    @Builder.Default
    private Boolean extractStructured = true;

    /**
     * Domains to exclude from exploration.
     * Comma-separated list.
     */
    @Column(name = "agent_excluded_domains", columnDefinition = "TEXT")
    private String excludedDomains;

    // ========================================
    // 기본 프리셋 팩토리 메서드
    // ========================================

    /**
     * Create default config for news exploration.
     * 일반적인 뉴스 기사 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forNewsExploration() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(30)
                .budgetSeconds(180)
                .policy(BrowserAgentPolicy.NEWS_ONLY)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for deep single-page extraction.
     * 단일 페이지에서 상세 정보 추출에 적합한 설정.
     */
    public static BrowserAgentConfig forSinglePageExtraction() {
        return BrowserAgentConfig.builder()
                .maxDepth(0)
                .maxPages(1)
                .budgetSeconds(60)
                .policy(BrowserAgentPolicy.SINGLE_PAGE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    // ========================================
    // 뉴스 특화 프리셋 팩토리 메서드 (신규)
    // ========================================

    /**
     * Create config for breaking news monitoring.
     * 속보/긴급 뉴스 우선 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forBreakingNews() {
        return BrowserAgentConfig.builder()
                .maxDepth(1)
                .maxPages(20)
                .budgetSeconds(120)
                .policy(BrowserAgentPolicy.NEWS_BREAKING)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for news archive exploration.
     * 과거 기사 아카이브 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forNewsArchive() {
        return BrowserAgentConfig.builder()
                .maxDepth(3)
                .maxPages(100)
                .budgetSeconds(600) // 10분
                .policy(BrowserAgentPolicy.NEWS_ARCHIVE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for opinion/editorial collection.
     * 오피니언/칼럼/사설 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forOpinionContent() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(30)
                .budgetSeconds(180)
                .policy(BrowserAgentPolicy.NEWS_OPINION)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for local news collection.
     * 지역 뉴스 수집에 적합한 설정.
     */
    public static BrowserAgentConfig forLocalNews() {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(40)
                .budgetSeconds(240)
                .policy(BrowserAgentPolicy.NEWS_LOCAL)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for topic-focused news collection.
     * 특정 키워드/토픽 중심 수집에 적합한 설정.
     * 
     * @param keywords Comma-separated focus keywords
     */
    public static BrowserAgentConfig forFocusedTopic(String keywords) {
        return BrowserAgentConfig.builder()
                .maxDepth(2)
                .maxPages(50)
                .budgetSeconds(300)
                .policy(BrowserAgentPolicy.FOCUSED_TOPIC)
                .focusKeywords(keywords)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    /**
     * Create config for domain-wide exploration.
     * 전체 도메인 탐색에 적합한 설정.
     */
    public static BrowserAgentConfig forDomainExploration() {
        return BrowserAgentConfig.builder()
                .maxDepth(3)
                .maxPages(100)
                .budgetSeconds(600)
                .policy(BrowserAgentPolicy.DOMAIN_WIDE)
                .extractStructured(true)
                .captureScreenshots(false)
                .build();
    }

    // ========================================
    // 유틸리티 메서드
    // ========================================

    /**
     * Create a copy of this config with a different policy.
     * 
     * @param newPolicy The new policy to use
     * @return A new BrowserAgentConfig with the updated policy
     */
    public BrowserAgentConfig withPolicy(BrowserAgentPolicy newPolicy) {
        return BrowserAgentConfig.builder()
                .maxDepth(this.maxDepth)
                .maxPages(this.maxPages)
                .budgetSeconds(this.budgetSeconds)
                .policy(newPolicy)
                .focusKeywords(this.focusKeywords)
                .customPrompt(this.customPrompt)
                .captureScreenshots(this.captureScreenshots)
                .extractStructured(this.extractStructured)
                .excludedDomains(this.excludedDomains)
                .build();
    }

    /**
     * Check if this config uses a news-focused policy.
     * 
     * @return true if the policy is news-focused
     */
    public boolean isNewsFocused() {
        return policy != null && policy.isNewsFocused();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/BrowserAgentPolicy.java

```java
package com.newsinsight.collector.entity;

/**
 * Policy for browser agent autonomous exploration behavior.
 * 
 * 이 enum은 autonomous-crawler-service의 CrawlPolicy와 1:1 매핑됩니다.
 * Python: src/crawler/policies.py의 CrawlPolicy enum
 */
public enum BrowserAgentPolicy {
    // ========================================
    // 기본 정책
    // ========================================
    
    /**
     * Focus on specific topic/keywords only.
     * Agent will prioritize links containing relevant keywords.
     */
    FOCUSED_TOPIC("focused_topic"),
    
    /**
     * Explore within the same domain broadly.
     * Agent will visit multiple pages within the seed domain.
     */
    DOMAIN_WIDE("domain_wide"),
    
    /**
     * Focus on news articles only.
     * Agent will identify and prioritize news content patterns.
     */
    NEWS_ONLY("news_only"),
    
    /**
     * Follow links to external domains as well.
     * Agent can navigate to linked external sites.
     */
    CROSS_DOMAIN("cross_domain"),
    
    /**
     * Minimal exploration - only the seed URL.
     * Useful for single-page deep extraction.
     */
    SINGLE_PAGE("single_page"),
    
    // ========================================
    // 뉴스 특화 정책 (신규)
    // ========================================
    
    /**
     * Priority collection of breaking news and urgent updates.
     * Agent focuses on articles marked as 속보, Breaking, 긴급, 단독.
     */
    NEWS_BREAKING("news_breaking"),
    
    /**
     * Historical article collection from archives.
     * Agent navigates through pagination and older content.
     */
    NEWS_ARCHIVE("news_archive"),
    
    /**
     * Focus on opinion pieces, editorials, and columns.
     * Agent targets 오피니언, 칼럼, 사설 sections.
     */
    NEWS_OPINION("news_opinion"),
    
    /**
     * Local and regional news collection.
     * Agent focuses on geographically specific news content.
     */
    NEWS_LOCAL("news_local");

    private final String value;

    BrowserAgentPolicy(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Convert string value to enum.
     * 
     * @param value The policy value string (e.g., "news_only", "news_breaking")
     * @return The corresponding BrowserAgentPolicy
     * @throws IllegalArgumentException if the value is not recognized
     */
    public static BrowserAgentPolicy fromValue(String value) {
        if (value == null || value.isBlank()) {
            return NEWS_ONLY; // Default fallback
        }
        for (BrowserAgentPolicy policy : BrowserAgentPolicy.values()) {
            if (policy.value.equalsIgnoreCase(value)) {
                return policy;
            }
        }
        throw new IllegalArgumentException("Unknown browser agent policy: " + value);
    }
    
    /**
     * Check if this policy is a news-specific policy.
     * 
     * @return true if this is a news-focused policy
     */
    public boolean isNewsFocused() {
        return this == NEWS_ONLY || this == NEWS_BREAKING || 
               this == NEWS_ARCHIVE || this == NEWS_OPINION || this == NEWS_LOCAL;
    }
    
    /**
     * Check if this policy supports multi-page crawling.
     * 
     * @return true if the policy allows visiting multiple pages
     */
    public boolean supportsMultiPage() {
        return this != SINGLE_PAGE;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CollectedData.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

@Entity
@Table(name = "collected_data", indexes = {
    @Index(name = "idx_source_id", columnList = "source_id"),
    @Index(name = "idx_content_hash", columnList = "content_hash"),
    @Index(name = "idx_processed", columnList = "processed"),
    @Index(name = "idx_collected_at", columnList = "collected_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectedData {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_id", nullable = false)
    private Long sourceId;

    @Column(name = "title", columnDefinition = "TEXT")
    private String title;

    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    @Column(name = "url", columnDefinition = "TEXT")
    private String url;

    @Column(name = "published_date")
    private LocalDateTime publishedDate;

    @CreationTimestamp
    @Column(name = "collected_at", nullable = false, updatable = false)
    private LocalDateTime collectedAt;

    @Column(name = "content_hash", length = 64)
    private String contentHash;

    @Column(name = "metadata_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String metadataJson;

    @Column(name = "processed", nullable = false)
    @Builder.Default
    private Boolean processed = false;

    // QA pipeline results
    @Column(name = "http_ok")
    private Boolean httpOk;

    @Column(name = "has_content")
    private Boolean hasContent;

    @Column(name = "duplicate")
    private Boolean duplicate;

    @Column(name = "normalized")
    private Boolean normalized;

    @Column(name = "quality_score")
    private Double qualityScore;

    @Column(name = "semantic_consistency")
    private Double semanticConsistency;

    @Column(name = "outlier_score")
    private Double outlierScore;

    @Column(name = "trust_score")
    private Double trustScore;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CollectionJob.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "collection_jobs", indexes = {
    @Index(name = "idx_source_id", columnList = "source_id"),
    @Index(name = "idx_status", columnList = "status"),
    @Index(name = "idx_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectionJob {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_id", nullable = false)
    private Long sourceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 50)
    @Builder.Default
    private JobStatus status = JobStatus.PENDING;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "items_collected", nullable = false)
    @Builder.Default
    private Integer itemsCollected = 0;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    public enum JobStatus {
        PENDING,
        RUNNING,
        COMPLETED,
        FAILED,
        CANCELLED
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlEvidence.java

```java
package com.newsinsight.collector.entity;

import com.newsinsight.collector.dto.EvidenceDto;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Entity representing a piece of evidence collected by the deep AI search.
 * Each evidence item contains a URL, stance classification, and content snippet.
 */
@Entity
@Table(name = "crawl_evidence", indexes = {
        @Index(name = "idx_crawl_evidence_job_id", columnList = "job_id"),
        @Index(name = "idx_crawl_evidence_stance", columnList = "stance")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_id", nullable = false, length = 64)
    private String jobId;

    @Column(length = 2048)
    private String url;

    @Column(length = 512)
    private String title;

    /**
     * Stance classification: pro, con, or neutral
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private EvidenceStance stance;

    @Column(columnDefinition = "TEXT")
    private String snippet;

    @Column(length = 255)
    private String source;

    /**
     * Source category: news, community, blog, official, academic
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "source_category", length = 32)
    private SourceCategory sourceCategory;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * Create evidence from EvidenceDto
     */
    public static CrawlEvidence fromEvidenceDto(String jobId, EvidenceDto evidence) {
        EvidenceStance stance = EvidenceStance.NEUTRAL;
        if (evidence.getStance() != null) {
            try {
                stance = EvidenceStance.valueOf(evidence.getStance().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // Keep default NEUTRAL
            }
        }

        // Infer source category from URL domain
        SourceCategory category = SourceCategory.NEWS;
        if (evidence.getUrl() != null) {
            try {
                java.net.URI uri = java.net.URI.create(evidence.getUrl());
                category = SourceCategory.inferFromDomain(uri.getHost());
            } catch (Exception ignored) {
                // Keep default NEWS
            }
        }

        return CrawlEvidence.builder()
                .jobId(jobId)
                .url(evidence.getUrl())
                .title(evidence.getTitle())
                .stance(stance)
                .snippet(evidence.getSnippet())
                .source(evidence.getSource())
                .sourceCategory(category)
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlFailureReason.java

```java
package com.newsinsight.collector.entity;

/**
 * Enum representing specific timeout/failure reasons for deep search jobs.
 * Used for diagnostic logging and monitoring dashboards.
 */
public enum CrawlFailureReason {
    // Timeout reasons
    TIMEOUT_INTEGRATED_CRAWLER("timeout_integrated_crawler", "Integrated crawler exceeded time limit"),
    TIMEOUT_CRAWL4AI("timeout_crawl4ai", "Crawl4AI service timeout"),
    TIMEOUT_BROWSER_USE("timeout_browser_use", "Browser-Use API timeout"),
    TIMEOUT_AIDOVE("timeout_aidove", "AI Dove analysis timeout"),
    TIMEOUT_JOB_OVERALL("timeout_job_overall", "Overall job timeout exceeded"),
    TIMEOUT_HTTP_REQUEST("timeout_http_request", "HTTP request timeout"),
    TIMEOUT_POLLING("timeout_polling", "Polling timeout for async result"),

    // Connection/Network errors
    CONNECTION_REFUSED("connection_refused", "Connection refused by remote service"),
    CONNECTION_TIMEOUT("connection_timeout", "Connection establishment timeout"),
    DNS_RESOLUTION_FAILED("dns_resolution_failed", "DNS resolution failed"),
    NETWORK_UNREACHABLE("network_unreachable", "Network unreachable"),
    SSL_HANDSHAKE_FAILED("ssl_handshake_failed", "SSL handshake failed"),

    // Service errors
    SERVICE_UNAVAILABLE("service_unavailable", "External service unavailable"),
    SERVICE_OVERLOADED("service_overloaded", "Service overloaded, rate limited"),
    SERVICE_ERROR("service_error", "External service returned error"),
    CRAWL4AI_UNAVAILABLE("crawl4ai_unavailable", "Crawl4AI service not available"),
    BROWSER_USE_UNAVAILABLE("browser_use_unavailable", "Browser-Use service not available"),
    AIDOVE_UNAVAILABLE("aidove_unavailable", "AI Dove service not available"),

    // Content/Parsing errors
    EMPTY_CONTENT("empty_content", "No content extracted from pages"),
    PARSE_ERROR("parse_error", "Failed to parse response"),
    INVALID_URL("invalid_url", "Invalid URL provided"),
    BLOCKED_BY_ROBOTS("blocked_by_robots", "Blocked by robots.txt"),
    BLOCKED_BY_CAPTCHA("blocked_by_captcha", "Blocked by CAPTCHA"),
    CONTENT_TOO_LARGE("content_too_large", "Content too large to process"),

    // Processing errors
    AI_ANALYSIS_FAILED("ai_analysis_failed", "AI analysis/extraction failed"),
    EVIDENCE_EXTRACTION_FAILED("evidence_extraction_failed", "Evidence extraction failed"),
    STANCE_ANALYSIS_FAILED("stance_analysis_failed", "Stance analysis failed"),
    
    // Job management errors
    JOB_CANCELLED("job_cancelled", "Job was cancelled"),
    DUPLICATE_CALLBACK("duplicate_callback", "Duplicate callback received"),
    INVALID_CALLBACK_TOKEN("invalid_callback_token", "Invalid callback token"),

    // Unknown/Other
    UNKNOWN("unknown", "Unknown error occurred");

    private final String code;
    private final String description;

    CrawlFailureReason(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public String getCode() {
        return code;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Get failure reason from exception message
     */
    public static CrawlFailureReason fromException(Throwable e) {
        if (e == null) return UNKNOWN;
        
        String message = e.getMessage() != null ? e.getMessage().toLowerCase() : "";
        String className = e.getClass().getSimpleName().toLowerCase();
        
        // Timeout detection
        if (className.contains("timeout") || message.contains("timeout") || message.contains("timed out")) {
            if (message.contains("crawl4ai")) return TIMEOUT_CRAWL4AI;
            if (message.contains("browser") || message.contains("browser-use")) return TIMEOUT_BROWSER_USE;
            if (message.contains("aidove") || message.contains("ai dove") || message.contains("dove")) return TIMEOUT_AIDOVE;
            if (message.contains("connect")) return CONNECTION_TIMEOUT;
            if (message.contains("poll")) return TIMEOUT_POLLING;
            return TIMEOUT_HTTP_REQUEST;
        }
        
        // Connection errors
        if (message.contains("connection refused") || className.contains("connectexception")) {
            return CONNECTION_REFUSED;
        }
        if (message.contains("dns") || message.contains("unknown host") || message.contains("unresolved")) {
            return DNS_RESOLUTION_FAILED;
        }
        if (message.contains("ssl") || message.contains("certificate") || message.contains("tls")) {
            return SSL_HANDSHAKE_FAILED;
        }
        if (message.contains("network") || message.contains("unreachable")) {
            return NETWORK_UNREACHABLE;
        }
        
        // Service errors
        if (message.contains("503") || message.contains("service unavailable")) {
            return SERVICE_UNAVAILABLE;
        }
        if (message.contains("429") || message.contains("rate limit") || message.contains("too many requests")) {
            return SERVICE_OVERLOADED;
        }
        if (message.contains("500") || message.contains("internal server error")) {
            return SERVICE_ERROR;
        }
        
        // Content errors
        if (message.contains("empty") && (message.contains("content") || message.contains("response"))) {
            return EMPTY_CONTENT;
        }
        if (message.contains("parse") || message.contains("json") || message.contains("malformed")) {
            return PARSE_ERROR;
        }
        if (message.contains("captcha")) {
            return BLOCKED_BY_CAPTCHA;
        }
        if (message.contains("robots")) {
            return BLOCKED_BY_ROBOTS;
        }
        
        return UNKNOWN;
    }

    /**
     * Get failure reason from error message string
     */
    public static CrawlFailureReason fromErrorMessage(String errorMessage) {
        if (errorMessage == null || errorMessage.isBlank()) return UNKNOWN;
        
        String message = errorMessage.toLowerCase();
        
        // Match specific codes first
        for (CrawlFailureReason reason : values()) {
            if (message.contains(reason.code)) {
                return reason;
            }
        }
        
        // Fallback to pattern matching
        if (message.contains("timeout")) {
            if (message.contains("crawl4ai")) return TIMEOUT_CRAWL4AI;
            if (message.contains("browser")) return TIMEOUT_BROWSER_USE;
            if (message.contains("aidove") || message.contains("dove")) return TIMEOUT_AIDOVE;
            if (message.contains("overall") || message.contains("job")) return TIMEOUT_JOB_OVERALL;
            return TIMEOUT_HTTP_REQUEST;
        }
        
        if (message.contains("cancelled") || message.contains("canceled")) {
            return JOB_CANCELLED;
        }
        
        if (message.contains("unavailable")) {
            if (message.contains("crawl4ai")) return CRAWL4AI_UNAVAILABLE;
            if (message.contains("browser")) return BROWSER_USE_UNAVAILABLE;
            if (message.contains("aidove")) return AIDOVE_UNAVAILABLE;
            return SERVICE_UNAVAILABLE;
        }
        
        return UNKNOWN;
    }

    @Override
    public String toString() {
        return code;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlJob.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Entity representing a deep AI search job.
 * Tracks the status and metadata of asynchronous crawl agent requests.
 */
@Entity
@Table(name = "crawl_jobs", indexes = {
        @Index(name = "idx_crawl_jobs_status", columnList = "status"),
        @Index(name = "idx_crawl_jobs_topic", columnList = "topic"),
        @Index(name = "idx_crawl_jobs_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlJob {

    @Id
    @Column(length = 64)
    private String id;

    @Column(nullable = false, length = 512)
    private String topic;

    @Column(name = "base_url", length = 2048)
    private String baseUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    @Builder.Default
    private CrawlJobStatus status = CrawlJobStatus.PENDING;

    @Column(name = "evidence_count")
    @Builder.Default
    private Integer evidenceCount = 0;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_reason", length = 64)
    private CrawlFailureReason failureReason;

    @Column(name = "callback_received")
    @Builder.Default
    private Boolean callbackReceived = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark the job as completed successfully
     */
    public void markCompleted(int evidenceCount) {
        this.status = CrawlJobStatus.COMPLETED;
        this.evidenceCount = evidenceCount;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as failed
     */
    public void markFailed(String errorMessage) {
        markFailed(errorMessage, CrawlFailureReason.fromErrorMessage(errorMessage));
    }

    /**
     * Mark the job as failed with a specific failure reason
     */
    public void markFailed(String errorMessage, CrawlFailureReason failureReason) {
        this.status = CrawlJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.failureReason = failureReason;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as failed from an exception
     */
    public void markFailedFromException(Throwable e) {
        CrawlFailureReason reason = CrawlFailureReason.fromException(e);
        String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        markFailed(message, reason);
    }

    /**
     * Mark the job as timed out with a specific reason
     */
    public void markTimedOut(CrawlFailureReason timeoutReason) {
        this.status = CrawlJobStatus.TIMEOUT;
        this.errorMessage = timeoutReason.getDescription();
        this.failureReason = timeoutReason;
        this.completedAt = LocalDateTime.now();
        this.callbackReceived = true;
    }

    /**
     * Mark the job as in progress
     */
    public void markInProgress() {
        this.status = CrawlJobStatus.IN_PROGRESS;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/CrawlJobStatus.java

```java
package com.newsinsight.collector.entity;

/**
 * Status of a deep AI search crawl job
 */
public enum CrawlJobStatus {
    /**
     * Job has been created but not yet started
     */
    PENDING,

    /**
     * Job is currently being processed by n8n workflow
     */
    IN_PROGRESS,

    /**
     * Job completed successfully with evidence
     */
    COMPLETED,

    /**
     * Job failed due to an error
     */
    FAILED,

    /**
     * Job was cancelled before completion
     */
    CANCELLED,

    /**
     * Job timed out waiting for callback
     */
    TIMEOUT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/DataSource.java

```java
package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

@Entity
@Table(name = "data_sources", indexes = {
    @Index(name = "idx_source_type", columnList = "source_type"),
    @Index(name = "idx_is_active", columnList = "is_active")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DataSource {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "url", nullable = false, columnDefinition = "TEXT")
    private String url;

    @Enumerated(EnumType.STRING)
    @Column(name = "source_type", nullable = false, length = 50)
    private SourceType sourceType;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private Boolean isActive = true;

    @Column(name = "last_collected")
    private LocalDateTime lastCollected;

    @Column(name = "collection_frequency", nullable = false)
    @Builder.Default
    private Integer collectionFrequency = 3600; // seconds

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata_json", columnDefinition = "jsonb")
    private String metadataJson;

    /**
     * Search URL template for web search sources.
     * Use {query} as placeholder for the encoded search query.
     * Example: "https://search.naver.com/search.naver?where=news&query={query}"
     * Only applicable when sourceType = WEB_SEARCH.
     */
    @Column(name = "search_url_template", columnDefinition = "TEXT")
    private String searchUrlTemplate;

    /**
     * Priority for web search sources (lower = higher priority).
     * Used for ordering when selecting search sources.
     */
    @Column(name = "search_priority")
    @Builder.Default
    private Integer searchPriority = 100;

    /**
     * Browser agent configuration.
     * Only applicable when sourceType = BROWSER_AGENT.
     */
    @Embedded
    private BrowserAgentConfig browserAgentConfig;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Check if this source requires browser-based collection.
     */
    public boolean requiresBrowserAgent() {
        return sourceType != null && sourceType.requiresBrowser();
    }

    /**
     * Get browser agent config, creating default if null and source type requires it.
     */
    public BrowserAgentConfig getEffectiveBrowserAgentConfig() {
        if (browserAgentConfig != null) {
            return browserAgentConfig;
        }
        if (requiresBrowserAgent()) {
            return BrowserAgentConfig.forNewsExploration();
        }
        return null;
    }

    /**
     * Check if this source supports web search.
     */
    public boolean supportsWebSearch() {
        return sourceType == SourceType.WEB_SEARCH && searchUrlTemplate != null && !searchUrlTemplate.isBlank();
    }

    /**
     * Generate search URL from template with the given query.
     * 
     * @param encodedQuery URL-encoded search query
     * @return Generated search URL or null if template is not set
     */
    public String buildSearchUrl(String encodedQuery) {
        if (searchUrlTemplate == null || searchUrlTemplate.isBlank()) {
            return null;
        }
        return searchUrlTemplate.replace("{query}", encodedQuery);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/EvidenceStance.java

```java
package com.newsinsight.collector.entity;

/**
 * Stance classification for evidence items.
 * Represents the position of the evidence relative to the search topic.
 */
public enum EvidenceStance {
    /**
     * Evidence supports or is favorable to the topic
     */
    PRO,

    /**
     * Evidence opposes or is unfavorable to the topic
     */
    CON,

    /**
     * Evidence is neutral or balanced
     */
    NEUTRAL
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/SourceCategory.java

```java
package com.newsinsight.collector.entity;

/**
 * Category of data source for distinguishing content origin.
 * 
 * - NEWS: Official news media sources (newspapers, broadcasters, news agencies)
 * - COMMUNITY: Community/forum sources (Reddit, DCInside, Clien, Twitter, etc.)
 * - BLOG: Personal blogs and opinion pieces
 * - OFFICIAL: Official government/organization sources
 * - ACADEMIC: Academic papers and research
 */
public enum SourceCategory {
    NEWS("news", "뉴스"),
    COMMUNITY("community", "커뮤니티"),
    BLOG("blog", "블로그"),
    OFFICIAL("official", "공식"),
    ACADEMIC("academic", "학술");

    private final String value;
    private final String label;

    SourceCategory(String value, String label) {
        this.value = value;
        this.label = label;
    }

    public String getValue() {
        return value;
    }

    public String getLabel() {
        return label;
    }

    /**
     * Check if this category is a primary news source.
     */
    public boolean isPrimarySource() {
        return this == NEWS || this == OFFICIAL || this == ACADEMIC;
    }

    /**
     * Check if this category represents user-generated content.
     */
    public boolean isUserGenerated() {
        return this == COMMUNITY || this == BLOG;
    }

    public static SourceCategory fromValue(String value) {
        if (value == null) return NEWS;
        for (SourceCategory category : SourceCategory.values()) {
            if (category.value.equalsIgnoreCase(value)) {
                return category;
            }
        }
        return NEWS; // Default to NEWS
    }

    /**
     * Infer category from source domain name.
     */
    public static SourceCategory inferFromDomain(String domain) {
        if (domain == null) return NEWS;
        String lowerDomain = domain.toLowerCase();
        
        // Community sites
        if (lowerDomain.contains("reddit.com") ||
            lowerDomain.contains("dcinside.com") ||
            lowerDomain.contains("clien.net") ||
            lowerDomain.contains("ruliweb.com") ||
            lowerDomain.contains("ppomppu.co.kr") ||
            lowerDomain.contains("fmkorea.com") ||
            lowerDomain.contains("mlbpark.donga.com") ||
            lowerDomain.contains("bobaedream.co.kr") ||
            lowerDomain.contains("theqoo.net") ||
            lowerDomain.contains("instiz.net") ||
            lowerDomain.contains("twitter.com") ||
            lowerDomain.contains("x.com") ||
            lowerDomain.contains("threads.net") ||
            lowerDomain.contains("quora.com") ||
            lowerDomain.contains("cafe.naver.com") ||
            lowerDomain.contains("cafe.daum.net")) {
            return COMMUNITY;
        }
        
        // Blog platforms
        if (lowerDomain.contains("blog.naver.com") ||
            lowerDomain.contains("tistory.com") ||
            lowerDomain.contains("brunch.co.kr") ||
            lowerDomain.contains("medium.com") ||
            lowerDomain.contains("velog.io") ||
            lowerDomain.contains("wordpress.com") ||
            lowerDomain.contains("substack.com")) {
            return BLOG;
        }
        
        // Official sources
        if (lowerDomain.contains(".go.kr") ||
            lowerDomain.contains(".gov") ||
            lowerDomain.contains(".mil")) {
            return OFFICIAL;
        }
        
        // Academic sources
        if (lowerDomain.contains("scholar.google") ||
            lowerDomain.contains("arxiv.org") ||
            lowerDomain.contains("pubmed") ||
            lowerDomain.contains("sciencedirect") ||
            lowerDomain.contains("springer.com") ||
            lowerDomain.contains("nature.com") ||
            lowerDomain.contains("ieee.org") ||
            lowerDomain.contains(".edu") ||
            lowerDomain.contains(".ac.kr")) {
            return ACADEMIC;
        }
        
        return NEWS;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/SourceType.java

```java
package com.newsinsight.collector.entity;

/**
 * Types of data sources for collection.
 * 
 * - RSS: RSS/Atom feed parsing (Rome library)
 * - WEB: Static HTML scraping (Crawl4AI/Jsoup)
 * - WEB_SEARCH: Web search portal integration (Naver, Daum, Google, etc.)
 * - API: External API integration (future)
 * - WEBHOOK: Passive event reception (future)
 * - BROWSER_AGENT: AI-driven autonomous browser exploration (Browser-use/Puppeteer)
 */
public enum SourceType {
    RSS("rss"),
    WEB("web"),
    WEB_SEARCH("web_search"),
    API("api"),
    WEBHOOK("webhook"),
    BROWSER_AGENT("browser_agent");

    private final String value;

    SourceType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Check if this source type requires browser-based collection.
     */
    public boolean requiresBrowser() {
        return this == BROWSER_AGENT;
    }

    /**
     * Check if this source type supports autonomous exploration.
     */
    public boolean supportsAutonomousExploration() {
        return this == BROWSER_AGENT;
    }

    /**
     * Check if this source type is for web search portals.
     */
    public boolean isWebSearch() {
        return this == WEB_SEARCH;
    }

    public static SourceType fromValue(String value) {
        for (SourceType type : SourceType.values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown source type: " + value);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonAuthType.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 인증 타입.
 */
public enum AddonAuthType {
    
    /**
     * 인증 없음
     */
    NONE,
    
    /**
     * API Key 인증 (헤더 또는 쿼리 파라미터)
     */
    API_KEY,
    
    /**
     * Bearer Token
     */
    BEARER_TOKEN,
    
    /**
     * Basic Auth
     */
    BASIC,
    
    /**
     * OAuth 2.0
     */
    OAUTH2
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonCategory.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 카테고리 분류.
 * 각 카테고리는 분석 기능의 유형을 나타냄.
 */
public enum AddonCategory {
    
    /**
     * 감정 분석 (긍정/부정/중립)
     */
    SENTIMENT,
    
    /**
     * 문맥/의도 분석 (주제 분류, 스탠스 분석)
     */
    CONTEXT,
    
    /**
     * 팩트체크 (주장 검증, 교차 출처 비교)
     */
    FACTCHECK,
    
    /**
     * 커뮤니티/여론 분석 (댓글, SNS)
     */
    COMMUNITY,
    
    /**
     * 출처 신뢰도/편향도 분석
     */
    SOURCE_QUALITY,

    BIAS,
    
    /**
     * 개체명 인식 (NER)
     */
    ENTITY_EXTRACTION,
    
    /**
     * 요약 생성
     */
    SUMMARIZATION,
    
    /**
     * 주제 분류
     */
    TOPIC_CLASSIFICATION,
    
    /**
     * 독성 댓글 탐지
     */
    TOXICITY,
    
    BOT_DETECTION,
    
    NER,
    
    /**
     * 허위정보 탐지
     */
    MISINFORMATION,
    
    /**
     * 기타 범주
     */
    OTHER
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonHealthStatus.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 헬스체크 상태.
 */
public enum AddonHealthStatus {
    
    /**
     * 정상
     */
    HEALTHY,
    
    /**
     * 불안정 (간헐적 오류)
     */
    DEGRADED,
    
    /**
     * 장애
     */
    UNHEALTHY,
    
    /**
     * 알 수 없음 (아직 체크 안 됨)
     */
    UNKNOWN
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/AddonInvokeType.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 호출 타입.
 */
public enum AddonInvokeType {
    
    /**
     * HTTP 동기 호출 (응답 대기)
     */
    HTTP_SYNC,
    
    /**
     * HTTP 비동기 호출 (웹훅 콜백)
     */
    HTTP_ASYNC,
    
    /**
     * 메시지 큐 기반 (Kafka, RabbitMQ 등)
     */
    QUEUE,
    
    /**
     * 파일/스토리지 폴링 (S3, GCS 등)
     */
    FILE_POLL
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/ExecutionStatus.java

```java
package com.newsinsight.collector.entity.addon;

/**
 * Add-on 실행 상태.
 */
public enum ExecutionStatus {
    
    /**
     * 대기 중 (큐에 있음)
     */
    PENDING,
    
    /**
     * 실행 중
     */
    RUNNING,
    
    /**
     * 성공
     */
    SUCCESS,
    
    /**
     * 실패
     */
    FAILED,
    
    /**
     * 타임아웃
     */
    TIMEOUT,
    
    /**
     * 취소됨
     */
    CANCELLED,
    
    /**
     * 건너뜀 (의존성 실패 등)
     */
    SKIPPED
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/MlAddon.java

```java
package com.newsinsight.collector.entity.addon;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * ML Add-on Registry Entity.
 * 
 * 각 ML 분석 기능(감정분석, 팩트체크, 편향도 분석 등)을 플러그인 형태로 등록/관리.
 * 내부 서비스(Spring/Python), 외부 Colab, 또는 서드파티 API 모두 동일한 방식으로 연결 가능.
 */
@Entity
@Table(name = "ml_addon", indexes = {
    @Index(name = "idx_addon_category", columnList = "category"),
    @Index(name = "idx_addon_enabled", columnList = "enabled"),
    @Index(name = "idx_addon_invoke_type", columnList = "invoke_type")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MlAddon {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Add-on 고유 식별자 (예: "sentiment-v1", "factcheck-korean-v2")
     */
    @Column(name = "addon_key", nullable = false, unique = true, length = 100)
    private String addonKey;

    /**
     * 표시용 이름
     */
    @Column(name = "name", nullable = false, length = 200)
    private String name;

    /**
     * Add-on 설명
     */
    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    /**
     * 분류 카테고리
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "category", nullable = false, length = 50)
    private AddonCategory category;

    /**
     * 호출 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "invoke_type", nullable = false, length = 30)
    private AddonInvokeType invokeType;

    /**
     * HTTP 호출 시 엔드포인트 URL
     */
    @Column(name = "endpoint_url", length = 500)
    private String endpointUrl;

    /**
     * 큐 기반 호출 시 토픽명
     */
    @Column(name = "queue_topic", length = 200)
    private String queueTopic;

    /**
     * 파일 폴링 시 스토리지 경로
     */
    @Column(name = "storage_path", length = 500)
    private String storagePath;

    /**
     * 인증 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "auth_type", length = 30)
    @Builder.Default
    private AddonAuthType authType = AddonAuthType.NONE;

    /**
     * 인증 정보 (암호화 저장 권장)
     * API Key, OAuth credentials 등
     */
    @Column(name = "auth_credentials", columnDefinition = "TEXT")
    private String authCredentials;

    /**
     * Input 스키마 버전 (호환성 체크용)
     */
    @Column(name = "input_schema_version", length = 20)
    @Builder.Default
    private String inputSchemaVersion = "1.0";

    /**
     * Output 스키마 버전
     */
    @Column(name = "output_schema_version", length = 20)
    @Builder.Default
    private String outputSchemaVersion = "1.0";

    /**
     * 타임아웃 (밀리초)
     */
    @Column(name = "timeout_ms")
    @Builder.Default
    private Integer timeoutMs = 30000;

    /**
     * 초당 최대 요청 수 (Rate limiting)
     */
    @Column(name = "max_qps")
    @Builder.Default
    private Integer maxQps = 10;

    /**
     * 재시도 횟수
     */
    @Column(name = "max_retries")
    @Builder.Default
    private Integer maxRetries = 3;

    /**
     * 의존하는 다른 Add-on들의 addonKey 목록 (DAG 구성용)
     * 예: ["entity_extractor_v1", "topic_classifier_v1"]
     */
    @Column(name = "depends_on", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> dependsOn;

    /**
     * 활성화 여부
     */
    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /**
     * 우선순위 (낮을수록 먼저 실행)
     */
    @Column(name = "priority")
    @Builder.Default
    private Integer priority = 100;

    /**
     * 추가 설정 (JSON)
     * - 모델 파라미터
     * - 언어 설정
     * - 임계값 등
     */
    @Column(name = "config", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> config;

    /**
     * 헬스체크 엔드포인트 (옵션)
     */
    @Column(name = "health_check_url", length = 500)
    private String healthCheckUrl;

    /**
     * 마지막 헬스체크 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "health_status", length = 20)
    @Builder.Default
    private AddonHealthStatus healthStatus = AddonHealthStatus.UNKNOWN;

    /**
     * 마지막 헬스체크 시간
     */
    @Column(name = "last_health_check")
    private LocalDateTime lastHealthCheck;

    /**
     * 관리자/소유자
     */
    @Column(name = "owner", length = 100)
    private String owner;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // === 운영 통계 (캐시용, 주기적 업데이트) ===

    /**
     * 총 실행 횟수
     */
    @Column(name = "total_executions")
    @Builder.Default
    private Long totalExecutions = 0L;

    /**
     * 성공 횟수
     */
    @Column(name = "success_count")
    @Builder.Default
    private Long successCount = 0L;

    /**
     * 실패 횟수
     */
    @Column(name = "failure_count")
    @Builder.Default
    private Long failureCount = 0L;

    /**
     * 평균 응답 시간 (ms)
     */
    @Column(name = "avg_latency_ms")
    private Double avgLatencyMs;

    /**
     * 통계 마지막 갱신 시간
     */
    @Column(name = "stats_updated_at")
    private LocalDateTime statsUpdatedAt;

    // === Helper Methods ===

    public boolean isHttpBased() {
        return invokeType == AddonInvokeType.HTTP_SYNC || invokeType == AddonInvokeType.HTTP_ASYNC;
    }

    public boolean isQueueBased() {
        return invokeType == AddonInvokeType.QUEUE;
    }

    public double getSuccessRate() {
        if (totalExecutions == null || totalExecutions == 0) return 0.0;
        return (successCount != null ? successCount : 0) / (double) totalExecutions;
    }

    public void incrementSuccess(long latencyMs) {
        this.totalExecutions = (this.totalExecutions != null ? this.totalExecutions : 0) + 1;
        this.successCount = (this.successCount != null ? this.successCount : 0) + 1;
        // Simple moving average for latency
        if (this.avgLatencyMs == null) {
            this.avgLatencyMs = (double) latencyMs;
        } else {
            this.avgLatencyMs = (this.avgLatencyMs * 0.9) + (latencyMs * 0.1);
        }
        this.statsUpdatedAt = LocalDateTime.now();
    }

    public void incrementFailure() {
        this.totalExecutions = (this.totalExecutions != null ? this.totalExecutions : 0) + 1;
        this.failureCount = (this.failureCount != null ? this.failureCount : 0) + 1;
        this.statsUpdatedAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/addon/MlAddonExecution.java

```java
package com.newsinsight.collector.entity.addon;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Add-on 실행 이력 엔티티.
 * 
 * 각 분석 작업의 요청/응답/상태를 기록.
 * 디버깅, 모니터링, 감사 추적에 활용.
 */
@Entity
@Table(name = "ml_addon_execution", indexes = {
    @Index(name = "idx_exec_addon_id", columnList = "addon_id"),
    @Index(name = "idx_exec_article_id", columnList = "article_id"),
    @Index(name = "idx_exec_status", columnList = "status"),
    @Index(name = "idx_exec_created", columnList = "created_at"),
    @Index(name = "idx_exec_batch_id", columnList = "batch_id")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class MlAddonExecution {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 요청 고유 ID (UUID)
     */
    @Column(name = "request_id", nullable = false, unique = true, length = 50)
    private String requestId;

    /**
     * 배치 ID (여러 기사를 한 번에 처리할 때)
     */
    @Column(name = "batch_id", length = 50)
    private String batchId;

    /**
     * 대상 Add-on
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "addon_id", nullable = false)
    private MlAddon addon;

    /**
     * 분석 대상 기사 ID
     */
    @Column(name = "article_id")
    private Long articleId;

    /**
     * 분석 대상 URL (기사가 아닌 경우)
     */
    @Column(name = "target_url", length = 1000)
    private String targetUrl;

    /**
     * 실행 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private ExecutionStatus status = ExecutionStatus.PENDING;

    /**
     * 요청 페이로드 (디버깅용, 민감정보 주의)
     */
    @Column(name = "request_payload", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> requestPayload;

    /**
     * 응답 결과 (분석 결과 전체)
     */
    @Column(name = "response_payload", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> responsePayload;

    /**
     * 에러 메시지 (실패 시)
     */
    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /**
     * 에러 코드
     */
    @Column(name = "error_code", length = 50)
    private String errorCode;

    /**
     * 재시도 횟수
     */
    @Column(name = "retry_count")
    @Builder.Default
    private Integer retryCount = 0;

    /**
     * 요청 시작 시간
     */
    @Column(name = "started_at")
    private LocalDateTime startedAt;

    /**
     * 요청 완료 시간
     */
    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * 실행 소요 시간 (ms)
     */
    @Column(name = "latency_ms")
    private Long latencyMs;

    /**
     * 모델 버전 (Add-on이 반환)
     */
    @Column(name = "model_version", length = 100)
    private String modelVersion;

    /**
     * 생성 시간
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 중요도/우선순위 (realtime, batch)
     */
    @Column(name = "importance", length = 20)
    @Builder.Default
    private String importance = "batch";

    // === Helper Methods ===

    public void markStarted() {
        this.status = ExecutionStatus.RUNNING;
        this.startedAt = LocalDateTime.now();
    }

    public void markSuccess(Map<String, Object> response, String modelVersion) {
        this.status = ExecutionStatus.SUCCESS;
        this.completedAt = LocalDateTime.now();
        this.responsePayload = response;
        this.modelVersion = modelVersion;
        if (this.startedAt != null) {
            this.latencyMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    public void markFailed(String errorCode, String errorMessage) {
        this.status = ExecutionStatus.FAILED;
        this.completedAt = LocalDateTime.now();
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
        if (this.startedAt != null) {
            this.latencyMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    public void incrementRetry() {
        this.retryCount = (this.retryCount != null ? this.retryCount : 0) + 1;
        this.status = ExecutionStatus.PENDING;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiJob.java

```java
package com.newsinsight.collector.entity.ai;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Entity representing an AI orchestration job.
 * A job consists of multiple sub-tasks that can be processed by different AI providers.
 * Tracks the overall status aggregated from all sub-tasks.
 */
@Entity
@Table(name = "ai_jobs", indexes = {
        @Index(name = "idx_ai_jobs_overall_status", columnList = "overall_status"),
        @Index(name = "idx_ai_jobs_created_at", columnList = "created_at"),
        @Index(name = "idx_ai_jobs_topic", columnList = "topic")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiJob {

    @Id
    @Column(name = "job_id", length = 64)
    private String id;

    @Column(nullable = false, length = 512)
    private String topic;

    @Column(name = "base_url", length = 2048)
    private String baseUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "overall_status", nullable = false, length = 32)
    @Builder.Default
    private AiJobStatus overallStatus = AiJobStatus.PENDING;

    @OneToMany(mappedBy = "aiJob", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<AiSubTask> subTasks = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    /**
     * Add a sub-task to this job (manages bidirectional relationship)
     */
    public void addSubTask(AiSubTask task) {
        subTasks.add(task);
        task.setAiJob(this);
    }

    /**
     * Remove a sub-task from this job
     */
    public void removeSubTask(AiSubTask task) {
        subTasks.remove(task);
        task.setAiJob(null);
    }

    /**
     * Mark the job as in progress
     */
    public void markInProgress() {
        this.overallStatus = AiJobStatus.IN_PROGRESS;
    }

    /**
     * Mark the job as completed successfully
     */
    public void markCompleted() {
        this.overallStatus = AiJobStatus.COMPLETED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as failed
     */
    public void markFailed(String errorMessage) {
        this.overallStatus = AiJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as partially successful (some tasks completed, some failed)
     */
    public void markPartialSuccess() {
        this.overallStatus = AiJobStatus.PARTIAL_SUCCESS;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as cancelled
     */
    public void markCancelled() {
        this.overallStatus = AiJobStatus.CANCELLED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the job as timed out
     */
    public void markTimeout() {
        this.overallStatus = AiJobStatus.TIMEOUT;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Check if the job is in a terminal state
     */
    public boolean isTerminal() {
        return overallStatus == AiJobStatus.COMPLETED
                || overallStatus == AiJobStatus.FAILED
                || overallStatus == AiJobStatus.PARTIAL_SUCCESS
                || overallStatus == AiJobStatus.CANCELLED
                || overallStatus == AiJobStatus.TIMEOUT;
    }

    /**
     * Get count of sub-tasks by status
     */
    public long countSubTasksByStatus(AiTaskStatus status) {
        return subTasks.stream()
                .filter(task -> task.getStatus() == status)
                .count();
    }

    /**
     * Generate a new job ID
     */
    public static String generateJobId() {
        return "aijob_" + java.util.UUID.randomUUID().toString()
                .replace("-", "").substring(0, 16);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiJobStatus.java

```java
package com.newsinsight.collector.entity.ai;

/**
 * Status of an AI orchestration job.
 * Represents the aggregate state across all sub-tasks.
 */
public enum AiJobStatus {
    /**
     * Job has been created but no sub-tasks have started
     */
    PENDING,

    /**
     * At least one sub-task is currently being processed
     */
    IN_PROGRESS,

    /**
     * All sub-tasks completed successfully
     */
    COMPLETED,

    /**
     * Some sub-tasks completed, some failed/timed out
     */
    PARTIAL_SUCCESS,

    /**
     * All sub-tasks failed
     */
    FAILED,

    /**
     * Job was cancelled before completion
     */
    CANCELLED,

    /**
     * Job timed out waiting for sub-task callbacks
     */
    TIMEOUT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiProvider.java

```java
package com.newsinsight.collector.entity.ai;

/**
 * AI provider/workflow types for task routing.
 * Each provider represents a different n8n workflow or external AI service.
 */
public enum AiProvider {
    /**
     * Universal agent for general-purpose AI tasks.
     * n8n workflow: /webhook/universal-agent
     */
    UNIVERSAL_AGENT("universal-agent", "General-purpose AI agent"),

    /**
     * Deep reader for in-depth content analysis.
     * n8n workflow: /webhook/deep-reader (crawl-agent)
     */
    DEEP_READER("deep-reader", "Deep content analysis and evidence extraction"),

    /**
     * Scout agent for quick reconnaissance and URL discovery.
     * n8n workflow: /webhook/scout-agent
     */
    SCOUT("scout-agent", "Quick reconnaissance and URL discovery"),

    /**
     * Local quick processing for simple tasks without external calls.
     * Processed internally without n8n.
     */
    LOCAL_QUICK("local-quick", "Local quick processing");

    private final String workflowPath;
    private final String description;

    AiProvider(String workflowPath, String description) {
        this.workflowPath = workflowPath;
        this.description = description;
    }

    public String getWorkflowPath() {
        return workflowPath;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Check if this provider requires external n8n workflow
     */
    public boolean isExternal() {
        return this != LOCAL_QUICK;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiSubTask.java

```java
package com.newsinsight.collector.entity.ai;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Entity representing an individual AI sub-task within a job.
 * Each sub-task is processed by a specific AI provider (n8n workflow).
 */
@Entity
@Table(name = "ai_sub_tasks", indexes = {
        @Index(name = "idx_ai_sub_tasks_job_id", columnList = "job_id"),
        @Index(name = "idx_ai_sub_tasks_status", columnList = "status"),
        @Index(name = "idx_ai_sub_tasks_provider_id", columnList = "provider_id"),
        @Index(name = "idx_ai_sub_tasks_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AiSubTask {

    @Id
    @Column(name = "sub_task_id", length = 64)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "job_id", nullable = false)
    private AiJob aiJob;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider_id", nullable = false, length = 32)
    private AiProvider providerId;

    @Column(name = "task_type", nullable = false, length = 64)
    private String taskType;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    @Builder.Default
    private AiTaskStatus status = AiTaskStatus.PENDING;

    @Lob
    @Column(name = "result_json", columnDefinition = "TEXT")
    private String resultJson;

    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    @Column(name = "retry_count")
    @Builder.Default
    private Integer retryCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark the task as in progress
     */
    public void markInProgress() {
        this.status = AiTaskStatus.IN_PROGRESS;
    }

    /**
     * Mark the task as completed with result
     */
    public void markCompleted(String resultJson) {
        this.status = AiTaskStatus.COMPLETED;
        this.resultJson = resultJson;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as failed
     */
    public void markFailed(String errorMessage) {
        this.status = AiTaskStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as cancelled
     */
    public void markCancelled() {
        this.status = AiTaskStatus.CANCELLED;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Mark the task as timed out
     */
    public void markTimeout() {
        this.status = AiTaskStatus.TIMEOUT;
        this.completedAt = LocalDateTime.now();
    }

    /**
     * Increment retry count
     */
    public void incrementRetry() {
        this.retryCount++;
    }

    /**
     * Check if the task is in a terminal state
     */
    public boolean isTerminal() {
        return status == AiTaskStatus.COMPLETED
                || status == AiTaskStatus.FAILED
                || status == AiTaskStatus.CANCELLED
                || status == AiTaskStatus.TIMEOUT;
    }

    /**
     * Check if the task can be retried
     */
    public boolean canRetry(int maxRetries) {
        return retryCount < maxRetries && !isTerminal();
    }

    /**
     * Get the job ID (helper for when job is lazy loaded)
     */
    public String getJobId() {
        return aiJob != null ? aiJob.getId() : null;
    }

    /**
     * Create a new sub-task for a job
     */
    public static AiSubTask create(AiJob job, AiProvider provider, String taskType) {
        AiSubTask task = AiSubTask.builder()
                .id(generateSubTaskId())
                .providerId(provider)
                .taskType(taskType)
                .status(AiTaskStatus.PENDING)
                .retryCount(0)
                .build();
        job.addSubTask(task);
        return task;
    }

    /**
     * Generate a new sub-task ID
     */
    public static String generateSubTaskId() {
        return "subtask_" + UUID.randomUUID().toString()
                .replace("-", "").substring(0, 16);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/ai/AiTaskStatus.java

```java
package com.newsinsight.collector.entity.ai;

/**
 * Status of an individual AI sub-task.
 */
public enum AiTaskStatus {
    /**
     * Task has been created but not yet started
     */
    PENDING,

    /**
     * Task is currently being processed by a worker/n8n
     */
    IN_PROGRESS,

    /**
     * Task completed successfully
     */
    COMPLETED,

    /**
     * Task failed due to an error
     */
    FAILED,

    /**
     * Task was cancelled before completion
     */
    CANCELLED,

    /**
     * Task timed out waiting for callback
     */
    TIMEOUT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/analysis/ArticleAnalysis.java

```java
package com.newsinsight.collector.entity.analysis;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 기사 분석 결과 엔티티.
 * 
 * 각종 ML Add-on의 분석 결과를 통합 저장.
 * 감정 분석, 신뢰도, 편향도, 팩트체크 결과 등을 한 곳에서 조회 가능.
 */
@Entity
@Table(name = "article_analysis", indexes = {
    @Index(name = "idx_analysis_article_id", columnList = "article_id"),
    @Index(name = "idx_analysis_reliability", columnList = "reliability_score"),
    @Index(name = "idx_analysis_sentiment", columnList = "sentiment_label"),
    @Index(name = "idx_analysis_bias", columnList = "bias_label"),
    @Index(name = "idx_analysis_misinfo", columnList = "misinfo_risk"),
    @Index(name = "idx_analysis_updated", columnList = "updated_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 분석 대상 기사 ID (collected_data.id와 연결)
     */
    @Column(name = "article_id", nullable = false, unique = true)
    private Long articleId;

    // ========== 요약 ==========

    /**
     * AI 생성 요약
     */
    @Column(name = "summary", columnDefinition = "TEXT")
    private String summary;

    /**
     * 핵심 문장 (추출 요약)
     */
    @Column(name = "key_sentences", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> keySentences;

    // ========== 감정 분석 ==========

    /**
     * 감정 점수 (-1.0 ~ 1.0 또는 0 ~ 100)
     * -1 = 매우 부정, 0 = 중립, 1 = 매우 긍정
     */
    @Column(name = "sentiment_score")
    private Double sentimentScore;

    /**
     * 감정 레이블 (positive, negative, neutral)
     */
    @Column(name = "sentiment_label", length = 20)
    private String sentimentLabel;

    /**
     * 감정 분포 (긍정/부정/중립 비율)
     * {"positive": 0.2, "negative": 0.7, "neutral": 0.1}
     */
    @Column(name = "sentiment_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> sentimentDistribution;

    /**
     * 톤 분석 (보도형 vs 의견형)
     * {"factual": 0.8, "opinion": 0.2}
     */
    @Column(name = "tone_analysis", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> toneAnalysis;

    // ========== 편향도 분석 ==========

    /**
     * 편향 레이블 (left, right, center, pro_government, pro_corporate 등)
     */
    @Column(name = "bias_label", length = 50)
    private String biasLabel;

    /**
     * 편향 점수 (-1.0 ~ 1.0)
     * -1 = 극좌, 0 = 중립, 1 = 극우 (정치적 스펙트럼)
     */
    @Column(name = "bias_score")
    private Double biasScore;

    /**
     * 편향 세부 분석
     * {"political_left": 0.3, "pro_government": 0.2, ...}
     */
    @Column(name = "bias_details", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> biasDetails;

    // ========== 신뢰도 분석 ==========

    /**
     * 신뢰도 점수 (0 ~ 100)
     */
    @Column(name = "reliability_score")
    private Double reliabilityScore;

    /**
     * 신뢰도 등급 (high, medium, low)
     */
    @Column(name = "reliability_grade", length = 20)
    private String reliabilityGrade;

    /**
     * 신뢰도 요인 분석
     * {"source_reputation": 0.8, "citation_quality": 0.6, "consistency": 0.7}
     */
    @Column(name = "reliability_factors", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> reliabilityFactors;

    // ========== 허위정보/팩트체크 ==========

    /**
     * 허위정보 위험도 (low, mid, high)
     */
    @Column(name = "misinfo_risk", length = 20)
    private String misinfoRisk;

    /**
     * 허위정보 점수 (0 ~ 1)
     */
    @Column(name = "misinfo_score")
    private Double misinfoScore;

    /**
     * 팩트체크 상태 (verified, suspicious, conflicting, unverified)
     */
    @Column(name = "factcheck_status", length = 30)
    private String factcheckStatus;

    /**
     * 팩트체크 상세 노트/근거
     */
    @Column(name = "factcheck_notes", columnDefinition = "TEXT")
    private String factcheckNotes;

    /**
     * 검증된 주장들
     * [{"claim": "...", "verified": true, "sources": [...]}]
     */
    @Column(name = "verified_claims", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> verifiedClaims;

    // ========== 주제/토픽 ==========

    /**
     * 주요 토픽/카테고리
     * ["정치", "외교", "북한"]
     */
    @Column(name = "topics", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> topics;

    /**
     * 토픽별 연관도
     * {"정치": 0.9, "외교": 0.7, "북한": 0.5}
     */
    @Column(name = "topic_scores", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> topicScores;

    // ========== 개체명 인식 (NER) ==========

    /**
     * 추출된 인물
     * [{"name": "홍길동", "role": "장관", "sentiment": "neutral"}]
     */
    @Column(name = "entities_person", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesPerson;

    /**
     * 추출된 기관/조직
     */
    @Column(name = "entities_org", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesOrg;

    /**
     * 추출된 장소/지역
     */
    @Column(name = "entities_location", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesLocation;

    /**
     * 기타 개체 (날짜, 금액, 수치 등)
     */
    @Column(name = "entities_misc", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> entitiesMisc;

    // ========== 위험 태그 ==========

    /**
     * 위험 태그 목록
     * ["clickbait", "sensational", "unverified_source"]
     */
    @Column(name = "risk_tags", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> riskTags;

    /**
     * 독성/혐오 점수 (0 ~ 1)
     */
    @Column(name = "toxicity_score")
    private Double toxicityScore;

    /**
     * 선정성 점수 (0 ~ 1)
     */
    @Column(name = "sensationalism_score")
    private Double sensationalismScore;

    // ========== 분석 메타데이터 ==========

    /**
     * 분석에 사용된 Add-on 목록
     * ["sentiment-v1", "factcheck-v2", "ner-korean-v1"]
     */
    @Column(name = "analyzed_by", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> analyzedBy;

    /**
     * 분석 완료 상태
     * {"sentiment": true, "factcheck": false, "ner": true}
     */
    @Column(name = "analysis_status", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Boolean> analysisStatus;

    /**
     * 전체 분석 완료 여부
     */
    @Column(name = "fully_analyzed")
    @Builder.Default
    private Boolean fullyAnalyzed = false;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 마지막 업데이트
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ========== Helper Methods ==========

    public String getReliabilityColor() {
        if (reliabilityScore == null) return "gray";
        if (reliabilityScore >= 70) return "green";
        if (reliabilityScore >= 40) return "yellow";
        return "red";
    }

    public String getSentimentEmoji() {
        if (sentimentLabel == null) return "⚪";
        return switch (sentimentLabel.toLowerCase()) {
            case "positive" -> "😊";
            case "negative" -> "😠";
            default -> "😐";
        };
    }

    public boolean needsFactCheck() {
        return misinfoRisk != null && 
               (misinfoRisk.equals("high") || misinfoRisk.equals("mid"));
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/analysis/ArticleDiscussion.java

```java
package com.newsinsight.collector.entity.analysis;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 기사 관련 커뮤니티/댓글/여론 분석 결과 엔티티.
 * 
 * 포털 댓글, SNS, 커뮤니티 등에서 수집된 반응 데이터를 분석하여 저장.
 */
@Entity
@Table(name = "article_discussion", indexes = {
    @Index(name = "idx_discussion_article_id", columnList = "article_id"),
    @Index(name = "idx_discussion_sentiment", columnList = "overall_sentiment"),
    @Index(name = "idx_discussion_updated", columnList = "updated_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ArticleDiscussion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 분석 대상 기사 ID
     */
    @Column(name = "article_id", nullable = false, unique = true)
    private Long articleId;

    // ========== 수집 메타데이터 ==========

    /**
     * 총 댓글/반응 수
     */
    @Column(name = "total_comment_count")
    @Builder.Default
    private Integer totalCommentCount = 0;

    /**
     * 분석된 댓글 수
     */
    @Column(name = "analyzed_count")
    @Builder.Default
    private Integer analyzedCount = 0;

    /**
     * 수집 플랫폼 목록
     * ["portal_comments", "twitter", "community_dcinside", "community_fmkorea"]
     */
    @Column(name = "platforms", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> platforms;

    /**
     * 플랫폼별 댓글 수
     * {"portal_comments": 150, "twitter": 45, "community": 80}
     */
    @Column(name = "platform_counts", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Integer> platformCounts;

    // ========== 전체 감정 분석 ==========

    /**
     * 전체 감정 레이블 (positive, negative, neutral, mixed)
     */
    @Column(name = "overall_sentiment", length = 20)
    private String overallSentiment;

    /**
     * 감정 분포
     * {"positive": 0.2, "negative": 0.6, "neutral": 0.2}
     */
    @Column(name = "sentiment_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> sentimentDistribution;

    /**
     * 세부 감정 분석 (분노, 슬픔, 불안, 기쁨 등)
     * {"anger": 0.4, "anxiety": 0.2, "sadness": 0.15, "joy": 0.1, "surprise": 0.15}
     */
    @Column(name = "emotion_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> emotionDistribution;

    /**
     * 지배적 감정
     */
    @Column(name = "dominant_emotion", length = 30)
    private String dominantEmotion;

    // ========== 스탠스/입장 분석 ==========

    /**
     * 찬반 분포
     * {"agree": 0.3, "disagree": 0.5, "neutral": 0.2}
     */
    @Column(name = "stance_distribution", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Double> stanceDistribution;

    /**
     * 전체적인 여론 방향 (supportive, opposing, divided, neutral)
     */
    @Column(name = "overall_stance", length = 30)
    private String overallStance;

    // ========== 독성/품질 분석 ==========

    /**
     * 전체 독성 점수 (0 ~ 1)
     */
    @Column(name = "toxicity_score")
    private Double toxicityScore;

    /**
     * 혐오발언 비율
     */
    @Column(name = "hate_speech_ratio")
    private Double hateSpeechRatio;

    /**
     * 욕설 비율
     */
    @Column(name = "profanity_ratio")
    private Double profanityRatio;

    /**
     * 여론 건전성 점수 (0 ~ 100)
     */
    @Column(name = "discussion_quality_score")
    private Double discussionQualityScore;

    // ========== 키워드/토픽 ==========

    /**
     * 상위 키워드
     * [{"word": "정부", "count": 45}, {"word": "반대", "count": 32}]
     */
    @Column(name = "top_keywords", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> topKeywords;

    /**
     * 댓글에서만 언급되는 이슈 (기사에 없는 관점)
     * ["언론이 숨기는 진실", "과거 사례 비교"]
     */
    @Column(name = "emerging_topics", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> emergingTopics;

    // ========== 시계열 분석 ==========

    /**
     * 시간대별 여론 변화
     * [{"hour": "2025-01-15T10:00", "sentiment": -0.3, "volume": 25}, ...]
     */
    @Column(name = "time_series", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> timeSeries;

    /**
     * 여론 반전 시점 (있는 경우)
     */
    @Column(name = "sentiment_shift_at")
    private LocalDateTime sentimentShiftAt;

    /**
     * 피크 시점 (가장 많은 반응이 있던 시간)
     */
    @Column(name = "peak_activity_at")
    private LocalDateTime peakActivityAt;

    // ========== 조작/봇 탐지 ==========

    /**
     * 의심스러운 패턴 탐지 여부
     */
    @Column(name = "suspicious_pattern_detected")
    @Builder.Default
    private Boolean suspiciousPatternDetected = false;

    /**
     * 봇/조작 의심 점수 (0 ~ 1)
     */
    @Column(name = "bot_likelihood_score")
    private Double botLikelihoodScore;

    /**
     * 탐지된 의심 패턴 목록
     * ["repeated_text", "coordinated_posting", "new_account_surge"]
     */
    @Column(name = "suspicious_patterns", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> suspiciousPatterns;

    // ========== 대표 댓글 ==========

    /**
     * 대표 긍정 댓글 샘플
     */
    @Column(name = "sample_positive_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> samplePositiveComments;

    /**
     * 대표 부정 댓글 샘플
     */
    @Column(name = "sample_negative_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> sampleNegativeComments;

    /**
     * 가장 많은 공감을 받은 댓글
     */
    @Column(name = "top_engaged_comments", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<Map<String, Object>> topEngagedComments;

    // ========== 플랫폼별 비교 ==========

    /**
     * 플랫폼별 감정 비교
     * {"portal": {"positive": 0.3, "negative": 0.5}, "twitter": {"positive": 0.4, ...}}
     */
    @Column(name = "platform_sentiment_comparison", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Map<String, Double>> platformSentimentComparison;

    // ========== 메타데이터 ==========

    /**
     * 분석에 사용된 Add-on
     */
    @Column(name = "analyzed_by", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> analyzedBy;

    /**
     * 마지막 크롤링 시점
     */
    @Column(name = "last_crawled_at")
    private LocalDateTime lastCrawledAt;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 마지막 업데이트
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ========== Helper Methods ==========

    public String getSentimentSummary() {
        if (sentimentDistribution == null) return "분석 대기 중";
        
        double negative = sentimentDistribution.getOrDefault("negative", 0.0);
        double positive = sentimentDistribution.getOrDefault("positive", 0.0);
        
        if (negative > 0.6) return "부정적 여론 우세";
        if (positive > 0.6) return "긍정적 여론 우세";
        if (Math.abs(negative - positive) < 0.1) return "여론 분분";
        return "중립적";
    }

    public boolean isControversial() {
        if (stanceDistribution == null) return false;
        double agree = stanceDistribution.getOrDefault("agree", 0.0);
        double disagree = stanceDistribution.getOrDefault("disagree", 0.0);
        return Math.abs(agree - disagree) < 0.2 && (agree + disagree) > 0.6;
    }

    public String getDiscussionHealthGrade() {
        if (discussionQualityScore == null) return "N/A";
        if (discussionQualityScore >= 70) return "양호";
        if (discussionQualityScore >= 40) return "보통";
        return "주의";
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/ContentType.java

```java
package com.newsinsight.collector.entity.autocrawl;

/**
 * 예상 콘텐츠 타입
 */
public enum ContentType {
    /**
     * 뉴스 기사
     */
    NEWS,
    
    /**
     * 블로그/개인 사이트
     */
    BLOG,
    
    /**
     * 포럼/커뮤니티
     */
    FORUM,
    
    /**
     * 소셜 미디어
     */
    SOCIAL,
    
    /**
     * 공식 문서/보고서
     */
    OFFICIAL,
    
    /**
     * 학술/연구
     */
    ACADEMIC,
    
    /**
     * 미분류
     */
    UNKNOWN
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/CrawlTarget.java

```java
package com.newsinsight.collector.entity.autocrawl;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 자동 크롤링 대상 URL 엔티티.
 * 검색, 기사 분석, 외부 링크 등에서 자동으로 발견된 URL을 관리합니다.
 */
@Entity
@Table(name = "crawl_targets", indexes = {
        @Index(name = "idx_crawl_target_url_hash", columnList = "urlHash"),
        @Index(name = "idx_crawl_target_status", columnList = "status"),
        @Index(name = "idx_crawl_target_priority", columnList = "priority DESC"),
        @Index(name = "idx_crawl_target_discovered", columnList = "discoveredAt DESC")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 크롤링 대상 URL
     */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String url;

    /**
     * URL 해시 (중복 체크용)
     */
    @Column(nullable = false, length = 64)
    private String urlHash;

    /**
     * 발견 출처 (SEARCH, ARTICLE_LINK, TRENDING, RSS_MENTION, MANUAL, DEEP_SEARCH)
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private DiscoverySource discoverySource;

    /**
     * 발견 컨텍스트 (검색어, 원본 기사 ID 등)
     */
    @Column(columnDefinition = "TEXT")
    private String discoveryContext;

    /**
     * 크롤링 우선순위 (0-100, 높을수록 우선)
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer priority = 50;

    /**
     * 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private CrawlTargetStatus status = CrawlTargetStatus.PENDING;

    /**
     * 도메인 (파싱된 호스트)
     */
    @Column(length = 255)
    private String domain;

    /**
     * 예상 콘텐츠 타입 (NEWS, BLOG, FORUM, SOCIAL, UNKNOWN)
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    @Builder.Default
    private ContentType expectedContentType = ContentType.UNKNOWN;

    /**
     * 관련 키워드 (쉼표 구분)
     */
    @Column(columnDefinition = "TEXT")
    private String relatedKeywords;

    /**
     * 재시도 횟수
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer retryCount = 0;

    /**
     * 최대 재시도 횟수
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer maxRetries = 3;

    /**
     * 마지막 시도 시각
     */
    private LocalDateTime lastAttemptAt;

    /**
     * 다음 시도 가능 시각 (재시도 백오프용)
     */
    private LocalDateTime nextAttemptAfter;

    /**
     * 마지막 오류 메시지
     */
    @Column(columnDefinition = "TEXT")
    private String lastError;

    /**
     * 크롤링 성공 시 저장된 CollectedData ID
     */
    private Long collectedDataId;

    /**
     * 발견 시각
     */
    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime discoveredAt;

    /**
     * 마지막 수정 시각
     */
    @UpdateTimestamp
    private LocalDateTime updatedAt;

    /**
     * 처리 완료 시각
     */
    private LocalDateTime completedAt;

    // ========================================
    // 유틸리티 메서드
    // ========================================

    public void markInProgress() {
        this.status = CrawlTargetStatus.IN_PROGRESS;
        this.lastAttemptAt = LocalDateTime.now();
    }

    public void markCompleted(Long collectedDataId) {
        this.status = CrawlTargetStatus.COMPLETED;
        this.completedAt = LocalDateTime.now();
        this.collectedDataId = collectedDataId;
    }

    public void markFailed(String error) {
        this.retryCount++;
        this.lastError = error;
        this.lastAttemptAt = LocalDateTime.now();

        if (this.retryCount >= this.maxRetries) {
            this.status = CrawlTargetStatus.FAILED;
        } else {
            this.status = CrawlTargetStatus.PENDING;
            // 지수 백오프: 2^retry * 5분
            int delayMinutes = (int) Math.pow(2, this.retryCount) * 5;
            this.nextAttemptAfter = LocalDateTime.now().plusMinutes(delayMinutes);
        }
    }

    public void markSkipped(String reason) {
        this.status = CrawlTargetStatus.SKIPPED;
        this.lastError = reason;
        this.completedAt = LocalDateTime.now();
    }

    public boolean isRetryable() {
        if (status != CrawlTargetStatus.PENDING) return false;
        if (retryCount >= maxRetries) return false;
        if (nextAttemptAfter != null && LocalDateTime.now().isBefore(nextAttemptAfter)) return false;
        return true;
    }

    /**
     * 우선순위 부스트 (특정 조건에서 우선순위 상승)
     */
    public void boostPriority(int amount) {
        this.priority = Math.min(100, this.priority + amount);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/CrawlTargetStatus.java

```java
package com.newsinsight.collector.entity.autocrawl;

/**
 * 크롤링 대상 URL 상태
 */
public enum CrawlTargetStatus {
    /**
     * 대기 중 (처리 가능)
     */
    PENDING,
    
    /**
     * 처리 중
     */
    IN_PROGRESS,
    
    /**
     * 완료
     */
    COMPLETED,
    
    /**
     * 실패 (재시도 횟수 초과)
     */
    FAILED,
    
    /**
     * 건너뜀 (중복, 블랙리스트 등)
     */
    SKIPPED,
    
    /**
     * 취소됨
     */
    CANCELLED,
    
    /**
     * 만료됨 (오래 대기 중인 상태로 방치됨)
     */
    EXPIRED
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/autocrawl/DiscoverySource.java

```java
package com.newsinsight.collector.entity.autocrawl;

/**
 * 크롤링 대상 URL 발견 출처
 */
public enum DiscoverySource {
    /**
     * 사용자 검색 결과에서 발견
     */
    SEARCH,
    
    /**
     * 기사 본문 내 외부 링크에서 발견
     */
    ARTICLE_LINK,
    
    /**
     * 트렌딩 토픽/급상승 검색어에서 발견
     */
    TRENDING,
    
    /**
     * RSS 피드 본문 내 언급에서 발견
     */
    RSS_MENTION,
    
    /**
     * Deep Search 결과에서 발견
     */
    DEEP_SEARCH,
    
    /**
     * AI 분석 추천 URL
     */
    AI_RECOMMENDATION,
    
    /**
     * 관리자 수동 등록
     */
    MANUAL,
    
    /**
     * 외부 API에서 수신
     */
    EXTERNAL_API
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/browser/BrowserJobHistory.java

```java
package com.newsinsight.collector.entity.browser;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity for storing Browser-Use automation job history.
 * Tracks all browser automation tasks with their results,
 * screenshots, and extracted data.
 */
@Entity
@Table(name = "browser_job_history", indexes = {
        @Index(name = "idx_browser_job_job_id", columnList = "job_id"),
        @Index(name = "idx_browser_job_user_id", columnList = "user_id"),
        @Index(name = "idx_browser_job_status", columnList = "status"),
        @Index(name = "idx_browser_job_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BrowserJobHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Unique job ID from browser-use service
     */
    @Column(name = "job_id", length = 64, unique = true)
    private String jobId;

    /**
     * Task description
     */
    @Column(name = "task", nullable = false, length = 2048)
    private String task;

    /**
     * Target URL if specified
     */
    @Column(name = "target_url", length = 2048)
    private String targetUrl;

    /**
     * User ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Job status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private BrowserJobStatus status = BrowserJobStatus.PENDING;

    /**
     * Job result/output
     */
    @Column(name = "result", columnDefinition = "text")
    private String result;

    /**
     * Structured result data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result_data", columnDefinition = "jsonb")
    private Map<String, Object> resultData;

    /**
     * Extracted data (forms, tables, etc.)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extracted_data", columnDefinition = "jsonb")
    private List<Map<String, Object>> extractedData;

    /**
     * Screenshot file paths or URLs
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "screenshots", columnDefinition = "jsonb")
    private List<String> screenshots;

    /**
     * Action history/steps taken
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "action_history", columnDefinition = "jsonb")
    private List<Map<String, Object>> actionHistory;

    /**
     * Error message if failed
     */
    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    /**
     * Number of steps executed
     */
    @Column(name = "steps_count")
    @Builder.Default
    private Integer stepsCount = 0;

    /**
     * Execution time in milliseconds
     */
    @Column(name = "duration_ms")
    private Long durationMs;

    /**
     * Browser agent configuration used
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "agent_config", columnDefinition = "jsonb")
    private Map<String, Object> agentConfig;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if associated with a project
     */
    @Column(name = "project_id")
    private Long projectId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    /**
     * Mark job as started
     */
    public void markStarted() {
        this.status = BrowserJobStatus.RUNNING;
        this.startedAt = LocalDateTime.now();
    }

    /**
     * Mark job as completed
     */
    public void markCompleted(String result, Map<String, Object> resultData) {
        this.status = BrowserJobStatus.COMPLETED;
        this.result = result;
        this.resultData = resultData;
        this.completedAt = LocalDateTime.now();
        if (startedAt != null) {
            this.durationMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    /**
     * Mark job as failed
     */
    public void markFailed(String errorMessage) {
        this.status = BrowserJobStatus.FAILED;
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
        if (startedAt != null) {
            this.durationMs = java.time.Duration.between(startedAt, completedAt).toMillis();
        }
    }

    /**
     * Job status enum
     */
    public enum BrowserJobStatus {
        PENDING,
        RUNNING,
        WAITING_HUMAN,
        COMPLETED,
        FAILED,
        CANCELLED,
        TIMEOUT
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/chat/ChatHistory.java

```java
package com.newsinsight.collector.entity.chat;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 채팅 이력 (PostgreSQL)
 * 
 * MongoDB에서 동기화된 채팅 메시지를 RDB에 저장합니다.
 * 검색, 분석, 보고서 생성 등에 활용됩니다.
 */
@Entity
@Table(name = "chat_history", indexes = {
        @Index(name = "idx_chat_session_id", columnList = "session_id"),
        @Index(name = "idx_chat_user_id", columnList = "user_id"),
        @Index(name = "idx_chat_role", columnList = "role"),
        @Index(name = "idx_chat_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChatHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * MongoDB 세션 ID
     */
    @Column(name = "session_id", nullable = false, length = 64)
    private String sessionId;

    /**
     * MongoDB 메시지 ID
     */
    @Column(name = "message_id", nullable = false, length = 64)
    private String messageId;

    /**
     * 사용자 ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * 메시지 역할
     */
    @Column(nullable = false, length = 32)
    private String role; // user, assistant, system

    /**
     * 메시지 내용
     */
    @Column(columnDefinition = "TEXT")
    private String content;

    /**
     * 메시지 타입
     */
    @Column(name = "message_type", length = 32)
    private String messageType;

    /**
     * 메시지 메타데이터 (JSON)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * 메시지 생성 시간
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 벡터 임베딩 ID (참조용)
     */
    @Column(name = "embedding_id", length = 64)
    private String embeddingId;
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/chat/FactCheckChatSession.java

```java
package com.newsinsight.collector.entity.chat;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.CompoundIndexes;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.io.Serializable;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 팩트체크 챗봇 세션 (MongoDB)
 * 
 * 채팅 세션 정보와 대화 이력을 저장합니다.
 * 
 * 개선사항:
 * - 복합 인덱스 추가
 * - 버전 관리 (낙관적 락)
 * - Audit 필드 추가
 * - 메시지 타입 세분화
 * - 직렬화 지원
 */
@Document(collection = "factcheck_chat_sessions")
@CompoundIndexes({
    @CompoundIndex(name = "idx_user_status", def = "{'userId': 1, 'status': 1}"),
    @CompoundIndex(name = "idx_status_sync", def = "{'status': 1, 'syncedToRdb': 1}"),
    @CompoundIndex(name = "idx_status_embed", def = "{'status': 1, 'embeddedToVectorDb': 1}"),
    @CompoundIndex(name = "idx_activity_status", def = "{'lastActivityAt': 1, 'status': 1}")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FactCheckChatSession implements Serializable {

    private static final long serialVersionUID = 1L;

    @Id
    private String id; // MongoDB ObjectId

    /**
     * 세션 ID (UUID)
     */
    @Indexed(unique = true)
    private String sessionId;

    /**
     * 사용자 ID (선택)
     */
    @Indexed
    private String userId;

    /**
     * 세션 시작 시간
     */
    @CreatedDate
    @Indexed
    private LocalDateTime startedAt;

    /**
     * 마지막 활동 시간
     */
    @LastModifiedDate
    @Indexed
    private LocalDateTime lastActivityAt;

    /**
     * 세션 종료 시간
     */
    private LocalDateTime endedAt;

    /**
     * 세션 상태
     */
    @Indexed
    @Builder.Default
    private SessionStatus status = SessionStatus.ACTIVE;

    /**
     * 대화 메시지 목록
     */
    @Builder.Default
    private List<ChatMessage> messages = new ArrayList<>();

    /**
     * 세션 메타데이터
     */
    private SessionMetadata metadata;

    /**
     * RDB 동기화 여부
     */
    @Indexed
    @Builder.Default
    private boolean syncedToRdb = false;

    /**
     * 벡터 DB 임베딩 여부
     */
    @Indexed
    @Builder.Default
    private boolean embeddedToVectorDb = false;

    /**
     * 마지막 RDB 동기화 시간
     */
    private LocalDateTime lastSyncedAt;

    /**
     * 마지막 임베딩 시간
     */
    private LocalDateTime lastEmbeddedAt;

    /**
     * 동기화된 메시지 수
     */
    @Builder.Default
    private int syncedMessageCount = 0;

    /**
     * 임베딩된 메시지 수
     */
    @Builder.Default
    private int embeddedMessageCount = 0;

    /**
     * 버전 (낙관적 락용)
     */
    @Version
    private Long version;

    /**
     * 세션 상태
     */
    public enum SessionStatus {
        ACTIVE,      // 활성 - 대화 진행 중
        COMPLETED,   // 완료 - 사용자가 종료
        EXPIRED,     // 만료 - 비활성으로 인한 자동 만료
        ARCHIVED,    // 아카이브 - 장기 보관
        ERROR        // 에러 - 처리 중 오류 발생
    }

    /**
     * 채팅 메시지
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ChatMessage implements Serializable {
        private static final long serialVersionUID = 1L;
        
        private String messageId;
        private String role; // user, assistant, system
        private String content;
        private Long timestamp;
        private MessageType type;
        private Map<String, Object> metadata; // 추가 데이터 (증거, 검증 결과 등)
        
        // 추가 필드
        private Integer tokenCount; // 토큰 수 (비용 추적용)
        private Long processingTimeMs; // 처리 시간
        private String parentMessageId; // 부모 메시지 (스레드 지원)
        private Boolean synced; // RDB 동기화 여부
        private Boolean embedded; // 벡터 DB 임베딩 여부
    }

    /**
     * 메시지 타입
     */
    public enum MessageType {
        // 기본 메시지 타입
        MESSAGE,           // 일반 메시지
        SYSTEM,            // 시스템 메시지
        
        // 상태 관련
        STATUS,            // 상태 업데이트
        PROGRESS,          // 진행 상황
        
        // 팩트체크 관련
        CLAIM,             // 추출된 주장
        EVIDENCE,          // 수집된 증거
        VERIFICATION,      // 검증 결과
        ASSESSMENT,        // 신뢰도 평가
        
        // AI 관련
        AI_SYNTHESIS,      // AI 종합 분석
        AI_SUMMARY,        // AI 요약
        
        // 결과 관련
        COMPLETE,          // 완료
        ERROR,             // 에러
        WARNING,           // 경고
        
        // 피드백 관련
        FEEDBACK,          // 사용자 피드백
        RATING             // 평가
    }

    /**
     * 세션 메타데이터
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SessionMetadata implements Serializable {
        private static final long serialVersionUID = 1L;
        
        // 클라이언트 정보
        private String userAgent;
        private String ipAddress;
        private String language;
        private String timezone;
        private String platform; // web, mobile, api
        
        // 세션 통계
        private Integer messageCount;
        private Integer factCheckCount;
        private Integer errorCount;
        private Double averageResponseTime;
        private Long totalTokensUsed;
        
        // 첫 번째/마지막 주제
        private String firstTopic;
        private String lastTopic;
        
        // 세션 품질 지표
        private Double satisfactionScore; // 사용자 만족도 (1-5)
        private Boolean feedbackProvided; // 피드백 제공 여부
        
        // 기타
        private Map<String, Object> customData; // 커스텀 데이터
    }

    // =====================
    // 편의 메서드
    // =====================

    /**
     * 메시지 추가
     */
    public void addMessage(ChatMessage message) {
        if (messages == null) {
            messages = new ArrayList<>();
        }
        messages.add(message);
        updateMetadataOnMessage();
    }

    /**
     * 메시지 추가 후 메타데이터 업데이트
     */
    private void updateMetadataOnMessage() {
        if (metadata == null) {
            metadata = SessionMetadata.builder()
                    .messageCount(0)
                    .factCheckCount(0)
                    .errorCount(0)
                    .build();
        }
        metadata.setMessageCount(messages.size());
    }

    /**
     * 세션 종료
     */
    public void close() {
        this.status = SessionStatus.COMPLETED;
        this.endedAt = LocalDateTime.now();
    }

    /**
     * 세션 만료
     */
    public void expire() {
        this.status = SessionStatus.EXPIRED;
        this.endedAt = LocalDateTime.now();
    }

    /**
     * 활성 세션인지 확인
     */
    public boolean isActive() {
        return status == SessionStatus.ACTIVE;
    }

    /**
     * 동기화 필요 여부 확인
     */
    public boolean needsSync() {
        return !syncedToRdb && (status == SessionStatus.COMPLETED || status == SessionStatus.EXPIRED);
    }

    /**
     * 임베딩 필요 여부 확인
     */
    public boolean needsEmbedding() {
        return syncedToRdb && !embeddedToVectorDb;
    }

    /**
     * 마지막 사용자 메시지 조회
     */
    public ChatMessage getLastUserMessage() {
        if (messages == null || messages.isEmpty()) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            if ("user".equals(messages.get(i).getRole())) {
                return messages.get(i);
            }
        }
        return null;
    }

    /**
     * 마지막 어시스턴트 메시지 조회
     */
    public ChatMessage getLastAssistantMessage() {
        if (messages == null || messages.isEmpty()) {
            return null;
        }
        for (int i = messages.size() - 1; i >= 0; i--) {
            if ("assistant".equals(messages.get(i).getRole())) {
                return messages.get(i);
            }
        }
        return null;
    }

    /**
     * 특정 타입의 메시지 수 조회
     */
    public long countMessagesByType(MessageType type) {
        if (messages == null) {
            return 0;
        }
        return messages.stream()
                .filter(m -> m.getType() == type)
                .count();
    }

    /**
     * 동기화되지 않은 메시지 조회
     */
    public List<ChatMessage> getUnsyncedMessages() {
        if (messages == null) {
            return new ArrayList<>();
        }
        return messages.stream()
                .filter(m -> m.getSynced() == null || !m.getSynced())
                .toList();
    }

    /**
     * 세션 지속 시간 (초)
     */
    public long getDurationSeconds() {
        if (startedAt == null) {
            return 0;
        }
        LocalDateTime end = endedAt != null ? endedAt : LocalDateTime.now();
        return java.time.Duration.between(startedAt, end).getSeconds();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/feedback/SearchFeedback.java

```java
package com.newsinsight.collector.entity.feedback;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing user feedback on search results.
 * Enables quality improvement through user ratings and comments.
 */
@Entity
@Table(name = "search_feedback", indexes = {
        @Index(name = "idx_feedback_search_history_id", columnList = "search_history_id"),
        @Index(name = "idx_feedback_user_id", columnList = "user_id"),
        @Index(name = "idx_feedback_rating", columnList = "rating"),
        @Index(name = "idx_feedback_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchFeedback {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id", nullable = false)
    private Long searchHistoryId;

    /**
     * User who provided feedback
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for anonymous feedback
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Overall rating (1-5 stars)
     */
    @Column(name = "rating")
    private Integer rating;

    /**
     * Usefulness rating (1-5)
     */
    @Column(name = "usefulness_rating")
    private Integer usefulnessRating;

    /**
     * Accuracy rating (1-5)
     */
    @Column(name = "accuracy_rating")
    private Integer accuracyRating;

    /**
     * Relevance rating (1-5)
     */
    @Column(name = "relevance_rating")
    private Integer relevanceRating;

    /**
     * User's comment/feedback text
     */
    @Column(name = "comment", length = 2048)
    private String comment;

    /**
     * Improvement suggestions
     */
    @Column(name = "suggestions", length = 2048)
    private String suggestions;

    /**
     * Feedback type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "feedback_type", length = 32)
    @Builder.Default
    private FeedbackType feedbackType = FeedbackType.GENERAL;

    /**
     * Specific result index being rated (for individual result feedback)
     */
    @Column(name = "result_index")
    private Integer resultIndex;

    /**
     * Specific result URL being rated
     */
    @Column(name = "result_url", length = 2048)
    private String resultUrl;

    /**
     * Quick feedback (thumbs up/down)
     */
    @Column(name = "thumbs_up")
    private Boolean thumbsUp;

    /**
     * Issue categories selected
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "issue_categories", columnDefinition = "jsonb")
    private java.util.List<String> issueCategories;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether feedback has been reviewed by admin
     */
    @Column(name = "reviewed")
    @Builder.Default
    private Boolean reviewed = false;

    /**
     * Review notes by admin
     */
    @Column(name = "review_notes", length = 1024)
    private String reviewNotes;

    /**
     * Whether this feedback was used for model improvement
     */
    @Column(name = "used_for_training")
    @Builder.Default
    private Boolean usedForTraining = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * Feedback type enum
     */
    public enum FeedbackType {
        /** General search feedback */
        GENERAL,
        /** Feedback on specific result */
        RESULT_SPECIFIC,
        /** AI summary feedback */
        AI_SUMMARY,
        /** Fact-check accuracy feedback */
        FACT_CHECK,
        /** Report quality feedback */
        REPORT,
        /** Bug report */
        BUG_REPORT,
        /** Feature request */
        FEATURE_REQUEST
    }

    /**
     * Calculate average rating
     */
    public Double getAverageRating() {
        int count = 0;
        int sum = 0;
        
        if (usefulnessRating != null) { sum += usefulnessRating; count++; }
        if (accuracyRating != null) { sum += accuracyRating; count++; }
        if (relevanceRating != null) { sum += relevanceRating; count++; }
        
        // @CHECK 
        // 평균 평가점수 계산 - 평가점수가 하나라도 있는 경우 평균 평가점수를 반환, 그렇지 않으면 0을 반환
        return count > 0 ? (double) sum / count : (rating != null ? rating.doubleValue() : (double) 0);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/Project.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a user's project workspace.
 * Projects allow users to organize searches, collect news,
 * and collaborate on specific topics over time.
 */
@Entity
@Table(name = "projects", indexes = {
        @Index(name = "idx_project_owner_id", columnList = "owner_id"),
        @Index(name = "idx_project_status", columnList = "status"),
        @Index(name = "idx_project_category", columnList = "category"),
        @Index(name = "idx_project_created_at", columnList = "created_at"),
        @Index(name = "idx_project_last_activity", columnList = "last_activity_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project name
     */
    @Column(name = "name", nullable = false, length = 255)
    private String name;

    /**
     * Project description
     */
    @Column(name = "description", length = 2048)
    private String description;

    /**
     * Keywords for automatic collection
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "keywords", columnDefinition = "jsonb")
    private List<String> keywords;

    /**
     * Project category
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "category", length = 32)
    @Builder.Default
    private ProjectCategory category = ProjectCategory.CUSTOM;

    /**
     * Project status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private ProjectStatus status = ProjectStatus.ACTIVE;

    /**
     * Project visibility
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "visibility", length = 32)
    @Builder.Default
    private ProjectVisibility visibility = ProjectVisibility.PRIVATE;

    /**
     * Project owner ID
     */
    @Column(name = "owner_id", nullable = false, length = 64)
    private String ownerId;

    /**
     * Project color for UI
     */
    @Column(name = "color", length = 16)
    private String color;

    /**
     * Project icon name
     */
    @Column(name = "icon", length = 32)
    private String icon;

    /**
     * Whether this is the default project for the user
     */
    @Column(name = "is_default")
    @Builder.Default
    private Boolean isDefault = false;

    /**
     * Project settings
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "settings", columnDefinition = "jsonb")
    private ProjectSettings settings;

    /**
     * Project statistics (cached)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stats", columnDefinition = "jsonb")
    private Map<String, Object> stats;

    /**
     * Tags for organization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Custom metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "last_activity_at")
    private LocalDateTime lastActivityAt;

    /**
     * When auto-collection last ran
     */
    @Column(name = "last_collected_at")
    private LocalDateTime lastCollectedAt;

    // ============ Enums ============

    public enum ProjectCategory {
        /** Research/Investigation project */
        RESEARCH,
        /** Continuous monitoring project */
        MONITORING,
        /** Fact-checking project */
        FACT_CHECK,
        /** Trend analysis project */
        TREND_ANALYSIS,
        /** Custom/other project */
        CUSTOM
    }

    public enum ProjectStatus {
        /** Active project */
        ACTIVE,
        /** Temporarily paused */
        PAUSED,
        /** Completed project */
        COMPLETED,
        /** Archived project */
        ARCHIVED
    }

    public enum ProjectVisibility {
        /** Only owner can see */
        PRIVATE,
        /** Team members can see */
        TEAM,
        /** Anyone with link can see */
        PUBLIC
    }

    // ============ Embedded classes ============

    /**
     * Project settings configuration
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ProjectSettings {
        /** Enable automatic news collection */
        @Builder.Default
        private Boolean autoCollect = false;
        
        /** Collection interval */
        @Builder.Default
        private String collectInterval = "daily"; // hourly, daily, weekly
        
        /** News sources to collect from */
        private List<String> collectSources;
        
        /** Time window for collection */
        @Builder.Default
        private String timeWindow = "7d";
        
        /** Notification settings */
        private NotificationSettings notifications;
        
        /** AI analysis settings */
        private AiAnalysisSettings aiAnalysis;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class NotificationSettings {
        @Builder.Default
        private Boolean newArticles = true;
        @Builder.Default
        private Boolean importantUpdates = true;
        @Builder.Default
        private Boolean weeklyDigest = false;
        @Builder.Default
        private Boolean emailEnabled = false;
        private String slackWebhook;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AiAnalysisSettings {
        @Builder.Default
        private Boolean enabled = true;
        @Builder.Default
        private Boolean autoSummarize = true;
        @Builder.Default
        private Boolean sentimentTracking = true;
        @Builder.Default
        private Boolean trendDetection = true;
        @Builder.Default
        private Boolean factCheck = false;
    }

    // ============ Helper methods ============

    /**
     * Update last activity timestamp
     */
    public void touchActivity() {
        this.lastActivityAt = LocalDateTime.now();
    }

    /**
     * Check if auto-collection is enabled
     */
    public boolean isAutoCollectEnabled() {
        return settings != null && Boolean.TRUE.equals(settings.getAutoCollect());
    }

    /**
     * Archive the project
     */
    public void archive() {
        this.status = ProjectStatus.ARCHIVED;
    }

    /**
     * Pause the project
     */
    public void pause() {
        this.status = ProjectStatus.PAUSED;
    }

    /**
     * Activate the project
     */
    public void activate() {
        this.status = ProjectStatus.ACTIVE;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectActivityLog.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for tracking project activity.
 * Provides audit trail and activity feed for collaborative projects.
 */
@Entity
@Table(name = "project_activity_log", indexes = {
        @Index(name = "idx_pal_project_id", columnList = "project_id"),
        @Index(name = "idx_pal_user_id", columnList = "user_id"),
        @Index(name = "idx_pal_type", columnList = "activity_type"),
        @Index(name = "idx_pal_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectActivityLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * User who performed the action
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Activity type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "activity_type", nullable = false, length = 64)
    private ActivityType activityType;

    /**
     * Human-readable description
     */
    @Column(name = "description", length = 1024)
    private String description;

    /**
     * Related entity type (e.g., "item", "member", "search")
     */
    @Column(name = "entity_type", length = 64)
    private String entityType;

    /**
     * Related entity ID
     */
    @Column(name = "entity_id", length = 255)
    private String entityId;

    /**
     * Additional metadata/context
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Changes made (for updates)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "changes", columnDefinition = "jsonb")
    private Map<String, Object> changes;

    /**
     * IP address for audit
     */
    @Column(name = "ip_address", length = 64)
    private String ipAddress;

    /**
     * User agent for audit
     */
    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    // ============ Enums ============

    public enum ActivityType {
        // Project lifecycle
        PROJECT_CREATED,
        PROJECT_UPDATED,
        PROJECT_ARCHIVED,
        PROJECT_DELETED,
        PROJECT_RESTORED,
        PROJECT_STATUS_CHANGED,
        
        // Member management
        MEMBER_ADDED,
        MEMBER_INVITED,
        MEMBER_JOINED,
        MEMBER_ROLE_CHANGED,
        MEMBER_REMOVED,
        MEMBER_LEFT,
        
        // Item management
        ITEM_ADDED,
        ITEM_UPDATED,
        ITEM_DELETED,
        ITEM_BOOKMARKED,
        ITEM_TAGGED,
        
        // Search activities
        SEARCH_EXECUTED,
        SEARCH_SAVED,
        SEARCH_SHARED,
        
        // Report activities
        REPORT_GENERATED,
        REPORT_DOWNLOADED,
        REPORT_SHARED,
        
        // Collection activities
        AUTO_COLLECT_RAN,
        AUTO_COLLECTION,
        MANUAL_COLLECTION,
        ITEMS_COLLECTED,
        COLLECTION_FAILED,
        
        // Settings
        SETTINGS_CHANGED,
        KEYWORDS_UPDATED,
        NOTIFICATIONS_CHANGED,
        
        // Comments
        COMMENT_ADDED,
        COMMENT_EDITED,
        COMMENT_DELETED
    }

    // ============ Static factory methods ============

    public static ProjectActivityLog projectCreated(Long projectId, String userId, String projectName) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.PROJECT_CREATED)
                .description("프로젝트 '" + projectName + "'이(가) 생성되었습니다")
                .build();
    }

    public static ProjectActivityLog memberInvited(Long projectId, String userId, String invitedUserId, String role) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.MEMBER_INVITED)
                .description("새 멤버가 " + role + " 역할로 초대되었습니다")
                .entityType("member")
                .entityId(invitedUserId)
                .metadata(Map.of("invitedUserId", invitedUserId, "role", role))
                .build();
    }

    public static ProjectActivityLog itemAdded(Long projectId, String userId, Long itemId, String itemTitle) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.ITEM_ADDED)
                .description("새 항목이 추가되었습니다: " + itemTitle)
                .entityType("item")
                .entityId(String.valueOf(itemId))
                .build();
    }

    public static ProjectActivityLog searchExecuted(Long projectId, String userId, String query, int resultCount) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.SEARCH_EXECUTED)
                .description("검색 실행: '" + query + "' (" + resultCount + "개 결과)")
                .metadata(Map.of("query", query, "resultCount", resultCount))
                .build();
    }

    public static ProjectActivityLog autoCollectRan(Long projectId, int itemsCollected) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .activityType(ActivityType.AUTO_COLLECT_RAN)
                .description("자동 수집 완료: " + itemsCollected + "개 항목 수집")
                .metadata(Map.of("itemsCollected", itemsCollected))
                .build();
    }

    public static ProjectActivityLog reportGenerated(Long projectId, String userId, Long reportId, String reportTitle) {
        return ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(ActivityType.REPORT_GENERATED)
                .description("보고서 생성: " + reportTitle)
                .entityType("report")
                .entityId(String.valueOf(reportId))
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectItem.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing an item within a project.
 * Can be a collected article, search result, report, or note.
 */
@Entity
@Table(name = "project_items", indexes = {
        @Index(name = "idx_pi_project_id", columnList = "project_id"),
        @Index(name = "idx_pi_type", columnList = "item_type"),
        @Index(name = "idx_pi_source_id", columnList = "source_id"),
        @Index(name = "idx_pi_added_at", columnList = "added_at"),
        @Index(name = "idx_pi_published_at", columnList = "published_at"),
        @Index(name = "idx_pi_bookmarked", columnList = "bookmarked")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * Item type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "item_type", nullable = false, length = 32)
    private ItemType itemType;

    /**
     * Source reference ID (SearchHistory ID, Article ID, etc.)
     */
    @Column(name = "source_id", length = 255)
    private String sourceId;

    /**
     * Source type identifier
     */
    @Column(name = "source_type", length = 64)
    private String sourceType;

    /**
     * Item title
     */
    @Column(name = "title", length = 512)
    private String title;

    /**
     * Item summary/excerpt
     */
    @Column(name = "summary", length = 4096)
    private String summary;

    /**
     * Full content (for notes, etc.)
     */
    @Column(name = "content", columnDefinition = "text")
    private String content;

    /**
     * Original URL
     */
    @Column(name = "url", length = 2048)
    private String url;

    /**
     * Thumbnail/image URL
     */
    @Column(name = "thumbnail_url", length = 1024)
    private String thumbnailUrl;

    /**
     * Original publish date
     */
    @Column(name = "published_at")
    private LocalDateTime publishedAt;

    /**
     * Source name (news outlet, etc.)
     */
    @Column(name = "source_name", length = 255)
    private String sourceName;

    /**
     * Author name
     */
    @Column(name = "author", length = 255)
    private String author;

    /**
     * User-defined tags
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Category within project
     */
    @Column(name = "category", length = 128)
    private String category;

    /**
     * Whether bookmarked/starred
     */
    @Column(name = "bookmarked")
    @Builder.Default
    private Boolean bookmarked = false;

    /**
     * Importance level (1-5)
     */
    @Column(name = "importance")
    private Integer importance;

    /**
     * User notes about this item
     */
    @Column(name = "notes", columnDefinition = "text")
    private String notes;

    /**
     * Read status
     */
    @Column(name = "is_read")
    @Builder.Default
    private Boolean isRead = false;

    /**
     * Sentiment score (-1 to 1)
     */
    @Column(name = "sentiment_score")
    private Double sentimentScore;

    /**
     * Sentiment label
     */
    @Column(name = "sentiment_label", length = 32)
    private String sentimentLabel;

    /**
     * Relevance score (0-100)
     */
    @Column(name = "relevance_score")
    private Double relevanceScore;

    /**
     * AI-generated analysis
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_analysis", columnDefinition = "jsonb")
    private Map<String, Object> aiAnalysis;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * User who added this item
     */
    @Column(name = "added_by", length = 64)
    private String addedBy;

    @CreationTimestamp
    @Column(name = "added_at", updatable = false)
    private LocalDateTime addedAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    public enum ItemType {
        /** News article */
        ARTICLE,
        /** Search result reference */
        SEARCH_RESULT,
        /** Generated report */
        REPORT,
        /** User note */
        NOTE,
        /** External URL/link */
        LINK,
        /** File attachment */
        FILE,
        /** Social media post */
        SOCIAL_POST
    }

    // ============ Helper methods ============

    /**
     * Mark as read
     */
    public void markRead() {
        this.isRead = true;
    }

    /**
     * Toggle bookmark
     */
    public void toggleBookmark() {
        this.bookmarked = !Boolean.TRUE.equals(this.bookmarked);
    }

    /**
     * Update importance
     */
    public void setImportanceLevel(int level) {
        this.importance = Math.max(1, Math.min(5, level));
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectMember.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Entity representing a project member.
 * Manages team access and permissions for collaborative projects.
 */
@Entity
@Table(name = "project_members", indexes = {
        @Index(name = "idx_pm_project_id", columnList = "project_id"),
        @Index(name = "idx_pm_user_id", columnList = "user_id"),
        @Index(name = "idx_pm_role", columnList = "role")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_project_member", columnNames = {"project_id", "user_id"})
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * User ID
     */
    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    /**
     * Member role
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "role", length = 32)
    @Builder.Default
    private MemberRole role = MemberRole.VIEWER;

    /**
     * Specific permissions (optional, overrides role defaults)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "permissions", columnDefinition = "jsonb")
    private List<String> permissions;

    /**
     * User who invited this member
     */
    @Column(name = "invited_by", length = 64)
    private String invitedBy;

    /**
     * Invitation status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private MemberStatus status = MemberStatus.PENDING;

    /**
     * Invitation token (for email invites)
     */
    @Column(name = "invite_token", length = 128)
    private String inviteToken;

    /**
     * When the invitation expires
     */
    @Column(name = "invite_expires_at")
    private LocalDateTime inviteExpiresAt;

    @CreationTimestamp
    @Column(name = "joined_at", updatable = false)
    private LocalDateTime joinedAt;

    @Column(name = "last_active_at")
    private LocalDateTime lastActiveAt;

    // ============ Enums ============

    public enum MemberRole {
        /** Full control including delete */
        OWNER,
        /** Can manage members and settings */
        ADMIN,
        /** Can add/edit items */
        EDITOR,
        /** Read-only access */
        VIEWER
    }

    public enum MemberStatus {
        /** Invitation pending acceptance */
        PENDING,
        /** Active member */
        ACTIVE,
        /** Membership revoked */
        REVOKED,
        /** User left the project */
        LEFT
    }

    // ============ Permission constants ============

    public static class Permission {
        public static final String MANAGE_PROJECT = "manage_project";
        public static final String DELETE_PROJECT = "delete_project";
        public static final String INVITE_MEMBERS = "invite_members";
        public static final String REMOVE_MEMBERS = "remove_members";
        public static final String CHANGE_ROLES = "change_roles";
        public static final String ADD_ITEMS = "add_items";
        public static final String EDIT_ITEMS = "edit_items";
        public static final String DELETE_ITEMS = "delete_items";
        public static final String RUN_SEARCH = "run_search";
        public static final String GENERATE_REPORT = "generate_report";
        public static final String CHANGE_SETTINGS = "change_settings";
        public static final String VIEW_ANALYTICS = "view_analytics";
    }

    // ============ Helper methods ============

    /**
     * Check if member has a specific permission
     */
    public boolean hasPermission(String permission) {
        // Owner has all permissions
        if (role == MemberRole.OWNER) return true;
        
        // Check explicit permissions first
        if (permissions != null && permissions.contains(permission)) {
            return true;
        }
        
        // Check role-based permissions
        return switch (role) {
            case ADMIN -> !permission.equals(Permission.DELETE_PROJECT);
            case EDITOR -> permission.equals(Permission.ADD_ITEMS) 
                    || permission.equals(Permission.EDIT_ITEMS)
                    || permission.equals(Permission.RUN_SEARCH)
                    || permission.equals(Permission.GENERATE_REPORT)
                    || permission.equals(Permission.VIEW_ANALYTICS);
            case VIEWER -> permission.equals(Permission.VIEW_ANALYTICS);
            default -> false;
        };
    }

    /**
     * Accept invitation
     */
    public void accept() {
        this.status = MemberStatus.ACTIVE;
        this.inviteToken = null;
        this.inviteExpiresAt = null;
    }

    /**
     * Touch last active timestamp
     */
    public void touchActive() {
        this.lastActiveAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/project/ProjectNotification.java

```java
package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity for project notifications.
 * Manages alerts for project events like new articles, trend spikes, etc.
 */
@Entity
@Table(name = "project_notifications", indexes = {
        @Index(name = "idx_pn_project_id", columnList = "project_id"),
        @Index(name = "idx_pn_type", columnList = "notification_type"),
        @Index(name = "idx_pn_priority", columnList = "priority"),
        @Index(name = "idx_pn_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectNotification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * Target user ID (single recipient for simple notifications)
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Whether this notification has been read
     */
    @Column(name = "is_read")
    @Builder.Default
    private Boolean isRead = false;

    /**
     * Notification type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "notification_type", nullable = false, length = 64)
    private NotificationType notificationType;

    /**
     * Priority level
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "priority", length = 32)
    @Builder.Default
    private NotificationPriority priority = NotificationPriority.MEDIUM;

    /**
     * Notification title
     */
    @Column(name = "title", nullable = false, length = 255)
    private String title;

    /**
     * Notification message
     */
    @Column(name = "message", length = 2048)
    private String message;

    /**
     * Action URL (click to navigate)
     */
    @Column(name = "action_url", length = 1024)
    private String actionUrl;

    /**
     * Action button label
     */
    @Column(name = "action_label", length = 64)
    private String actionLabel;

    /**
     * Recipients (user IDs)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recipients", columnDefinition = "jsonb")
    private List<String> recipients;

    /**
     * Delivery channels
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "channels", columnDefinition = "jsonb")
    private List<String> channels;

    /**
     * Users who have read this notification
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "read_by", columnDefinition = "jsonb")
    private List<String> readBy;

    /**
     * Delivery status per channel
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "delivery_status", columnDefinition = "jsonb")
    private Map<String, Object> deliveryStatus;

    /**
     * Additional data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether notification has been dismissed by all
     */
    @Column(name = "dismissed")
    @Builder.Default
    private Boolean dismissed = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "sent_at")
    private LocalDateTime sentAt;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    // ============ Enums ============

    public enum NotificationType {
        /** New articles collected */
        NEW_ARTICLES,
        /** Significant trend change */
        TREND_SPIKE,
        /** Important news alert */
        IMPORTANT_UPDATE,
        /** Team member activity */
        MEMBER_ACTIVITY,
        /** Member invited to project */
        MEMBER_INVITED,
        /** Report ready for download */
        REPORT_READY,
        /** Collection completed */
        COLLECTION_COMPLETE,
        /** Collection failed */
        COLLECTION_FAILED,
        /** System notification */
        SYSTEM_ALERT,
        /** Weekly/monthly digest */
        DIGEST,
        /** Keyword match alert */
        KEYWORD_MATCH
    }

    public enum NotificationPriority {
        LOW,
        MEDIUM,
        HIGH,
        URGENT
    }

    public static class Channel {
        public static final String IN_APP = "in_app";
        public static final String EMAIL = "email";
        public static final String SLACK = "slack";
        public static final String WEBHOOK = "webhook";
        public static final String PUSH = "push";
    }

    // ============ Helper methods ============

    /**
     * Mark as read by user
     */
    public void markReadBy(String userId) {
        if (readBy == null) {
            readBy = new java.util.ArrayList<>();
        }
        if (!readBy.contains(userId)) {
            readBy.add(userId);
        }
    }

    /**
     * Check if read by user
     */
    public boolean isReadBy(String userId) {
        return readBy != null && readBy.contains(userId);
    }

    /**
     * Check if expired
     */
    public boolean isExpired() {
        return expiresAt != null && LocalDateTime.now().isAfter(expiresAt);
    }

    /**
     * Mark as sent
     */
    public void markSent() {
        this.sentAt = LocalDateTime.now();
    }

    // ============ Static factory methods ============

    public static ProjectNotification newArticles(Long projectId, int count, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.NEW_ARTICLES)
                .priority(NotificationPriority.MEDIUM)
                .title("새로운 기사 수집")
                .message(count + "개의 새로운 기사가 수집되었습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP))
                .actionLabel("보기")
                .metadata(Map.of("articleCount", count))
                .build();
    }

    public static ProjectNotification trendSpike(Long projectId, String keyword, double changePercent, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.TREND_SPIKE)
                .priority(NotificationPriority.HIGH)
                .title("트렌드 급등 감지")
                .message("'" + keyword + "' 키워드가 " + String.format("%.1f", changePercent) + "% 증가했습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP, Channel.EMAIL))
                .actionLabel("분석 보기")
                .metadata(Map.of("keyword", keyword, "changePercent", changePercent))
                .build();
    }

    public static ProjectNotification reportReady(Long projectId, Long reportId, String reportTitle, List<String> recipients) {
        return ProjectNotification.builder()
                .projectId(projectId)
                .notificationType(NotificationType.REPORT_READY)
                .priority(NotificationPriority.MEDIUM)
                .title("보고서 생성 완료")
                .message("'" + reportTitle + "' 보고서가 준비되었습니다")
                .recipients(recipients)
                .channels(List.of(Channel.IN_APP))
                .actionLabel("다운로드")
                .actionUrl("/reports/" + reportId)
                .metadata(Map.of("reportId", reportId, "reportTitle", reportTitle))
                .build();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/report/GeneratedReport.java

```java
package com.newsinsight.collector.entity.report;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing generated reports.
 * Tracks PDF/document generation from search results
 * enabling re-download and sharing features.
 */
@Entity
@Table(name = "generated_reports", indexes = {
        @Index(name = "idx_report_search_history_id", columnList = "search_history_id"),
        @Index(name = "idx_report_user_id", columnList = "user_id"),
        @Index(name = "idx_report_project_id", columnList = "project_id"),
        @Index(name = "idx_report_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class GeneratedReport {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Related search history ID
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if part of a project
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * User who generated the report
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Report title
     */
    @Column(name = "title", length = 512)
    private String title;

    /**
     * Report type (PDF, MARKDOWN, HTML, JSON)
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "report_type", length = 32)
    @Builder.Default
    private ReportType reportType = ReportType.PDF;

    /**
     * Report format/template used
     */
    @Column(name = "template_name", length = 64)
    private String templateName;

    /**
     * File storage path or URL
     */
    @Column(name = "file_path", length = 1024)
    private String filePath;

    /**
     * Public URL for sharing (if enabled)
     */
    @Column(name = "public_url", length = 1024)
    private String publicUrl;

    /**
     * File size in bytes
     */
    @Column(name = "file_size")
    private Long fileSize;

    /**
     * MIME type
     */
    @Column(name = "mime_type", length = 64)
    private String mimeType;

    /**
     * Generation status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private ReportStatus status = ReportStatus.PENDING;

    /**
     * Error message if generation failed
     */
    @Column(name = "error_message", length = 1024)
    private String errorMessage;

    /**
     * Report metadata (sections, charts included, etc.)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Report configuration/options used
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "config", columnDefinition = "jsonb")
    private Map<String, Object> config;

    /**
     * Number of times downloaded
     */
    @Column(name = "download_count")
    @Builder.Default
    private Integer downloadCount = 0;

    /**
     * Last download time
     */
    @Column(name = "last_downloaded_at")
    private LocalDateTime lastDownloadedAt;

    /**
     * Whether report is shared publicly
     */
    @Column(name = "is_public")
    @Builder.Default
    private Boolean isPublic = false;

    /**
     * Share link expiry time
     */
    @Column(name = "share_expires_at")
    private LocalDateTime shareExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "generated_at")
    private LocalDateTime generatedAt;

    /**
     * Report type enum
     */
    public enum ReportType {
        PDF,
        MARKDOWN,
        HTML,
        JSON,
        DOCX,
        XLSX
    }

    /**
     * Report status enum
     */
    public enum ReportStatus {
        PENDING,
        GENERATING,
        COMPLETED,
        FAILED,
        EXPIRED
    }

    /**
     * Mark report as generated
     */
    public void markGenerated(String filePath, Long fileSize) {
        this.status = ReportStatus.COMPLETED;
        this.filePath = filePath;
        this.fileSize = fileSize;
        this.generatedAt = LocalDateTime.now();
    }

    /**
     * Mark report as failed
     */
    public void markFailed(String errorMessage) {
        this.status = ReportStatus.FAILED;
        this.errorMessage = errorMessage;
    }

    /**
     * Increment download count
     */
    public void incrementDownload() {
        this.downloadCount++;
        this.lastDownloadedAt = LocalDateTime.now();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/DraftSearch.java

```java
package com.newsinsight.collector.entity.search;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Entity for storing user's draft/unsaved searches.
 * Captures search inputs that haven't been executed yet,
 * enabling "Continue Work" feature for incomplete searches.
 */
@Entity
@Table(name = "draft_searches", indexes = {
        @Index(name = "idx_draft_search_user_id", columnList = "user_id"),
        @Index(name = "idx_draft_search_session_id", columnList = "session_id"),
        @Index(name = "idx_draft_search_created_at", columnList = "created_at"),
        @Index(name = "idx_draft_search_executed", columnList = "executed")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DraftSearch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Search query entered by user
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Type of search intended
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "search_type", length = 32)
    @Builder.Default
    private SearchType searchType = SearchType.UNIFIED;

    /**
     * User ID
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for anonymous users
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Time window selected (1d, 7d, 30d, etc.)
     */
    @Column(name = "time_window", length = 16)
    private String timeWindow;

    /**
     * Search mode (standard, deep, fact-check, etc.)
     */
    @Column(name = "search_mode", length = 32)
    private String searchMode;

    /**
     * Additional options/parameters
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "options", columnDefinition = "jsonb")
    private Map<String, Object> options;

    /**
     * Whether this draft has been executed
     */
    @Column(name = "executed")
    @Builder.Default
    private Boolean executed = false;

    /**
     * When the draft was executed
     */
    @Column(name = "executed_at")
    private LocalDateTime executedAt;

    /**
     * Reference to the executed search history
     */
    @Column(name = "search_history_id")
    private Long searchHistoryId;

    /**
     * Project ID if associated with a project
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * Source page/context where the draft was created
     */
    @Column(name = "source_context", length = 128)
    private String sourceContext;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Mark draft as executed
     */
    public void markExecuted(Long searchHistoryId) {
        this.executed = true;
        this.executedAt = LocalDateTime.now();
        this.searchHistoryId = searchHistoryId;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchHistory.java

```java
package com.newsinsight.collector.entity.search;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a search history record.
 * Stores the search query, results, and metadata for all search types
 * (unified search, deep search, fact check, browser agent).
 */
@Entity
@Table(name = "search_history", indexes = {
        @Index(name = "idx_search_history_type", columnList = "search_type"),
        @Index(name = "idx_search_history_query", columnList = "query"),
        @Index(name = "idx_search_history_created_at", columnList = "created_at"),
        @Index(name = "idx_search_history_user_id", columnList = "user_id"),
        @Index(name = "idx_search_history_parent_id", columnList = "parent_search_id"),
        @Index(name = "idx_search_history_completion_status", columnList = "completion_status"),
        @Index(name = "idx_search_history_project_id", columnList = "project_id")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * External reference ID (e.g., jobId from search job)
     */
    @Column(name = "external_id", length = 64, unique = true)
    private String externalId;

    /**
     * Type of search performed
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "search_type", nullable = false, length = 32)
    private SearchType searchType;

    /**
     * The search query or topic
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Time window for search (e.g., 1d, 7d, 30d)
     */
    @Column(length = 16)
    private String timeWindow;

    /**
     * Optional user ID for multi-user scenarios
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Session ID for grouping searches
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * Parent search ID for derived/drilldown searches
     */
    @Column(name = "parent_search_id")
    private Long parentSearchId;

    /**
     * Depth level for drilldown searches (0 = original, 1+ = drilldown)
     */
    @Column(name = "depth_level")
    @Builder.Default
    private Integer depthLevel = 0;

    /**
     * Total number of results found
     */
    @Column(name = "result_count")
    @Builder.Default
    private Integer resultCount = 0;

    /**
     * Search results stored as JSON
     * Contains list of search result items with their analysis data
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "results", columnDefinition = "jsonb")
    private List<Map<String, Object>> results;

    /**
     * AI summary/response stored as JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "ai_summary", columnDefinition = "jsonb")
    private Map<String, Object> aiSummary;

    /**
     * URLs discovered during search (for auto-collection)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "discovered_urls", columnDefinition = "jsonb")
    private List<String> discoveredUrls;

    /**
     * Fact check results (for FACT_CHECK type)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fact_check_results", columnDefinition = "jsonb")
    private List<Map<String, Object>> factCheckResults;

    /**
     * Overall credibility score (0-100)
     */
    @Column(name = "credibility_score")
    private Double credibilityScore;

    /**
     * Stance distribution (pro, con, neutral counts)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stance_distribution", columnDefinition = "jsonb")
    private Map<String, Object> stanceDistribution;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Whether this search has been bookmarked/starred
     */
    @Column
    @Builder.Default
    private Boolean bookmarked = false;

    /**
     * User-provided tags for organization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * User notes about this search
     */
    @Column(columnDefinition = "text")
    private String notes;

    /**
     * Search duration in milliseconds
     */
    @Column(name = "duration_ms")
    private Long durationMs;

    /**
     * Error message if search failed
     */
    @Column(name = "error_message", length = 2048)
    private String errorMessage;

    /**
     * Whether the search completed successfully
     */
    @Column
    @Builder.Default
    private Boolean success = true;

    // ============ New fields for improved tracking ============

    /**
     * Completion status for "Continue Work" feature
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "completion_status", length = 32)
    @Builder.Default
    private CompletionStatus completionStatus = CompletionStatus.IN_PROGRESS;

    /**
     * Whether the user has viewed the results
     */
    @Column(name = "viewed")
    @Builder.Default
    private Boolean viewed = false;

    /**
     * When the user viewed the results
     */
    @Column(name = "viewed_at")
    private LocalDateTime viewedAt;

    /**
     * Whether a report has been generated for this search
     */
    @Column(name = "report_generated")
    @Builder.Default
    private Boolean reportGenerated = false;

    /**
     * Phase where failure occurred (for debugging)
     * e.g., "db_search", "web_crawl", "ai_analysis"
     */
    @Column(name = "failure_phase", length = 64)
    private String failurePhase;

    /**
     * Detailed failure information
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "failure_details", columnDefinition = "jsonb")
    private Map<String, Object> failureDetails;

    /**
     * Partial results saved before failure
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "partial_results", columnDefinition = "jsonb")
    private List<Map<String, Object>> partialResults;

    /**
     * Progress percentage (0-100) for long-running searches
     */
    @Column(name = "progress")
    @Builder.Default
    private Integer progress = 0;

    /**
     * Current phase description for UI display
     */
    @Column(name = "current_phase", length = 128)
    private String currentPhase;

    /**
     * Project ID for project-based organization
     */
    @Column(name = "project_id")
    private Long projectId;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    /**
     * Completion status for tracking search progress
     */
    public enum CompletionStatus {
        /** Search input saved but not executed */
        DRAFT,
        /** Search is currently running */
        IN_PROGRESS,
        /** Some sources succeeded, some failed */
        PARTIAL,
        /** Search completed successfully */
        COMPLETED,
        /** Search failed */
        FAILED,
        /** Search was cancelled by user */
        CANCELLED
    }

    // ============ Helper methods ============

    /**
     * Convenience method to check if this is a derived search
     */
    public boolean isDerivedSearch() {
        return parentSearchId != null && parentSearchId > 0;
    }

    /**
     * Get result count safely
     */
    public int getResultCountSafe() {
        if (results != null) {
            return results.size();
        }
        return resultCount != null ? resultCount : 0;
    }

    /**
     * Check if this search needs to be continued
     */
    public boolean needsContinuation() {
        if (completionStatus == null) {
            return !Boolean.TRUE.equals(success);
        }
        return completionStatus == CompletionStatus.DRAFT
                || completionStatus == CompletionStatus.IN_PROGRESS
                || completionStatus == CompletionStatus.PARTIAL
                || completionStatus == CompletionStatus.FAILED;
    }

    /**
     * Check if this search is actionable (should show in "Continue Work")
     */
    public boolean isActionable() {
        // Exclude completed searches that have been viewed
        if (completionStatus == CompletionStatus.COMPLETED && Boolean.TRUE.equals(viewed)) {
            return false;
        }
        // Exclude bookmarked or report-generated searches
        if (Boolean.TRUE.equals(bookmarked) || Boolean.TRUE.equals(reportGenerated)) {
            return false;
        }
        return needsContinuation() || (completionStatus == CompletionStatus.COMPLETED && !Boolean.TRUE.equals(viewed));
    }

    /**
     * Mark as viewed
     */
    public void markViewed() {
        this.viewed = true;
        this.viewedAt = LocalDateTime.now();
    }

    /**
     * Mark as completed
     */
    public void markCompleted() {
        this.completionStatus = CompletionStatus.COMPLETED;
        this.success = true;
        this.progress = 100;
    }

    /**
     * Mark as failed with details
     */
    public void markFailed(String phase, String errorMessage, Map<String, Object> details) {
        this.completionStatus = CompletionStatus.FAILED;
        this.success = false;
        this.failurePhase = phase;
        this.errorMessage = errorMessage;
        this.failureDetails = details;
    }

    /**
     * Update progress
     */
    public void updateProgress(int progress, String phase) {
        this.progress = Math.min(100, Math.max(0, progress));
        this.currentPhase = phase;
        if (this.completionStatus == CompletionStatus.DRAFT) {
            this.completionStatus = CompletionStatus.IN_PROGRESS;
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchTemplate.java

```java
package com.newsinsight.collector.entity.search;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Entity representing a saved search template.
 * Templates allow users to save search configurations with selected items
 * for reuse in SmartSearch.
 */
@Entity
@Table(name = "search_template", indexes = {
        @Index(name = "idx_search_template_user_id", columnList = "user_id"),
        @Index(name = "idx_search_template_mode", columnList = "mode"),
        @Index(name = "idx_search_template_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Template name (user-defined)
     */
    @Column(nullable = false, length = 256)
    private String name;

    /**
     * Search query associated with this template
     */
    @Column(nullable = false, length = 1024)
    private String query;

    /**
     * Search mode (unified, deep, factcheck)
     */
    @Column(nullable = false, length = 32)
    private String mode;

    /**
     * User ID who created this template
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Selected items stored as JSON array
     * Each item contains: id, type, title, url, snippet, source, stance, verificationStatus
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "items", columnDefinition = "jsonb")
    private List<Map<String, Object>> items;

    /**
     * Optional description for the template
     */
    @Column(columnDefinition = "text")
    private String description;

    /**
     * Whether this template is marked as favorite
     */
    @Column
    @Builder.Default
    private Boolean favorite = false;

    /**
     * Tags for categorization
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<String> tags;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * Reference to original search history (if created from a search)
     */
    @Column(name = "source_search_id")
    private Long sourceSearchId;

    /**
     * Number of times this template has been used
     */
    @Column(name = "use_count")
    @Builder.Default
    private Integer useCount = 0;

    /**
     * Last time this template was used
     */
    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    /**
     * Increment use count and update last used timestamp
     */
    public void recordUsage() {
        this.useCount = (this.useCount != null ? this.useCount : 0) + 1;
        this.lastUsedAt = LocalDateTime.now();
    }

    /**
     * Get item count safely
     */
    public int getItemCount() {
        return items != null ? items.size() : 0;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/search/SearchType.java

```java
package com.newsinsight.collector.entity.search;

/**
 * Types of searches that can be performed and stored.
 */
public enum SearchType {
    /** Unified parallel search (DB + Web + AI) */
    UNIFIED,
    
    /** Deep AI search with crawl agents */
    DEEP_SEARCH,
    
    /** Fact verification search */
    FACT_CHECK,
    
    /** Browser agent research */
    BROWSER_AGENT
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/settings/LlmProviderSettings.java

```java
package com.newsinsight.collector.entity.settings;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * LLM Provider 설정 엔티티.
 * 
 * 관리자(전역) 설정과 사용자별 설정을 통합 관리.
 * - userId가 null이면 전역(관리자) 설정
 * - userId가 있으면 해당 사용자의 개인 설정
 * 
 * 사용자 설정이 존재하면 전역 설정보다 우선 적용됨.
 */
@Entity
@Table(name = "llm_provider_settings", 
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_llm_provider_user", columnNames = {"provider_type", "user_id"})
    },
    indexes = {
        @Index(name = "idx_llm_settings_user", columnList = "user_id"),
        @Index(name = "idx_llm_settings_provider", columnList = "provider_type"),
        @Index(name = "idx_llm_settings_enabled", columnList = "enabled")
    }
)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LlmProviderSettings {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * LLM 제공자 타입
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "provider_type", nullable = false, length = 30)
    private LlmProviderType providerType;

    /**
     * 사용자 ID (null = 전역/관리자 설정)
     */
    @Column(name = "user_id", length = 100)
    private String userId;

    /**
     * API 키 (암호화 저장 권장)
     */
    @Column(name = "api_key", columnDefinition = "TEXT")
    private String apiKey;

    /**
     * 기본 모델명
     * 예: gpt-4o, claude-3-5-sonnet-20241022, gemini-1.5-pro
     */
    @Column(name = "default_model", length = 100)
    private String defaultModel;

    /**
     * API Base URL (커스텀 엔드포인트용)
     */
    @Column(name = "base_url", length = 500)
    private String baseUrl;

    /**
     * 활성화 여부
     */
    @Column(name = "enabled", nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /**
     * 우선순위 (낮을수록 먼저 사용, fallback 체인용)
     */
    @Column(name = "priority")
    @Builder.Default
    private Integer priority = 100;

    /**
     * 최대 토큰 수
     */
    @Column(name = "max_tokens")
    @Builder.Default
    private Integer maxTokens = 4096;

    /**
     * Temperature (0.0 ~ 2.0)
     */
    @Column(name = "temperature")
    @Builder.Default
    private Double temperature = 0.7;

    /**
     * 요청 타임아웃 (밀리초)
     */
    @Column(name = "timeout_ms")
    @Builder.Default
    private Integer timeoutMs = 60000;

    /**
     * 분당 최대 요청 수 (Rate limiting)
     */
    @Column(name = "max_requests_per_minute")
    @Builder.Default
    private Integer maxRequestsPerMinute = 60;

    /**
     * Azure OpenAI 전용: Deployment Name
     */
    @Column(name = "azure_deployment_name", length = 100)
    private String azureDeploymentName;

    /**
     * Azure OpenAI 전용: API Version
     */
    @Column(name = "azure_api_version", length = 20)
    private String azureApiVersion;

    /**
     * 마지막 테스트 성공 시간
     */
    @Column(name = "last_tested_at")
    private LocalDateTime lastTestedAt;

    /**
     * 마지막 테스트 결과
     */
    @Column(name = "last_test_success")
    private Boolean lastTestSuccess;

    /**
     * 생성일시
     */
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    /**
     * 수정일시
     */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // === Helper Methods ===

    /**
     * 전역(관리자) 설정인지 확인
     */
    public boolean isGlobal() {
        return userId == null || userId.isBlank();
    }

    /**
     * 사용자별 설정인지 확인
     */
    public boolean isUserSpecific() {
        return userId != null && !userId.isBlank();
    }

    /**
     * API 키 마스킹 (표시용)
     */
    public String getMaskedApiKey() {
        if (apiKey == null || apiKey.length() < 8) {
            return "****";
        }
        return apiKey.substring(0, 4) + "****" + apiKey.substring(apiKey.length() - 4);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/settings/LlmProviderType.java

```java
package com.newsinsight.collector.entity.settings;

/**
 * LLM Provider 종류
 */
public enum LlmProviderType {
    OPENAI("OpenAI", "https://api.openai.com/v1"),
    ANTHROPIC("Anthropic", "https://api.anthropic.com"),
    GOOGLE("Google AI", "https://generativelanguage.googleapis.com/v1beta"),
    OPENROUTER("OpenRouter", "https://openrouter.ai/api/v1"),
    OLLAMA("Ollama", "http://localhost:11434"),
    AZURE_OPENAI("Azure OpenAI", null),
    TOGETHER_AI("Together AI", "https://api.together.xyz/v1"),
    CUSTOM("Custom", null);

    private final String displayName;
    private final String defaultBaseUrl;

    LlmProviderType(String displayName, String defaultBaseUrl) {
        this.displayName = displayName;
        this.defaultBaseUrl = defaultBaseUrl;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getDefaultBaseUrl() {
        return defaultBaseUrl;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/entity/workspace/WorkspaceFile.java

```java
package com.newsinsight.collector.entity.workspace;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * Entity representing a file stored in user's workspace.
 * File metadata is stored in PostgreSQL, actual file content on local disk/S3.
 */
@Entity
@Table(name = "workspace_files", indexes = {
        @Index(name = "idx_workspace_file_session_id", columnList = "session_id"),
        @Index(name = "idx_workspace_file_user_id", columnList = "user_id"),
        @Index(name = "idx_workspace_file_project_id", columnList = "project_id"),
        @Index(name = "idx_workspace_file_file_type", columnList = "file_type"),
        @Index(name = "idx_workspace_file_status", columnList = "status"),
        @Index(name = "idx_workspace_file_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WorkspaceFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Unique file identifier (UUID for secure access)
     */
    @Column(name = "file_uuid", nullable = false, unique = true, length = 36)
    @Builder.Default
    private String fileUuid = UUID.randomUUID().toString();

    /**
     * Session ID for anonymous users
     */
    @Column(name = "session_id", length = 64)
    private String sessionId;

    /**
     * User ID for authenticated users (optional)
     */
    @Column(name = "user_id", length = 64)
    private String userId;

    /**
     * Associated project ID (optional)
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * Original file name
     */
    @Column(name = "original_name", nullable = false, length = 512)
    private String originalName;

    /**
     * Stored file name (UUID-based for uniqueness)
     */
    @Column(name = "stored_name", nullable = false, length = 128)
    private String storedName;

    /**
     * File extension (e.g., pdf, xlsx, csv)
     */
    @Column(name = "extension", length = 32)
    private String extension;

    /**
     * MIME type
     */
    @Column(name = "mime_type", length = 128)
    private String mimeType;

    /**
     * File size in bytes
     */
    @Column(name = "file_size", nullable = false)
    private Long fileSize;

    /**
     * File type category
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "file_type", length = 32)
    @Builder.Default
    private FileType fileType = FileType.OTHER;

    /**
     * Storage location type
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "storage_type", length = 32)
    @Builder.Default
    private StorageType storageType = StorageType.LOCAL;

    /**
     * Storage path (relative path for local, key for S3)
     */
    @Column(name = "storage_path", nullable = false, length = 1024)
    private String storagePath;

    /**
     * File status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private FileStatus status = FileStatus.ACTIVE;

    /**
     * File description
     */
    @Column(name = "description", length = 1024)
    private String description;

    /**
     * File checksum (SHA-256)
     */
    @Column(name = "checksum", length = 64)
    private String checksum;

    /**
     * Download count
     */
    @Column(name = "download_count")
    @Builder.Default
    private Integer downloadCount = 0;

    /**
     * Last accessed time
     */
    @Column(name = "last_accessed_at")
    private LocalDateTime lastAccessedAt;

    /**
     * Expiration time (for temporary files)
     */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    /**
     * Additional metadata
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // ============ Enums ============

    public enum FileType {
        /** Document files (PDF, DOC, TXT) */
        DOCUMENT,
        /** Spreadsheet files (XLSX, CSV) */
        SPREADSHEET,
        /** Image files (PNG, JPG, GIF) */
        IMAGE,
        /** Data files (JSON, XML) */
        DATA,
        /** Archive files (ZIP, TAR) */
        ARCHIVE,
        /** Report files (generated reports) */
        REPORT,
        /** Other files */
        OTHER
    }

    public enum StorageType {
        /** Local file system storage */
        LOCAL,
        /** AWS S3 storage */
        S3,
        /** Google Cloud Storage */
        GCS
    }

    public enum FileStatus {
        /** File is active and accessible */
        ACTIVE,
        /** File is being uploaded */
        UPLOADING,
        /** File is being processed */
        PROCESSING,
        /** File has been archived */
        ARCHIVED,
        /** File is scheduled for deletion */
        PENDING_DELETE,
        /** File has been deleted */
        DELETED
    }

    // ============ Helper methods ============

    /**
     * Check if file is owned by session
     */
    public boolean isOwnedBySession(String sessionId) {
        return this.sessionId != null && this.sessionId.equals(sessionId);
    }

    /**
     * Check if file is owned by user
     */
    public boolean isOwnedByUser(String userId) {
        return this.userId != null && this.userId.equals(userId);
    }

    /**
     * Check if file is accessible by session or user
     */
    public boolean isAccessibleBy(String sessionId, String userId) {
        if (sessionId != null && isOwnedBySession(sessionId)) {
            return true;
        }
        if (userId != null && isOwnedByUser(userId)) {
            return true;
        }
        return false;
    }

    /**
     * Increment download count
     */
    public void incrementDownloadCount() {
        this.downloadCount = (this.downloadCount == null ? 0 : this.downloadCount) + 1;
        this.lastAccessedAt = LocalDateTime.now();
    }

    /**
     * Mark as deleted
     */
    public void markDeleted() {
        this.status = FileStatus.DELETED;
    }

    /**
     * Check if file is expired
     */
    public boolean isExpired() {
        return this.expiresAt != null && LocalDateTime.now().isAfter(this.expiresAt);
    }

    /**
     * Get human-readable file size
     */
    public String getHumanReadableSize() {
        if (fileSize == null) return "0 B";
        
        long bytes = fileSize;
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        if (bytes < 1024 * 1024 * 1024) return String.format("%.1f MB", bytes / (1024.0 * 1024));
        return String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024));
    }

    /**
     * Determine file type from extension
     */
    public static FileType determineFileType(String extension) {
        if (extension == null) return FileType.OTHER;
        
        String ext = extension.toLowerCase();
        return switch (ext) {
            case "pdf", "doc", "docx", "txt", "rtf", "odt" -> FileType.DOCUMENT;
            case "xls", "xlsx", "csv", "ods" -> FileType.SPREADSHEET;
            case "png", "jpg", "jpeg", "gif", "bmp", "svg", "webp" -> FileType.IMAGE;
            case "json", "xml", "yaml", "yml" -> FileType.DATA;
            case "zip", "tar", "gz", "rar", "7z" -> FileType.ARCHIVE;
            default -> FileType.OTHER;
        };
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/ChatExceptionHandler.java

```java
package com.newsinsight.collector.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * 채팅 서비스 전역 예외 핸들러
 */
@RestControllerAdvice(basePackages = "com.newsinsight.collector.controller")
@Slf4j
public class ChatExceptionHandler {

    @ExceptionHandler(SessionException.class)
    public ResponseEntity<Map<String, Object>> handleSessionException(SessionException ex) {
        log.error("Session error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.BAD_REQUEST.value()
        );
        
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
    }

    @ExceptionHandler(SyncException.class)
    public ResponseEntity<Map<String, Object>> handleSyncException(SyncException ex) {
        log.error("Sync error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    @ExceptionHandler(VectorEmbeddingException.class)
    public ResponseEntity<Map<String, Object>> handleVectorEmbeddingException(VectorEmbeddingException ex) {
        log.error("Vector embedding error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.SERVICE_UNAVAILABLE.value()
        );
        
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(response);
    }

    @ExceptionHandler(ChatServiceException.class)
    public ResponseEntity<Map<String, Object>> handleChatServiceException(ChatServiceException ex) {
        log.error("Chat service error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                ex.getErrorCode(),
                ex.getMessage(),
                ex.getSessionId(),
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGenericException(Exception ex) {
        log.error("Unexpected error: {}", ex.getMessage(), ex);
        
        Map<String, Object> response = createErrorResponse(
                "INTERNAL_ERROR",
                "An unexpected error occurred",
                null,
                HttpStatus.INTERNAL_SERVER_ERROR.value()
        );
        
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }

    private Map<String, Object> createErrorResponse(String errorCode, String message, String sessionId, int status) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("error", errorCode);
        response.put("message", message);
        response.put("status", status);
        response.put("timestamp", LocalDateTime.now().toString());
        
        if (sessionId != null) {
            response.put("sessionId", sessionId);
        }
        
        return response;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/ChatServiceException.java

```java
package com.newsinsight.collector.exception;

/**
 * 채팅 서비스 관련 예외 기본 클래스
 */
public class ChatServiceException extends RuntimeException {
    
    private final String errorCode;
    private final String sessionId;

    public ChatServiceException(String message) {
        super(message);
        this.errorCode = "CHAT_ERROR";
        this.sessionId = null;
    }

    public ChatServiceException(String message, Throwable cause) {
        super(message, cause);
        this.errorCode = "CHAT_ERROR";
        this.sessionId = null;
    }

    public ChatServiceException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
        this.sessionId = null;
    }

    public ChatServiceException(String errorCode, String message, String sessionId) {
        super(message);
        this.errorCode = errorCode;
        this.sessionId = sessionId;
    }

    public ChatServiceException(String errorCode, String message, String sessionId, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
        this.sessionId = sessionId;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public String getSessionId() {
        return sessionId;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/SessionException.java

```java
package com.newsinsight.collector.exception;

/**
 * 세션 관련 예외
 */
public class SessionException extends ChatServiceException {

    public SessionException(String message) {
        super("SESSION_ERROR", message);
    }

    public SessionException(String message, String sessionId) {
        super("SESSION_ERROR", message, sessionId);
    }

    public SessionException(String message, String sessionId, Throwable cause) {
        super("SESSION_ERROR", message, sessionId, cause);
    }

    /**
     * 세션을 찾을 수 없을 때
     */
    public static SessionException notFound(String sessionId) {
        return new SessionException("Session not found: " + sessionId, sessionId);
    }

    /**
     * 세션이 만료되었을 때
     */
    public static SessionException expired(String sessionId) {
        return new SessionException("Session has expired: " + sessionId, sessionId);
    }

    /**
     * 세션이 이미 종료되었을 때
     */
    public static SessionException alreadyClosed(String sessionId) {
        return new SessionException("Session is already closed: " + sessionId, sessionId);
    }

    /**
     * 세션 생성 실패
     */
    public static SessionException creationFailed(String sessionId, Throwable cause) {
        return new SessionException("Failed to create session: " + sessionId, sessionId, cause);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/SyncException.java

```java
package com.newsinsight.collector.exception;

/**
 * 동기화 관련 예외
 */
public class SyncException extends ChatServiceException {

    public SyncException(String message) {
        super("SYNC_ERROR", message);
    }

    public SyncException(String message, String sessionId) {
        super("SYNC_ERROR", message, sessionId);
    }

    public SyncException(String message, String sessionId, Throwable cause) {
        super("SYNC_ERROR", message, sessionId, cause);
    }

    /**
     * RDB 동기화 실패
     */
    public static SyncException rdbSyncFailed(String sessionId, Throwable cause) {
        return new SyncException("Failed to sync session to RDB: " + sessionId, sessionId, cause);
    }

    /**
     * 벡터 DB 임베딩 실패
     */
    public static SyncException embeddingFailed(String sessionId, Throwable cause) {
        return new SyncException("Failed to embed session to vector DB: " + sessionId, sessionId, cause);
    }

    /**
     * 동기화 타임아웃
     */
    public static SyncException timeout(String sessionId) {
        return new SyncException("Sync operation timed out for session: " + sessionId, sessionId);
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/exception/VectorEmbeddingException.java

```java
package com.newsinsight.collector.exception;

/**
 * 벡터 임베딩 관련 예외
 */
public class VectorEmbeddingException extends ChatServiceException {

    public VectorEmbeddingException(String message) {
        super("VECTOR_ERROR", message);
    }

    public VectorEmbeddingException(String message, Throwable cause) {
        super("VECTOR_ERROR", message, null, cause);
    }

    public VectorEmbeddingException(String message, String sessionId, Throwable cause) {
        super("VECTOR_ERROR", message, sessionId, cause);
    }

    /**
     * 벡터 DB 연결 실패
     */
    public static VectorEmbeddingException connectionFailed(Throwable cause) {
        return new VectorEmbeddingException("Failed to connect to vector DB", cause);
    }

    /**
     * 임베딩 생성 실패
     */
    public static VectorEmbeddingException embeddingGenerationFailed(String messageId, Throwable cause) {
        return new VectorEmbeddingException("Failed to generate embedding for message: " + messageId, cause);
    }

    /**
     * 벡터 저장 실패
     */
    public static VectorEmbeddingException storageFailed(String embeddingId, Throwable cause) {
        return new VectorEmbeddingException("Failed to store embedding: " + embeddingId, cause);
    }

    /**
     * 검색 실패
     */
    public static VectorEmbeddingException searchFailed(Throwable cause) {
        return new VectorEmbeddingException("Vector search failed", cause);
    }

    /**
     * 벡터 DB 비활성화
     */
    public static VectorEmbeddingException disabled() {
        return new VectorEmbeddingException("Vector DB is disabled");
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/mapper/EntityMapper.java

```java
package com.newsinsight.collector.mapper;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Map;

@Component
public class EntityMapper {

    private static final Logger log = LoggerFactory.getLogger(EntityMapper.class);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;

    public EntityMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public DataSourceDTO toDTO(DataSource source) {
        return new DataSourceDTO(
                source.getId(),
                source.getName(),
                source.getUrl(),
                source.getSourceType(),
                source.getIsActive(),
                source.getLastCollected(),
                source.getCollectionFrequency(),
                parseJson(source.getMetadataJson()),
                source.getCreatedAt(),
                source.getUpdatedAt(),
                BrowserAgentConfigDto.fromEntity(source.getBrowserAgentConfig())
        );
    }

    // Alias method for DataSource
    public DataSourceDTO toDataSourceDTO(DataSource source) {
        return toDTO(source);
    }

    public CollectionJobDTO toDTO(CollectionJob job) {
        return new CollectionJobDTO(
                job.getId(),
                job.getSourceId(),
                job.getStatus(),
                job.getStartedAt(),
                job.getCompletedAt(),
                job.getItemsCollected(),
                job.getErrorMessage(),
                job.getCreatedAt()
        );
    }

    // Alias method for CollectionJob
    public CollectionJobDTO toCollectionJobDTO(CollectionJob job) {
        return toDTO(job);
    }

    public CollectedDataDTO toDTO(CollectedData data) {
        return new CollectedDataDTO(
                data.getId(),
                data.getSourceId(),
                data.getTitle(),
                data.getContent(),
                data.getUrl(),
                data.getPublishedDate(),
                data.getCollectedAt(),
                data.getContentHash(),
                parseJson(data.getMetadataJson()),
                data.getProcessed()
        );
    }

    // Alias method for CollectedData
    public CollectedDataDTO toCollectedDataDTO(CollectedData data) {
        return toDTO(data);
    }

    public DataSource toEntity(DataSourceCreateRequest request) {
        DataSource.DataSourceBuilder builder = DataSource.builder()
                .name(request.name())
                .url(request.url())
                .sourceType(request.sourceType())
                .collectionFrequency(request.collectionFrequency())
                .metadataJson(toJson(request.metadata()))
                .isActive(true);

        // Set browser agent config if applicable
        if (request.sourceType() == SourceType.BROWSER_AGENT && request.browserAgentConfig() != null) {
            builder.browserAgentConfig(request.browserAgentConfig().toEntity());
        }

        return builder.build();
    }

    // Alias method for DataSourceCreateRequest
    public DataSource toDataSource(DataSourceCreateRequest request) {
        return toEntity(request);
    }

    public void updateEntity(DataSource source, DataSourceUpdateRequest request) {
        if (request.name() != null) {
            source.setName(request.name());
        }
        if (request.url() != null) {
            source.setUrl(request.url());
        }
        if (request.isActive() != null) {
            source.setIsActive(request.isActive());
        }
        if (request.collectionFrequency() != null) {
            source.setCollectionFrequency(request.collectionFrequency());
        }
        if (request.metadata() != null) {
            source.setMetadataJson(toJson(request.metadata()));
        }
        // Update browser agent config if provided
        if (request.browserAgentConfig() != null) {
            source.setBrowserAgentConfig(request.browserAgentConfig().toEntity());
        }
    }

    // Alias method for updating DataSource from request
    public void updateDataSourceFromRequest(DataSourceUpdateRequest request, DataSource source) {
        updateEntity(source, request);
    }

    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return objectMapper.readValue(json, MAP_TYPE);
        } catch (JsonProcessingException e) {
            log.warn("Failed to parse metadata JSON. Returning empty map. Data: {}", json, e);
            return Collections.emptyMap();
        }
    }

    private String toJson(Map<String, Object> map) {
        if (map == null || map.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            log.warn("Failed to serialize metadata map. Returning null. Data: {}", map, e);
            return null;
        }
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/mongo/AiResponseDocument.java

```java
package com.newsinsight.collector.mongo;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.Map;

@Document(collection = "ai_responses")
public class AiResponseDocument {

    @Id
    private String id; // requestId

    private String status;
    private String completedAt;
    private String providerId;
    private String modelId;
    private String text;
    private Map<String, Object> raw;

    @Indexed(expireAfterSeconds = 604800) // 7 days
    private Instant createdAt;

    public AiResponseDocument() {
    }

    public AiResponseDocument(String id,
                              String status,
                              String completedAt,
                              String providerId,
                              String modelId,
                              String text,
                              Map<String, Object> raw,
                              Instant createdAt) {
        this.id = id;
        this.status = status;
        this.completedAt = completedAt;
        this.providerId = providerId;
        this.modelId = modelId;
        this.text = text;
        this.raw = raw;
        this.createdAt = createdAt;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(String completedAt) {
        this.completedAt = completedAt;
    }

    public String getProviderId() {
        return providerId;
    }

    public void setProviderId(String providerId) {
        this.providerId = providerId;
    }

    public String getModelId() {
        return modelId;
    }

    public void setModelId(String modelId) {
        this.modelId = modelId;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public Map<String, Object> getRaw() {
        return raw;
    }

    public void setRaw(Map<String, Object> raw) {
        this.raw = raw;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/mongo/AiResponseRepository.java

```java
package com.newsinsight.collector.mongo;

import org.springframework.data.mongodb.repository.MongoRepository;

public interface AiResponseRepository extends MongoRepository<AiResponseDocument, String> {
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/AiJobRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.ai.AiJob;
import com.newsinsight.collector.entity.ai.AiJobStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface AiJobRepository extends JpaRepository<AiJob, String> {

    /**
     * Find jobs by overall status
     */
    Page<AiJob> findByOverallStatus(AiJobStatus status, Pageable pageable);

    /**
     * Find jobs by topic containing the search term
     */
    Page<AiJob> findByTopicContainingIgnoreCase(String topic, Pageable pageable);

    /**
     * Find jobs by status list
     */
    List<AiJob> findByOverallStatusIn(List<AiJobStatus> statuses);

    /**
     * Find jobs by status and created before a given time (for timeout/cleanup)
     */
    @Query("SELECT j FROM AiJob j WHERE j.overallStatus IN :statuses AND j.createdAt < :before")
    List<AiJob> findByStatusInAndCreatedAtBefore(
            @Param("statuses") List<AiJobStatus> statuses,
            @Param("before") LocalDateTime before
    );

    /**
     * Find job with sub-tasks eagerly loaded
     */
    @Query("SELECT j FROM AiJob j LEFT JOIN FETCH j.subTasks WHERE j.id = :jobId")
    Optional<AiJob> findByIdWithSubTasks(@Param("jobId") String jobId);

    /**
     * Find recent jobs by topic
     */
    @Query("SELECT j FROM AiJob j WHERE LOWER(j.topic) = LOWER(:topic) ORDER BY j.createdAt DESC")
    List<AiJob> findRecentByTopic(@Param("topic") String topic, Pageable pageable);

    /**
     * Count jobs by status
     */
    long countByOverallStatus(AiJobStatus status);

    /**
     * Mark timed out jobs (PENDING or IN_PROGRESS older than cutoff)
     */
    @Modifying
    @Query("UPDATE AiJob j SET j.overallStatus = 'TIMEOUT', j.completedAt = CURRENT_TIMESTAMP " +
            "WHERE j.overallStatus IN ('PENDING', 'IN_PROGRESS') AND j.createdAt < :before")
    int markTimedOutJobs(@Param("before") LocalDateTime before);

    /**
     * Delete old completed/failed/cancelled jobs
     */
    @Modifying
    @Query("DELETE FROM AiJob j WHERE j.overallStatus IN ('COMPLETED', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED') " +
            "AND j.completedAt < :before")
    int deleteOldJobs(@Param("before") LocalDateTime before);

    /**
     * Find jobs created within a time range
     */
    Page<AiJob> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end, Pageable pageable);

    /**
     * Get statistics: count by status
     */
    @Query("SELECT j.overallStatus, COUNT(j) FROM AiJob j GROUP BY j.overallStatus")
    List<Object[]> getStatusCounts();

    /**
     * Find active (non-terminal) jobs
     */
    @Query("SELECT j FROM AiJob j WHERE j.overallStatus IN ('PENDING', 'IN_PROGRESS')")
    List<AiJob> findActiveJobs();
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/AiSubTaskRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.ai.AiProvider;
import com.newsinsight.collector.entity.ai.AiSubTask;
import com.newsinsight.collector.entity.ai.AiTaskStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface AiSubTaskRepository extends JpaRepository<AiSubTask, String> {

    /**
     * Find all sub-tasks for a job
     */
    List<AiSubTask> findByAiJobId(String jobId);

    /**
     * Find sub-tasks by job ID and status
     */
    List<AiSubTask> findByAiJobIdAndStatus(String jobId, AiTaskStatus status);

    /**
     * Find sub-tasks by provider
     */
    List<AiSubTask> findByProviderId(AiProvider providerId);

    /**
     * Find sub-tasks by status
     */
    Page<AiSubTask> findByStatus(AiTaskStatus status, Pageable pageable);

    /**
     * Find sub-task by job ID and provider ID
     */
    Optional<AiSubTask> findByAiJobIdAndProviderId(String jobId, AiProvider providerId);

    /**
     * Count sub-tasks by job ID and status
     */
    long countByAiJobIdAndStatus(String jobId, AiTaskStatus status);

    /**
     * Count sub-tasks by job ID
     */
    long countByAiJobId(String jobId);

    /**
     * Get status distribution for a job
     */
    @Query("SELECT t.status, COUNT(t) FROM AiSubTask t WHERE t.aiJob.id = :jobId GROUP BY t.status")
    List<Object[]> getStatusDistributionByJobId(@Param("jobId") String jobId);

    /**
     * Find pending tasks older than cutoff (for timeout)
     */
    @Query("SELECT t FROM AiSubTask t WHERE t.status IN ('PENDING', 'IN_PROGRESS') AND t.createdAt < :before")
    List<AiSubTask> findPendingTasksOlderThan(@Param("before") LocalDateTime before);

    /**
     * Mark timed out sub-tasks
     */
    @Modifying
    @Query("UPDATE AiSubTask t SET t.status = 'TIMEOUT', t.completedAt = CURRENT_TIMESTAMP " +
            "WHERE t.status IN ('PENDING', 'IN_PROGRESS') AND t.createdAt < :before")
    int markTimedOutTasks(@Param("before") LocalDateTime before);

    /**
     * Delete sub-tasks by job IDs
     */
    @Modifying
    @Query("DELETE FROM AiSubTask t WHERE t.aiJob.id IN :jobIds")
    int deleteByJobIds(@Param("jobIds") List<String> jobIds);

    /**
     * Check if all sub-tasks for a job are in terminal state
     */
    @Query("SELECT COUNT(t) = 0 FROM AiSubTask t WHERE t.aiJob.id = :jobId AND t.status IN ('PENDING', 'IN_PROGRESS')")
    boolean areAllTasksTerminal(@Param("jobId") String jobId);

    /**
     * Check if any sub-task for a job completed successfully
     */
    @Query("SELECT COUNT(t) > 0 FROM AiSubTask t WHERE t.aiJob.id = :jobId AND t.status = 'COMPLETED'")
    boolean hasCompletedTask(@Param("jobId") String jobId);

    /**
     * Check if all sub-tasks for a job completed successfully
     */
    @Query("SELECT COUNT(t) = (SELECT COUNT(t2) FROM AiSubTask t2 WHERE t2.aiJob.id = :jobId) " +
            "FROM AiSubTask t WHERE t.aiJob.id = :jobId AND t.status = 'COMPLETED'")
    boolean areAllTasksCompleted(@Param("jobId") String jobId);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/ArticleAnalysisRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ArticleAnalysisRepository extends JpaRepository<ArticleAnalysis, Long> {

    Optional<ArticleAnalysis> findByArticleId(Long articleId);

    List<ArticleAnalysis> findByArticleIdIn(List<Long> articleIds);

    @Query("SELECT a FROM ArticleAnalysis a WHERE a.fullyAnalyzed = false")
    List<ArticleAnalysis> findIncompleteAnalyses();

    @Query("SELECT a FROM ArticleAnalysis a WHERE a.reliabilityScore >= :minScore")
    List<ArticleAnalysis> findByReliabilityScoreGreaterThanEqual(@Param("minScore") Double minScore);

    @Query("SELECT a FROM ArticleAnalysis a WHERE a.misinfoRisk = :risk")
    List<ArticleAnalysis> findByMisinfoRisk(@Param("risk") String risk);

    @Query("SELECT a.articleId FROM ArticleAnalysis a WHERE a.articleId IN :articleIds")
    List<Long> findAnalyzedArticleIds(@Param("articleIds") List<Long> articleIds);

    boolean existsByArticleId(Long articleId);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/ArticleDiscussionRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ArticleDiscussionRepository extends JpaRepository<ArticleDiscussion, Long> {

    Optional<ArticleDiscussion> findByArticleId(Long articleId);

    List<ArticleDiscussion> findByArticleIdIn(List<Long> articleIds);

    boolean existsByArticleId(Long articleId);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/BrowserJobHistoryRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.browser.BrowserJobHistory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Repository for BrowserJobHistory entity.
 * Manages browser automation job history persistence.
 */
@Repository
public interface BrowserJobHistoryRepository extends JpaRepository<BrowserJobHistory, Long> {

    /**
     * Find by job ID
     */
    Optional<BrowserJobHistory> findByJobId(String jobId);

    /**
     * Find by user ID
     */
    Page<BrowserJobHistory> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    /**
     * Find by session ID
     */
    Page<BrowserJobHistory> findBySessionIdOrderByCreatedAtDesc(String sessionId, Pageable pageable);

    /**
     * Find by status
     */
    Page<BrowserJobHistory> findByStatus(BrowserJobHistory.BrowserJobStatus status, Pageable pageable);

    /**
     * Find by user and status
     */
    Page<BrowserJobHistory> findByUserIdAndStatus(
            String userId,
            BrowserJobHistory.BrowserJobStatus status,
            Pageable pageable
    );

    /**
     * Find active jobs (PENDING, RUNNING, WAITING_HUMAN)
     */
    @Query("""
            SELECT b FROM BrowserJobHistory b 
            WHERE b.status IN ('PENDING', 'RUNNING', 'WAITING_HUMAN')
            ORDER BY b.createdAt DESC
            """)
    List<BrowserJobHistory> findActiveJobs();

    /**
     * Find active jobs by user
     */
    @Query("""
            SELECT b FROM BrowserJobHistory b 
            WHERE b.userId = :userId 
            AND b.status IN ('PENDING', 'RUNNING', 'WAITING_HUMAN')
            ORDER BY b.createdAt DESC
            """)
    List<BrowserJobHistory> findActiveJobsByUser(@Param("userId") String userId);

    /**
     * Find by project ID
     */
    Page<BrowserJobHistory> findByProjectIdOrderByCreatedAtDesc(Long projectId, Pageable pageable);

    /**
     * Find by related search history ID
     */
    List<BrowserJobHistory> findBySearchHistoryIdOrderByCreatedAtDesc(Long searchHistoryId);

    /**
     * Update job status
     */
    @Modifying
    @Query("""
            UPDATE BrowserJobHistory b 
            SET b.status = :status, b.updatedAt = :updatedAt 
            WHERE b.jobId = :jobId
            """)
    void updateStatus(
            @Param("jobId") String jobId,
            @Param("status") BrowserJobHistory.BrowserJobStatus status,
            @Param("updatedAt") LocalDateTime updatedAt
    );

    /**
     * Count jobs by status
     */
    long countByStatus(BrowserJobHistory.BrowserJobStatus status);

    /**
     * Count jobs by user and status
     */
    long countByUserIdAndStatus(String userId, BrowserJobHistory.BrowserJobStatus status);

    /**
     * Find jobs completed within time range
     */
    Page<BrowserJobHistory> findByStatusAndCompletedAtAfter(
            BrowserJobHistory.BrowserJobStatus status,
            LocalDateTime after,
            Pageable pageable
    );

    /**
     * Delete old completed jobs (cleanup)
     */
    @Modifying
    @Query("""
            DELETE FROM BrowserJobHistory b 
            WHERE b.status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT') 
            AND b.completedAt < :before
            """)
    void deleteOldCompletedJobs(@Param("before") LocalDateTime before);

    /**
     * Get statistics by status
     */
    @Query("""
            SELECT b.status as status, COUNT(b) as count, AVG(b.durationMs) as avgDuration
            FROM BrowserJobHistory b
            WHERE b.createdAt > :after
            GROUP BY b.status
            """)
    List<BrowserJobStats> getStatsByStatus(@Param("after") LocalDateTime after);

    interface BrowserJobStats {
        BrowserJobHistory.BrowserJobStatus getStatus();
        Long getCount();
        Double getAvgDuration();
    }
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/ChatHistoryRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.chat.ChatHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 채팅 이력 리포지토리 (PostgreSQL)
 */
@Repository
public interface ChatHistoryRepository extends JpaRepository<ChatHistory, Long> {

    /**
     * 세션 ID로 메시지 조회
     */
    List<ChatHistory> findBySessionIdOrderByCreatedAtAsc(String sessionId);

    /**
     * 사용자 ID로 메시지 조회
     */
    List<ChatHistory> findByUserIdOrderByCreatedAtDesc(String userId);

    /**
     * 메시지 ID 존재 여부 확인
     */
    boolean existsByMessageId(String messageId);

    /**
     * 특정 기간 내 메시지 조회
     */
    List<ChatHistory> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end);

    /**
     * 임베딩이 필요한 메시지 조회 (assistant 메시지만)
     */
    @Query("SELECT ch FROM ChatHistory ch WHERE ch.role = 'assistant' AND ch.embeddingId IS NULL")
    List<ChatHistory> findMessagesNeedingEmbedding();
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/CollectedDataRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CollectedData;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface CollectedDataRepository extends JpaRepository<CollectedData, Long> {

    Optional<CollectedData> findByContentHash(String contentHash);

    List<CollectedData> findBySourceIdOrderByCollectedAtDesc(Long sourceId);

    Page<CollectedData> findBySourceId(Long sourceId, Pageable pageable);

    List<CollectedData> findByProcessedFalse();

    Page<CollectedData> findByProcessedFalse(Pageable pageable);

    Page<CollectedData> findByProcessed(Boolean processed, Pageable pageable);

    long countByProcessedFalse();

    @Query("SELECT COUNT(cd) FROM CollectedData cd WHERE cd.collectedAt >= :startDate")
    long countCollectedSince(@Param("startDate") LocalDateTime startDate);

    @Query("SELECT COUNT(cd) FROM CollectedData cd WHERE cd.sourceId = :sourceId")
    long countBySourceId(@Param("sourceId") Long sourceId);

    /**
     * Full-Text Search with date filter using PostgreSQL tsvector.
     * Uses plainto_tsquery for natural language queries (handles Korean well).
     * Falls back to LIKE for very short queries (1-2 chars).
     * Results are ranked by FTS relevance, then by date.
     */
    @Query(value = """
        SELECT * FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since))
        ORDER BY 
            CASE WHEN :query IS NOT NULL AND :query != '' AND LENGTH(:query) > 2 
                 THEN ts_rank(cd.search_vector, plainto_tsquery('simple', :query)) 
                 ELSE 0 END DESC,
            COALESCE(cd.published_date, cd.collected_at) DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since))
        """,
        nativeQuery = true)
    Page<CollectedData> searchByQueryAndSince(@Param("query") String query,
                                              @Param("since") LocalDateTime since,
                                              Pageable pageable);

    /**
     * Full-Text Search without date filter.
     * Uses plainto_tsquery for natural language queries.
     * Falls back to LIKE for very short queries (1-2 chars).
     */
    @Query(value = """
        SELECT * FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        ORDER BY 
            CASE WHEN :query IS NOT NULL AND :query != '' AND LENGTH(:query) > 2 
                 THEN ts_rank(cd.search_vector, plainto_tsquery('simple', :query)) 
                 ELSE 0 END DESC,
            COALESCE(cd.published_date, cd.collected_at) DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        """,
        nativeQuery = true)
    Page<CollectedData> searchByQuery(@Param("query") String query,
                                      Pageable pageable);

    /**
     * Full-Text Search with custom date range (start and end date).
     * Uses plainto_tsquery for natural language queries (handles Korean well).
     * Falls back to LIKE for very short queries (1-2 chars).
     * Results are ranked by FTS relevance, then by date.
     * 
     * @param query Search query
     * @param since Start date (inclusive)
     * @param until End date (inclusive)
     * @param pageable Pagination info
     * @return Page of matching articles within the date range
     */
    @Query(value = """
        SELECT * FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since AND cd.published_date <= :until)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since AND cd.collected_at <= :until))
        ORDER BY 
            CASE WHEN :query IS NOT NULL AND :query != '' AND LENGTH(:query) > 2 
                 THEN ts_rank(cd.search_vector, plainto_tsquery('simple', :query)) 
                 ELSE 0 END DESC,
            COALESCE(cd.published_date, cd.collected_at) DESC
        """,
        countQuery = """
        SELECT COUNT(*) FROM collected_data cd
        WHERE (
            :query IS NULL OR :query = '' OR
            CASE 
                WHEN LENGTH(:query) <= 2 THEN 
                    LOWER(cd.title) LIKE LOWER(CONCAT('%', :query, '%')) 
                    OR LOWER(cd.content) LIKE LOWER(CONCAT('%', :query, '%'))
                ELSE 
                    cd.search_vector @@ plainto_tsquery('simple', :query)
            END
        )
        AND ((cd.published_date IS NOT NULL AND cd.published_date >= :since AND cd.published_date <= :until)
          OR (cd.published_date IS NULL AND cd.collected_at >= :since AND cd.collected_at <= :until))
        """,
        nativeQuery = true)
    Page<CollectedData> searchByQueryAndDateRange(@Param("query") String query,
                                                  @Param("since") LocalDateTime since,
                                                  @Param("until") LocalDateTime until,
                                                  Pageable pageable);

    boolean existsByContentHash(String contentHash);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/CollectionJobRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface CollectionJobRepository extends JpaRepository<CollectionJob, Long> {

    List<CollectionJob> findBySourceIdOrderByCreatedAtDesc(Long sourceId);

    Page<CollectionJob> findBySourceId(Long sourceId, Pageable pageable);

    List<CollectionJob> findByStatus(JobStatus status);

    Page<CollectionJob> findByStatus(JobStatus status, Pageable pageable);

    Optional<CollectionJob> findFirstBySourceIdAndStatusOrderByCreatedAtDesc(
        Long sourceId, JobStatus status);

    @Query("SELECT cj FROM CollectionJob cj WHERE cj.status = :status " +
           "AND cj.startedAt < :threshold")
    List<CollectionJob> findStaleJobs(
        @Param("status") JobStatus status,
        @Param("threshold") LocalDateTime threshold);

    @Query("SELECT cj FROM CollectionJob cj WHERE cj.createdAt >= :startDate " +
           "ORDER BY cj.createdAt DESC")
    List<CollectionJob> findRecentJobs(@Param("startDate") LocalDateTime startDate);

    List<CollectionJob> findByStatusAndCompletedAtBefore(JobStatus status, LocalDateTime completedAt);

    long countByStatus(JobStatus status);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/CrawlEvidenceRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CrawlEvidence;
import com.newsinsight.collector.entity.EvidenceStance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CrawlEvidenceRepository extends JpaRepository<CrawlEvidence, Long> {

    /**
     * Find all evidence for a job
     */
    List<CrawlEvidence> findByJobId(String jobId);

    /**
     * Find evidence by job ID with pagination
     */
    Page<CrawlEvidence> findByJobId(String jobId, Pageable pageable);

    /**
     * Find evidence by job ID and stance
     */
    List<CrawlEvidence> findByJobIdAndStance(String jobId, EvidenceStance stance);

    /**
     * Count evidence by job ID
     */
    long countByJobId(String jobId);

    /**
     * Count evidence by stance for a job
     */
    long countByJobIdAndStance(String jobId, EvidenceStance stance);

    /**
     * Delete all evidence for a job
     */
    @Modifying
    @Query("DELETE FROM CrawlEvidence e WHERE e.jobId = :jobId")
    int deleteByJobId(@Param("jobId") String jobId);

    /**
     * Delete evidence for multiple jobs
     */
    @Modifying
    @Query("DELETE FROM CrawlEvidence e WHERE e.jobId IN :jobIds")
    int deleteByJobIdIn(@Param("jobIds") List<String> jobIds);

    /**
     * Search evidence by snippet content
     */
    @Query("SELECT e FROM CrawlEvidence e WHERE e.jobId = :jobId AND " +
            "(LOWER(e.snippet) LIKE LOWER(CONCAT('%', :keyword, '%')) OR " +
            "LOWER(e.title) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    List<CrawlEvidence> searchByKeyword(
            @Param("jobId") String jobId,
            @Param("keyword") String keyword
    );

    /**
     * Get stance distribution for a job
     */
    @Query("SELECT e.stance, COUNT(e) FROM CrawlEvidence e WHERE e.jobId = :jobId GROUP BY e.stance")
    List<Object[]> getStanceDistribution(@Param("jobId") String jobId);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/CrawlJobRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CrawlJob;
import com.newsinsight.collector.entity.CrawlJobStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface CrawlJobRepository extends JpaRepository<CrawlJob, String> {

    /**
     * Find jobs by status
     */
    Page<CrawlJob> findByStatus(CrawlJobStatus status, Pageable pageable);

    /**
     * Find jobs by topic containing the search term
     */
    Page<CrawlJob> findByTopicContainingIgnoreCase(String topic, Pageable pageable);

    /**
     * Find pending jobs older than a given time (for timeout handling)
     */
    @Query("SELECT j FROM CrawlJob j WHERE j.status IN :statuses AND j.createdAt < :before")
    List<CrawlJob> findByStatusInAndCreatedAtBefore(
            @Param("statuses") List<CrawlJobStatus> statuses,
            @Param("before") LocalDateTime before
    );

    /**
     * Find recent jobs by topic
     */
    @Query("SELECT j FROM CrawlJob j WHERE LOWER(j.topic) = LOWER(:topic) ORDER BY j.createdAt DESC")
    List<CrawlJob> findRecentByTopic(@Param("topic") String topic, Pageable pageable);

    /**
     * Count jobs by status
     */
    long countByStatus(CrawlJobStatus status);

    /**
     * Mark timed out jobs
     */
    @Modifying
    @Query("UPDATE CrawlJob j SET j.status = 'TIMEOUT', j.completedAt = CURRENT_TIMESTAMP " +
            "WHERE j.status IN ('PENDING', 'IN_PROGRESS') AND j.createdAt < :before")
    int markTimedOutJobs(@Param("before") LocalDateTime before);

    /**
     * Delete old completed/failed jobs
     */
    @Modifying
    @Query("DELETE FROM CrawlJob j WHERE j.status IN ('COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED') " +
            "AND j.completedAt < :before")
    int deleteOldJobs(@Param("before") LocalDateTime before);

    /**
     * Find jobs created within a time range
     */
    Page<CrawlJob> findByCreatedAtBetween(LocalDateTime start, LocalDateTime end, Pageable pageable);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/CrawlTargetRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.autocrawl.CrawlTarget;
import com.newsinsight.collector.entity.autocrawl.CrawlTargetStatus;
import com.newsinsight.collector.entity.autocrawl.DiscoverySource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 자동 크롤링 대상 URL 저장소.
 * 검색, 기사 분석 등에서 발견된 URL의 크롤링 대기열을 관리합니다.
 */
@Repository
public interface CrawlTargetRepository extends JpaRepository<CrawlTarget, Long> {
       

    /**
     * URL 해시로 기존 대상 조회 (중복 체크용)
     */
    Optional<CrawlTarget> findByUrlHash(String urlHash);

    /**
     * URL 해시 존재 여부 (빠른 중복 체크)
     */
    boolean existsByUrlHash(String urlHash);

    /**
     * 상태별 대상 조회
     */
    List<CrawlTarget> findByStatus(CrawlTargetStatus status);

    Page<CrawlTarget> findByStatus(CrawlTargetStatus status, Pageable pageable);

    /**
     * 대기 중인 대상을 우선순위 순으로 조회 (크롤링 큐)
     * 재시도 백오프 시간이 지난 대상만 포함
     */
    @Query("SELECT ct FROM CrawlTarget ct " +
           "WHERE ct.status = :status " +
           "AND (ct.nextAttemptAfter IS NULL OR ct.nextAttemptAfter <= :now) " +
           "ORDER BY ct.priority DESC, ct.discoveredAt ASC")
    List<CrawlTarget> findPendingTargetsOrderByPriority(
            @Param("status") CrawlTargetStatus status,
            @Param("now") LocalDateTime now,
            Pageable pageable);

    /**
     * PENDING 상태의 대상 중 크롤링 가능한 대상 조회 (우선순위 순)
     */
    default List<CrawlTarget> findReadyToCrawl(int limit) {
        return findPendingTargetsOrderByPriority(
                CrawlTargetStatus.PENDING,
                LocalDateTime.now(),
                Pageable.ofSize(limit));
    }

    /**
     * 도메인별 대상 조회
     */
    List<CrawlTarget> findByDomain(String domain);

    /**
     * 발견 출처별 대상 조회
     */
    List<CrawlTarget> findByDiscoverySource(DiscoverySource source);

    Page<CrawlTarget> findByDiscoverySource(DiscoverySource source, Pageable pageable);

    /**
     * 특정 기간 내 발견된 대상 조회
     */
    List<CrawlTarget> findByDiscoveredAtAfter(LocalDateTime since);

    /**
     * 키워드 관련 대상 조회 (LIKE 검색)
     */
    @Query("SELECT ct FROM CrawlTarget ct WHERE ct.relatedKeywords LIKE %:keyword%")
    List<CrawlTarget> findByRelatedKeywordsContaining(@Param("keyword") String keyword);

    /**
     * 상태별 카운트
     */
    long countByStatus(CrawlTargetStatus status);

    /**
     * 발견 출처별 카운트
     */
    long countByDiscoverySource(DiscoverySource source);

    /**
     * 오래된 완료/실패 대상 정리
     */
    @Modifying
    @Query("DELETE FROM CrawlTarget ct WHERE ct.status IN :statuses AND ct.updatedAt < :before")
    int deleteOldTargets(@Param("statuses") List<CrawlTargetStatus> statuses, 
                         @Param("before") LocalDateTime before);

    /**
     * 오래 대기 중인 대상 정리 (7일 이상 PENDING인 경우)
     */
    @Modifying
    @Query("UPDATE CrawlTarget ct SET ct.status = 'EXPIRED' " +
           "WHERE ct.status = 'PENDING' AND ct.discoveredAt < :before")
    int expireOldPendingTargets(@Param("before") LocalDateTime before);

    /**
     * IN_PROGRESS 상태로 오래 멈춘 대상 복구 (타임아웃)
     */
    @Modifying
    @Query("UPDATE CrawlTarget ct SET ct.status = 'PENDING', ct.retryCount = ct.retryCount + 1 " +
           "WHERE ct.status = 'IN_PROGRESS' AND ct.lastAttemptAt < :timeout")
    int recoverStuckTargets(@Param("timeout") LocalDateTime timeout);

    /**
     * 도메인별 대기 중 대상 수 (도메인별 rate limiting용)
     */
    @Query("SELECT ct.domain, COUNT(ct) FROM CrawlTarget ct " +
           "WHERE ct.status = 'PENDING' GROUP BY ct.domain ORDER BY COUNT(ct) DESC")
    List<Object[]> countPendingByDomain();

    /**
     * 최근 N일간 발견된 대상 통계
     */
    @Query("SELECT ct.discoverySource, COUNT(ct) FROM CrawlTarget ct " +
           "WHERE ct.discoveredAt > :since GROUP BY ct.discoverySource")
    List<Object[]> getDiscoveryStatsSince(@Param("since") LocalDateTime since);

    /**
     * 최근 N일간 완료된 대상 통계
     */
    @Query("SELECT DATE(ct.completedAt), COUNT(ct) FROM CrawlTarget ct " +
           "WHERE ct.status = 'COMPLETED' AND ct.completedAt > :since " +
           "GROUP BY DATE(ct.completedAt) ORDER BY DATE(ct.completedAt)")
    List<Object[]> getCompletedStatsByDateSince(@Param("since") LocalDateTime since);
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/DataSourceRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface DataSourceRepository extends JpaRepository<DataSource, Long> {

    List<DataSource> findByIsActiveTrue();

    List<DataSource> findBySourceType(SourceType sourceType);

    List<DataSource> findByIsActiveTrueAndSourceType(SourceType sourceType);

    /**
     * Find active web search sources ordered by priority.
     * Lower priority number = higher priority.
     */
    @Query("SELECT ds FROM DataSource ds WHERE ds.isActive = true " +
           "AND ds.sourceType = 'WEB_SEARCH' " +
           "AND ds.searchUrlTemplate IS NOT NULL " +
           "ORDER BY ds.searchPriority ASC")
    List<DataSource> findActiveWebSearchSources();

    Optional<DataSource> findByName(String name);

    /**
     * Find a DataSource by URL.
     * Returns the first match if duplicates exist (to handle legacy data).
     */
    Optional<DataSource> findFirstByUrl(String url);

    @Query("SELECT ds FROM DataSource ds WHERE ds.isActive = true " +
           "AND (ds.lastCollected IS NULL OR ds.lastCollected < :threshold)")
    List<DataSource> findDueForCollection(LocalDateTime threshold);

    long countByIsActiveTrue();
}

```

---

## backend/data-collection-service/src/main/java/com/newsinsight/collector/repository/DraftSearchRepository.java

```java
package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.search.DraftSearch;
import com.newsinsight.collector.entity.search.SearchType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Repository for DraftSearch entity.
 * Manages draft/unsaved search persistence.
 */
@Repository
public interface DraftSearchRepository extends JpaRepository<DraftSearch, Long> {

    /**
     * Find unexecuted drafts by user
     */
    List<DraftSearch> findByUserIdAndExecutedFalseOrderByCreatedAtDesc(String userId);

    /**
     * Find unexecuted drafts by session
     */
    List<DraftSearch> findBySessionIdAndExecutedFalseOrderByCreatedAtDesc(String sessionId);

    /**
     * Find drafts by user or session (for anonymous users)
     */
    @Query("""
            SELECT d FROM DraftSearch d 
            WHERE (d.userId = :userId OR d.sessionId = :sessionId)
            AND d.executed = false
            ORDER BY d.createdAt DESC
            """)
    List<DraftSearch> findUnexecutedDrafts(
            @Param("userId") String userId,
            @Param("sessionId") String sessionId,
            Pageable pageable
    );

    /**
     * Find drafts by search type
     */
    Page<DraftSearch> findBySearchTypeAndExecutedFalse(SearchType searchType, Pageable pageable);

    /**
     * Find drafts for a project
     */
    List<DraftSearch> findByProjectIdAndExecutedFalseOrderByCreatedAtDesc(Long projectId);

    /**
     * Mark draft as executed
     */
    @Modifying
    @Query("""
            UPDATE DraftSearch d 
            SET d.executed = true, d.executedAt = :executedAt, d.searchHistoryId = :searchHistoryId 
            WHERE d.id = :id
            """)
    void markExecuted(
            @Param("id") Long id,
            @Param("executedAt") LocalDateTime executedAt,
            @Param("searchHistoryId") Long searchHistoryId
    );

    /**
     * Delete old executed drafts (cleanup)
     */
    @Modifying
    @Query("DELETE FROM DraftSearch d WHERE d.executed = true AND d.executedAt < :before")
    void deleteOldExecutedDrafts(@Param("before") LocalDateTime before);

    /**
     * Delete old unexecuted drafts (cleanup)
     */
    @Modifying
    @Query("DELETE FROM DraftSearch d WHERE d.executed = false AND d.createdAt < :before")
    void deleteOldUnexecutedDrafts(@Param("before") LocalDateTime before);

    /**
     * Count unexecuted drafts by user
     */
    long countByUserIdAndExecutedFalse(String userId);

    /**
     * Find recent drafts with similar query
     */
    @Query("""
            SELECT d FROM DraftSearch d 
            WHERE d.userId = :userId 
            AND LOWER(d.query) LIKE LOWER(CONCAT('%', :query, '%'))
            AND d.executed = false
            ORDER BY d.createdAt DESC
            """)
    List<DraftSearch> findSimilarDrafts(
            @Param("userId") String userId,
            @Param("query") String query,
            Pageable pageable
    );
}

```
