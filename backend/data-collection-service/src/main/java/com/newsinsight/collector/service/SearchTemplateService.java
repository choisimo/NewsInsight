package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.SearchTemplateDto;
import com.newsinsight.collector.entity.search.SearchTemplate;
import com.newsinsight.collector.repository.SearchTemplateRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Service for managing search templates.
 * Provides CRUD operations and query functionality for templates.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SearchTemplateService {

    private final SearchTemplateRepository searchTemplateRepository;

    /**
     * Create a new template
     */
    @Transactional
    public SearchTemplate create(SearchTemplateDto dto) {
        if (dto.getName() == null || dto.getName().isBlank()) {
            throw new IllegalArgumentException("Template name is required");
        }
        if (dto.getQuery() == null || dto.getQuery().isBlank()) {
            throw new IllegalArgumentException("Template query is required");
        }
        if (dto.getMode() == null || dto.getMode().isBlank()) {
            throw new IllegalArgumentException("Template mode is required");
        }

        // Check for duplicate name for same user
        if (dto.getUserId() != null && 
            searchTemplateRepository.existsByUserIdAndName(dto.getUserId(), dto.getName())) {
            throw new IllegalArgumentException("Template with this name already exists");
        }

        SearchTemplate template = dto.toEntity();
        SearchTemplate saved = searchTemplateRepository.save(template);
        log.info("Created template: id={}, name='{}', mode={}, userId={}", 
                saved.getId(), saved.getName(), saved.getMode(), saved.getUserId());
        return saved;
    }

    /**
     * Update an existing template
     */
    @Transactional
    public SearchTemplate update(Long id, SearchTemplateDto dto) {
        SearchTemplate template = searchTemplateRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Template not found: " + id));

        if (dto.getName() != null && !dto.getName().isBlank()) {
            // Check for duplicate name if changing
            if (!dto.getName().equals(template.getName()) && 
                template.getUserId() != null &&
                searchTemplateRepository.existsByUserIdAndName(template.getUserId(), dto.getName())) {
                throw new IllegalArgumentException("Template with this name already exists");
            }
            template.setName(dto.getName());
        }
        if (dto.getQuery() != null) {
            template.setQuery(dto.getQuery());
        }
        if (dto.getMode() != null) {
            template.setMode(dto.getMode());
        }
        if (dto.getItems() != null) {
            template.setItems(dto.getItems());
        }
        if (dto.getDescription() != null) {
            template.setDescription(dto.getDescription());
        }
        if (dto.getTags() != null) {
            template.setTags(dto.getTags());
        }
        if (dto.getMetadata() != null) {
            template.setMetadata(dto.getMetadata());
        }

        SearchTemplate updated = searchTemplateRepository.save(template);
        log.info("Updated template: id={}, name='{}'", updated.getId(), updated.getName());
        return updated;
    }

    /**
     * Find by ID
     */
    public Optional<SearchTemplate> findById(Long id) {
        return searchTemplateRepository.findById(id);
    }

    /**
     * Get paginated templates
     */
    public Page<SearchTemplate> findAll(int page, int size, String sortBy, String direction) {
        Sort sort = direction.equalsIgnoreCase("ASC")
                ? Sort.by(sortBy).ascending()
                : Sort.by(sortBy).descending();
        Pageable pageable = PageRequest.of(page, size, sort);
        return searchTemplateRepository.findAll(pageable);
    }

    /**
     * Get templates by user
     */
    public Page<SearchTemplate> findByUser(String userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchTemplateRepository.findByUserId(userId, pageable);
    }

    /**
     * Get all templates for a user (list)
     */
    public List<SearchTemplate> findAllByUser(String userId) {
        return searchTemplateRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    /**
     * Get templates by user and mode
     */
    public Page<SearchTemplate> findByUserAndMode(String userId, String mode, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchTemplateRepository.findByUserIdAndMode(userId, mode, pageable);
    }

    /**
     * Get favorite templates for a user
     */
    public List<SearchTemplate> findFavoritesByUser(String userId) {
        return searchTemplateRepository.findByUserIdAndFavoriteTrueOrderByLastUsedAtDesc(userId);
    }

    /**
     * Search templates by name
     */
    public Page<SearchTemplate> searchByName(String name, String userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        if (userId != null) {
            return searchTemplateRepository.searchByNameAndUserId(name, userId, pageable);
        }
        return searchTemplateRepository.searchByName(name, pageable);
    }

    /**
     * Get most used templates for a user
     */
    public List<SearchTemplate> findMostUsed(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return searchTemplateRepository.findMostUsedByUser(userId, pageable);
    }

    /**
     * Get recently used templates for a user
     */
    public List<SearchTemplate> findRecentlyUsed(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return searchTemplateRepository.findRecentlyUsedByUser(userId, pageable);
    }

    /**
     * Toggle favorite status
     */
    @Transactional
    public SearchTemplate toggleFavorite(Long id) {
        SearchTemplate template = searchTemplateRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Template not found: " + id));
        template.setFavorite(!template.getFavorite());
        return searchTemplateRepository.save(template);
    }

    /**
     * Record template usage
     */
    @Transactional
    public void recordUsage(Long id) {
        searchTemplateRepository.incrementUseCount(id);
        log.debug("Recorded usage for template: id={}", id);
    }

    /**
     * Delete template
     */
    @Transactional
    public void delete(Long id) {
        if (!searchTemplateRepository.existsById(id)) {
            throw new IllegalArgumentException("Template not found: " + id);
        }
        searchTemplateRepository.deleteById(id);
        log.info("Deleted template: id={}", id);
    }

    /**
     * Get template statistics
     */
    public Map<String, Object> getStatistics(String userId) {
        long totalCount = userId != null 
                ? searchTemplateRepository.countByUserId(userId)
                : searchTemplateRepository.count();
        
        long unifiedCount = searchTemplateRepository.countByMode("unified");
        long deepCount = searchTemplateRepository.countByMode("deep");
        long factcheckCount = searchTemplateRepository.countByMode("factcheck");

        return Map.of(
                "totalTemplates", totalCount,
                "byMode", Map.of(
                        "unified", unifiedCount,
                        "deep", deepCount,
                        "factcheck", factcheckCount
                ),
                "userId", userId != null ? userId : "all"
        );
    }

    /**
     * Duplicate a template
     */
    @Transactional
    public SearchTemplate duplicate(Long id, String newName, String userId) {
        SearchTemplate original = searchTemplateRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Template not found: " + id));

        String name = newName != null ? newName : original.getName() + " (copy)";
        
        // Ensure unique name
        String finalName = name;
        int counter = 1;
        while (userId != null && searchTemplateRepository.existsByUserIdAndName(userId, finalName)) {
            finalName = name + " " + counter++;
        }

        SearchTemplate copy = SearchTemplate.builder()
                .name(finalName)
                .query(original.getQuery())
                .mode(original.getMode())
                .userId(userId != null ? userId : original.getUserId())
                .items(original.getItems())
                .description(original.getDescription())
                .tags(original.getTags())
                .metadata(original.getMetadata())
                .sourceSearchId(original.getSourceSearchId())
                .build();

        SearchTemplate saved = searchTemplateRepository.save(copy);
        log.info("Duplicated template: originalId={}, newId={}, newName='{}'", 
                id, saved.getId(), saved.getName());
        return saved;
    }
}
