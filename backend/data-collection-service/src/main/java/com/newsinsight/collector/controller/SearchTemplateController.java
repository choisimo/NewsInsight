package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.dto.SearchTemplateDto;
import com.newsinsight.collector.entity.search.SearchTemplate;
import com.newsinsight.collector.service.SearchTemplateService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Search Template API.
 * Provides endpoints for managing search templates (SmartSearch feature).
 */
@RestController
@RequestMapping("/api/v1/search-templates")
@RequiredArgsConstructor
@Slf4j
public class SearchTemplateController {

    private final SearchTemplateService searchTemplateService;

    // ============================================
    // Create
    // ============================================

    /**
     * Create a new search template
     */
    @PostMapping
    public ResponseEntity<?> createTemplate(@RequestBody SearchTemplateDto request) {
        log.info("Creating template: name='{}', mode={}, userId={}", 
                request.getName(), request.getMode(), request.getUserId());

        try {
            SearchTemplate created = searchTemplateService.create(request);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(SearchTemplateDto.fromEntity(created));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ============================================
    // Read
    // ============================================

    /**
     * Get template by ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<SearchTemplateDto> getById(@PathVariable Long id) {
        return searchTemplateService.findById(id)
                .map(SearchTemplateDto::fromEntity)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get paginated templates with optional filtering
     */
    @GetMapping
    public ResponseEntity<PageResponse<SearchTemplateDto>> getAll(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection,
            @RequestParam(required = false) String userId,
            @RequestParam(required = false) String mode
    ) {
        Page<SearchTemplate> result;

        if (userId != null && mode != null) {
            result = searchTemplateService.findByUserAndMode(userId, mode, page, size);
        } else if (userId != null) {
            result = searchTemplateService.findByUser(userId, page, size);
        } else {
            result = searchTemplateService.findAll(page, size, sortBy, sortDirection);
        }

        PageResponse<SearchTemplateDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchTemplateDto::fromEntity)
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
     * Get all templates for a user (list format, no pagination)
     */
    @GetMapping("/user/{userId}")
    public ResponseEntity<List<SearchTemplateDto>> getAllByUser(@PathVariable String userId) {
        List<SearchTemplate> templates = searchTemplateService.findAllByUser(userId);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get favorite templates for a user
     */
    @GetMapping("/user/{userId}/favorites")
    public ResponseEntity<List<SearchTemplateDto>> getFavorites(@PathVariable String userId) {
        List<SearchTemplate> templates = searchTemplateService.findFavoritesByUser(userId);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get most used templates for a user
     */
    @GetMapping("/user/{userId}/most-used")
    public ResponseEntity<List<SearchTemplateDto>> getMostUsed(
            @PathVariable String userId,
            @RequestParam(defaultValue = "10") int limit
    ) {
        List<SearchTemplate> templates = searchTemplateService.findMostUsed(userId, limit);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Get recently used templates for a user
     */
    @GetMapping("/user/{userId}/recent")
    public ResponseEntity<List<SearchTemplateDto>> getRecentlyUsed(
            @PathVariable String userId,
            @RequestParam(defaultValue = "10") int limit
    ) {
        List<SearchTemplate> templates = searchTemplateService.findRecentlyUsed(userId, limit);
        List<SearchTemplateDto> response = templates.stream()
                .map(SearchTemplateDto::fromEntity)
                .toList();
        return ResponseEntity.ok(response);
    }

    /**
     * Search templates by name
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<SearchTemplateDto>> searchByName(
            @RequestParam String q,
            @RequestParam(required = false) String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<SearchTemplate> result = searchTemplateService.searchByName(q, userId, page, size);

        PageResponse<SearchTemplateDto> response = new PageResponse<>(
                result.getContent().stream()
                        .map(SearchTemplateDto::fromEntity)
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

    // ============================================
    // Update
    // ============================================

    /**
     * Update a template
     */
    @PutMapping("/{id}")
    public ResponseEntity<?> updateTemplate(
            @PathVariable Long id,
            @RequestBody SearchTemplateDto request
    ) {
        try {
            SearchTemplate updated = searchTemplateService.update(id, request);
            return ResponseEntity.ok(SearchTemplateDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            if (e.getMessage().contains("not found")) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Toggle favorite status
     */
    @PostMapping("/{id}/favorite")
    public ResponseEntity<?> toggleFavorite(@PathVariable Long id) {
        try {
            SearchTemplate updated = searchTemplateService.toggleFavorite(id);
            return ResponseEntity.ok(SearchTemplateDto.fromEntity(updated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Record template usage (when user loads a template)
     */
    @PostMapping("/{id}/use")
    public ResponseEntity<Map<String, Object>> recordUsage(@PathVariable Long id) {
        if (searchTemplateService.findById(id).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        searchTemplateService.recordUsage(id);
        return ResponseEntity.ok(Map.of(
                "message", "Usage recorded",
                "templateId", id
        ));
    }

    /**
     * Duplicate a template
     */
    @PostMapping("/{id}/duplicate")
    public ResponseEntity<?> duplicateTemplate(
            @PathVariable Long id,
            @RequestParam(required = false) String newName,
            @RequestParam(required = false) String userId
    ) {
        try {
            SearchTemplate duplicated = searchTemplateService.duplicate(id, newName, userId);
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(SearchTemplateDto.fromEntity(duplicated));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Delete
    // ============================================

    /**
     * Delete a template
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteTemplate(@PathVariable Long id) {
        try {
            searchTemplateService.delete(id);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Statistics
    // ============================================

    /**
     * Get template statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStatistics(
            @RequestParam(required = false) String userId
    ) {
        return ResponseEntity.ok(searchTemplateService.getStatistics(userId));
    }

    /**
     * Health check
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "service", "SearchTemplateService",
                "status", "available",
                "features", Map.of(
                        "create", true,
                        "favorites", true,
                        "duplicate", true,
                        "usageTracking", true
                )
        ));
    }
}
