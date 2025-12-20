package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.dto.SearchHistoryDto;
import com.newsinsight.collector.dto.SearchHistoryMessage;
import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.service.SearchHistoryEventService;
import com.newsinsight.collector.service.SearchHistoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Search History API.
 * Provides endpoints for saving, querying, and managing search history.
 */
@RestController
@RequestMapping("/api/v1/search-history")
@RequiredArgsConstructor
@Slf4j
public class SearchHistoryController {

    private final SearchHistoryService searchHistoryService;
    private final SearchHistoryEventService searchHistoryEventService;

    // ============================================
    // Create / Save
    // ============================================

    /**
     * Save search result asynchronously via Kafka.
     * This is the primary endpoint for saving search results.
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> saveSearchHistory(@RequestBody SearchHistoryDto request) {
        log.info("Saving search history: type={}, query='{}'", request.getSearchType(), request.getQuery());
        
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }
        
        if (request.getSearchType() == null) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Search type is required"
            ));
        }

        // Convert to message and send to Kafka
        SearchHistoryMessage message = request.toMessage();
        searchHistoryService.sendToKafka(message);

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "message", "Search history queued for saving",
                "externalId", message.getExternalId() != null ? message.getExternalId() : "",
                "searchType", message.getSearchType().name(),
                "query", message.getQuery()
        ));
    }

    /**
     * Save search result synchronously (for immediate persistence).
     */
    @PostMapping("/sync")
    public ResponseEntity<SearchHistoryDto> saveSearchHistorySync(@RequestBody SearchHistoryDto request) {
        log.info("Saving search history synchronously: type={}, query='{}'", 
                request.getSearchType(), request.getQuery());
        
        SearchHistoryMessage message = request.toMessage();
        SearchHistory saved = searchHistoryService.saveFromMessage(message);
        
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(SearchHistoryDto.fromEntity(saved));
    }

    // ============================================
    // Read / Query
    // ============================================

    /**
     * Get search history by ID.
     */
    @GetMapping("/{id}")
    public ResponseEntity<SearchHistoryDto> getById(@PathVariable Long id) {
        return searchHistoryService.findById(id)
                .map(SearchHistoryDto::fromEntity)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get search history by external ID (e.g., jobId).
     */
    @GetMapping("/external/{externalId}")
    public ResponseEntity<SearchHistoryDto> getByExternalId(@PathVariable String externalId) {
        return searchHistoryService.findByExternalId(externalId)
                .map(SearchHistoryDto::fromEntity)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get paginated search history.
     */
    @GetMapping
    public ResponseEntity<PageResponse<SearchHistoryDto>> getAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String userId
    ) {
        Page<SearchHistory> result;
        
        if (type != null && userId != null) {
            SearchType searchType = SearchType.valueOf(type.toUpperCase());
            result = searchHistoryService.findByUserAndType(userId, searchType, page, size);
        } else if (type != null) {
            SearchType searchType = SearchType.valueOf(type.toUpperCase());
            result = searchHistoryService.findByType(searchType, page, size);
        } else if (userId != null) {
            result = searchHistoryService.findByUser(userId, page, size);
        } else {
            result = searchHistoryService.findAll(page, size, sortBy, sortDirection);
        }

        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Search history by query text.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<SearchHistoryDto>> searchByQuery(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchHistory> result = searchHistoryService.searchByQuery(q, page, size);
        
        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get bookmarked searches.
     */
    @GetMapping("/bookmarked")
    public ResponseEntity<PageResponse<SearchHistoryDto>> getBookmarked(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchHistory> result = searchHistoryService.findBookmarked(page, size);
        
        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get derived searches from a parent.
     */
    @GetMapping("/{id}/derived")
    public ResponseEntity<List<SearchHistoryDto>> getDerivedSearches(@PathVariable Long id) {
        List<SearchHistory> derived = searchHistoryService.findDerivedSearches(id);
        List<SearchHistoryDto> response = derived.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get searches by session.
     */
    @GetMapping("/session/{sessionId}")
    public ResponseEntity<List<SearchHistoryDto>> getBySession(@PathVariable String sessionId) {
        List<SearchHistory> searches = searchHistoryService.findBySession(sessionId);
        List<SearchHistoryDto> response = searches.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    // ============================================
    // Update
    // ============================================

    /**
     * Toggle bookmark status.
     */
    @PostMapping("/{id}/bookmark")
    public ResponseEntity<SearchHistoryDto> toggleBookmark(@PathVariable Long id) {
        try {
            SearchHistory updated = searchHistoryService.toggleBookmark(id);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Update tags.
     */
    @PutMapping("/{id}/tags")
    public ResponseEntity<SearchHistoryDto> updateTags(
            @PathVariable Long id,
            @RequestBody List<String> tags
    ) {
        try {
            SearchHistory updated = searchHistoryService.updateTags(id, tags);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Update notes.
     */
    @PutMapping("/{id}/notes")
    public ResponseEntity<SearchHistoryDto> updateNotes(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        String notes = body.get("notes");
        try {
            SearchHistory updated = searchHistoryService.updateNotes(id, notes);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Delete
    // ============================================

    /**
     * Delete search history by ID.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        if (searchHistoryService.findById(id).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        searchHistoryService.delete(id);
        return ResponseEntity.noContent().build();
    }

    // ============================================
    // Derived Search (Drill-down)
    // ============================================

    /**
     * Create a derived search from a parent.
     * Used for drill-down functionality.
     */
    @PostMapping("/{parentId}/derive")
    public ResponseEntity<Map<String, Object>> createDerivedSearch(
            @PathVariable Long parentId,
            @RequestBody SearchHistoryDto request
    ) {
        log.info("Creating derived search from parent={}, query='{}'", parentId, request.getQuery());
        
        if (request.getQuery() == null || request.getQuery().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Query is required"
            ));
        }

        try {
            SearchHistoryMessage message = request.toMessage();
            SearchHistory derived = searchHistoryService.createDerivedSearch(parentId, message);
            
            return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                    "id", derived.getId(),
                    "parentSearchId", parentId,
                    "depthLevel", derived.getDepthLevel(),
                    "query", derived.getQuery(),
                    "message", "Derived search created"
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Statistics & Utilities
    // ============================================

    /**
     * Get search statistics.
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStatistics(
            @RequestParam(defaultValue = "30") int days
    ) {
        return ResponseEntity.ok(searchHistoryService.getStatistics(days));
    }

    /**
     * Get recently discovered URLs.
     */
    @GetMapping("/discovered-urls")
    public ResponseEntity<List<String>> getDiscoveredUrls(
            @RequestParam(defaultValue = "7") int days,
            @RequestParam(defaultValue = "100") int limit
    ) {
        return ResponseEntity.ok(searchHistoryService.getRecentDiscoveredUrls(days, limit));
    }

    /**
     * Health check.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "asyncSave", true,
                        "syncSave", true,
                        "derivedSearch", true,
                        "bookmarks", true,
                        "tags", true,
                        "statistics", true,
                        "sse", true
                ),
                "kafkaTopic", SearchHistoryService.SEARCH_HISTORY_TOPIC,
                "sseSubscribers", searchHistoryEventService.getSubscriberCount()
        ));
    }

    // ============================================
    // Continue Work Feature
    // ============================================

    /**
     * Get items for "Continue Work" feature.
     * Returns actionable searches: in-progress, failed, partial, draft, or unviewed completed.
     */
    @GetMapping("/continue-work")
    public ResponseEntity<Map<String, Object>> getContinueWorkItems(
            @RequestParam(required = false, defaultValue = "anonymous") String userId,
            @RequestParam(required = false) String sessionId,
            @RequestParam(required = false, defaultValue = "10") int limit
    ) {
        List<SearchHistory> items = searchHistoryService.findContinueWorkItems(
                userId, 
                sessionId != null ? sessionId : "", 
                limit
        );
        
        List<SearchHistoryDto> dtos = items.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();

        Map<String, Object> stats = searchHistoryService.getContinueWorkStats(
                userId, 
                sessionId != null ? sessionId : ""
        );

        return ResponseEntity.ok(Map.of(
                "items", dtos,
                "count", dtos.size(),
                "stats", stats
        ));
    }

    /**
     * Mark search as viewed.
     */
    @PostMapping("/{id}/viewed")
    public ResponseEntity<SearchHistoryDto> markAsViewed(@PathVariable Long id) {
        try {
            SearchHistory updated = searchHistoryService.markAsViewed(id);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Mark search as viewed by external ID.
     */
    @PostMapping("/external/{externalId}/viewed")
    public ResponseEntity<SearchHistoryDto> markAsViewedByExternalId(@PathVariable String externalId) {
        try {
            SearchHistory updated = searchHistoryService.markAsViewedByExternalId(externalId);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Update completion status.
     */
    @PutMapping("/{id}/status")
    public ResponseEntity<SearchHistoryDto> updateCompletionStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> body
    ) {
        String statusStr = body.get("status");
        if (statusStr == null || statusStr.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        try {
            SearchHistory.CompletionStatus status = SearchHistory.CompletionStatus.valueOf(statusStr.toUpperCase());
            SearchHistory updated = searchHistoryService.updateCompletionStatus(id, status);
            return ResponseEntity.ok(SearchHistoryDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Get searches by completion status.
     */
    @GetMapping("/status/{status}")
    public ResponseEntity<PageResponse<SearchHistoryDto>> getByCompletionStatus(
            @PathVariable String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        try {
            SearchHistory.CompletionStatus completionStatus = 
                    SearchHistory.CompletionStatus.valueOf(status.toUpperCase());
            
            Page<SearchHistory> result = searchHistoryService.findByCompletionStatus(completionStatus, page, size);
            
            PageResponse<SearchHistoryDto> response = new PageResponse<>(
                    result.getContent().stream()
                            .map(SearchHistoryDto::fromEntity)
                            .toList(),
                    result.getNumber(),
                    result.getSize(),
                    result.getTotalElements(),
                    result.getTotalPages(),
                    result.isFirst(),
                    result.isLast(),
                    result.hasNext(),
                    result.hasPrevious()
            );

            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    /**
     * Get searches by project ID.
     */
    @GetMapping("/project/{projectId}")
    public ResponseEntity<PageResponse<SearchHistoryDto>> getByProjectId(
            @PathVariable Long projectId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchHistory> result = searchHistoryService.findByProjectId(projectId, page, size);
        
        PageResponse<SearchHistoryDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchHistoryDto::fromEntity)
                        .toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get failed searches for potential retry.
     */
    @GetMapping("/failed")
    public ResponseEntity<List<SearchHistoryDto>> getFailedSearches(
            @RequestParam(defaultValue = "7") int daysBack,
            @RequestParam(defaultValue = "20") int limit
    ) {
        List<SearchHistory> failed = searchHistoryService.findFailedSearches(daysBack, limit);
        List<SearchHistoryDto> response = failed.stream()
                .map(SearchHistoryDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    // ============================================
    // SSE Real-time Stream
    // ============================================

    /**
     * SSE endpoint for real-time search history updates.
     * Clients can subscribe to receive notifications when:
     * - new_search: A new search was saved
     * - updated_search: An existing search was updated
     * - deleted_search: A search was deleted
     * - heartbeat: Keep-alive signal (every 30 seconds)
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<SearchHistoryEventService.SearchHistoryEventDto>> streamSearchHistory() {
        log.info("New SSE client connected to search history stream");
        
        return searchHistoryEventService.getEventStream()
                .map(event -> ServerSentEvent.<SearchHistoryEventService.SearchHistoryEventDto>builder()
                        .id(String.valueOf(event.timestamp()))
                        .event(event.eventType())
                        .data(event)
                        .build());
    }
}
