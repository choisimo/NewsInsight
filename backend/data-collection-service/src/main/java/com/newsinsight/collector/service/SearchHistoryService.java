package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.SearchHistoryMessage;
import com.newsinsight.collector.entity.search.SearchHistory;
import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.repository.SearchHistoryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Service for managing search history.
 * Provides CRUD operations and Kafka integration for async persistence.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class SearchHistoryService {

    private final SearchHistoryRepository searchHistoryRepository;
    private final KafkaTemplate<String, SearchHistoryMessage> searchHistoryKafkaTemplate;
    private final SearchHistoryEventService searchHistoryEventService;

    // Kafka topic for search history
    public static final String SEARCH_HISTORY_TOPIC = "newsinsight.search.history";

    /**
     * Send search result to Kafka for async persistence.
     * This is the primary method to save search results asynchronously.
     * Throws IllegalStateException if Kafka send fails.
     */
    public void sendToKafka(SearchHistoryMessage message) {
        if (message.getTimestamp() == null) {
            message.setTimestamp(System.currentTimeMillis());
        }
        
        String key = message.getExternalId() != null ? message.getExternalId() : String.valueOf(message.getTimestamp());
        
        try {
            searchHistoryKafkaTemplate.send(SEARCH_HISTORY_TOPIC, key, message)
                    .get(5, TimeUnit.SECONDS);  // 동기 대기 + 5초 타임아웃
            
            log.debug("Search history sent to Kafka: key={}, topic={}", key, SEARCH_HISTORY_TOPIC);
        } catch (Exception ex) {
            log.error("Failed to send search history to Kafka: key={}, error={}", key, ex.getMessage(), ex);
            throw new IllegalStateException("Failed to queue search history for saving", ex);
        }
    }

    /**
     * Save search history directly (synchronous).
     * Use sendToKafka() for async persistence in production.
     */
    @Transactional
    public SearchHistory save(SearchHistory searchHistory) {
        return searchHistoryRepository.save(searchHistory);
    }

    /**
     * Save from Kafka message (used by consumer).
     */
    @Transactional
    public SearchHistory saveFromMessage(SearchHistoryMessage message) {
        // Check for duplicate by externalId
        if (message.getExternalId() != null) {
            Optional<SearchHistory> existing = searchHistoryRepository.findByExternalId(message.getExternalId());
            if (existing.isPresent()) {
                log.debug("Search history already exists for externalId: {}", message.getExternalId());
                return updateFromMessage(existing.get(), message);
            }
        }

        SearchHistory history = SearchHistory.builder()
                .externalId(message.getExternalId())
                .searchType(message.getSearchType())
                .query(message.getQuery())
                .timeWindow(message.getTimeWindow())
                .userId(message.getUserId())
                .sessionId(message.getSessionId())
                .parentSearchId(message.getParentSearchId())
                .depthLevel(message.getDepthLevel())
                .resultCount(message.getResultCount())
                .results(message.getResults())
                .aiSummary(message.getAiSummary())
                .discoveredUrls(message.getDiscoveredUrls())
                .factCheckResults(message.getFactCheckResults())
                .credibilityScore(message.getCredibilityScore())
                .stanceDistribution(message.getStanceDistribution())
                .metadata(message.getMetadata())
                .durationMs(message.getDurationMs())
                .errorMessage(message.getErrorMessage())
                .success(message.getSuccess())
                .build();

        SearchHistory saved = searchHistoryRepository.save(history);
        log.info("Saved search history: id={}, type={}, query='{}'", 
                saved.getId(), saved.getSearchType(), saved.getQuery());
        
        // Notify SSE subscribers
        searchHistoryEventService.notifyNewSearch(saved);
        
        return saved;
    }

    /**
     * Update existing search history from message.
     */
    private SearchHistory updateFromMessage(SearchHistory existing, SearchHistoryMessage message) {
        if (message.getResults() != null) {
            existing.setResults(message.getResults());
        }
        if (message.getResultCount() != null) {
            existing.setResultCount(message.getResultCount());
        }
        if (message.getAiSummary() != null) {
            existing.setAiSummary(message.getAiSummary());
        }
        if (message.getDiscoveredUrls() != null) {
            existing.setDiscoveredUrls(message.getDiscoveredUrls());
        }
        if (message.getFactCheckResults() != null) {
            existing.setFactCheckResults(message.getFactCheckResults());
        }
        if (message.getCredibilityScore() != null) {
            existing.setCredibilityScore(message.getCredibilityScore());
        }
        if (message.getStanceDistribution() != null) {
            existing.setStanceDistribution(message.getStanceDistribution());
        }
        if (message.getDurationMs() != null) {
            existing.setDurationMs(message.getDurationMs());
        }
        if (message.getErrorMessage() != null) {
            existing.setErrorMessage(message.getErrorMessage());
        }
        if (message.getSuccess() != null) {
            existing.setSuccess(message.getSuccess());
        }
        
        SearchHistory updated = searchHistoryRepository.save(existing);
        
        // Notify SSE subscribers of update
        searchHistoryEventService.notifyUpdatedSearch(updated);
        
        return updated;
    }

    /**
     * Find by ID.
     */
    public Optional<SearchHistory> findById(Long id) {
        return searchHistoryRepository.findById(id);
    }

    /**
     * Find by external ID (e.g., jobId).
     */
    public Optional<SearchHistory> findByExternalId(String externalId) {
        return searchHistoryRepository.findByExternalId(externalId);
    }

    /**
     * Get paginated search history.
     */
    public Page<SearchHistory> findAll(int page, int size, String sortBy, String direction) {
        Sort sort = direction.equalsIgnoreCase("ASC") 
                ? Sort.by(sortBy).ascending() 
                : Sort.by(sortBy).descending();
        Pageable pageable = PageRequest.of(page, size, sort);
        return searchHistoryRepository.findAll(pageable);
    }

    /**
     * Get search history by type.
     */
    public Page<SearchHistory> findByType(SearchType searchType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchHistoryRepository.findBySearchType(searchType, pageable);
    }

    /**
     * Get search history by user.
     */
    public Page<SearchHistory> findByUser(String userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchHistoryRepository.findByUserId(userId, pageable);
    }

    /**
     * Get search history by user and type.
     */
    public Page<SearchHistory> findByUserAndType(String userId, SearchType searchType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchHistoryRepository.findByUserIdAndSearchType(userId, searchType, pageable);
    }

    /**
     * Search history by query text.
     */
    public Page<SearchHistory> searchByQuery(String query, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchHistoryRepository.searchByQuery(query, pageable);
    }

    /**
     * Get bookmarked searches.
     */
    public Page<SearchHistory> findBookmarked(int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchHistoryRepository.findByBookmarkedTrue(pageable);
    }

    /**
     * Get derived searches from a parent.
     */
    public List<SearchHistory> findDerivedSearches(Long parentSearchId) {
        return searchHistoryRepository.findByParentSearchIdOrderByCreatedAtDesc(parentSearchId);
    }

    /**
     * Get searches from a session.
     */
    public List<SearchHistory> findBySession(String sessionId) {
        return searchHistoryRepository.findBySessionIdOrderByCreatedAtDesc(sessionId);
    }

    /**
     * Toggle bookmark status.
     */
    @Transactional
    public SearchHistory toggleBookmark(Long id) {
        SearchHistory history = searchHistoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Search history not found: " + id));
        history.setBookmarked(!history.getBookmarked());
        return searchHistoryRepository.save(history);
    }

    /**
     * Update tags.
     */
    @Transactional
    public SearchHistory updateTags(Long id, List<String> tags) {
        SearchHistory history = searchHistoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Search history not found: " + id));
        history.setTags(tags);
        return searchHistoryRepository.save(history);
    }

    /**
     * Update notes.
     */
    @Transactional
    public SearchHistory updateNotes(Long id, String notes) {
        SearchHistory history = searchHistoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Search history not found: " + id));
        history.setNotes(notes);
        return searchHistoryRepository.save(history);
    }

    /**
     * Delete search history.
     */
    @Transactional
    public void delete(Long id) {
        searchHistoryRepository.deleteById(id);
        log.info("Deleted search history: id={}", id);
        
        // Notify SSE subscribers
        searchHistoryEventService.notifyDeletedSearch(id);
    }

    /**
     * Delete old non-bookmarked searches (for cleanup).
     */
    @Transactional
    public void cleanupOldSearches(int daysOld) {
        LocalDateTime before = LocalDateTime.now().minusDays(daysOld);
        searchHistoryRepository.deleteOldSearches(before);
        log.info("Cleaned up search history older than {} days", daysOld);
    }

    /**
     * Get search statistics.
     */
    public Map<String, Object> getStatistics(int days) {
        LocalDateTime after = LocalDateTime.now().minusDays(days);
        List<SearchHistoryRepository.SearchStatsSummary> stats = 
                searchHistoryRepository.getSearchStatsSummary(after);
        
        long totalCount = stats.stream().mapToLong(SearchHistoryRepository.SearchStatsSummary::getCount).sum();
        
        return Map.of(
                "totalSearches", totalCount,
                "byType", stats,
                "period", Map.of("days", days, "since", after.toString())
        );
    }

    /**
     * Get recently discovered URLs.
     */
    public List<String> getRecentDiscoveredUrls(int days, int limit) {
        LocalDateTime after = LocalDateTime.now().minusDays(days);
        return searchHistoryRepository.findRecentDiscoveredUrls(after, limit);
    }

    /**
     * Create a derived search (for drill-down functionality).
     */
    @Transactional
    public SearchHistory createDerivedSearch(Long parentId, SearchHistoryMessage message) {
        SearchHistory parent = searchHistoryRepository.findById(parentId)
                .orElseThrow(() -> new IllegalArgumentException("Parent search not found: " + parentId));
        
        message.setParentSearchId(parentId);
        message.setDepthLevel(parent.getDepthLevel() + 1);
        message.setSessionId(parent.getSessionId());
        message.setUserId(parent.getUserId());
        
        return saveFromMessage(message);
    }

    // ============================================
    // Continue Work Feature
    // ============================================

    /**
     * Find actionable items for "Continue Work" feature.
     * Returns searches that need user attention:
     * - IN_PROGRESS: Still running
     * - FAILED: Need retry
     * - PARTIAL: Incomplete results
     * - DRAFT: Not executed yet
     * - COMPLETED but not viewed: Need review
     */
    public List<SearchHistory> findContinueWorkItems(String userId, String sessionId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return searchHistoryRepository.findContinueWorkItems(userId, sessionId, pageable);
    }

    /**
     * Mark search as viewed.
     */
    @Transactional
    public SearchHistory markAsViewed(Long id) {
        SearchHistory history = searchHistoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Search history not found: " + id));
        
        history.markViewed();
        return searchHistoryRepository.save(history);
    }

    /**
     * Mark search as viewed by external ID.
     */
    @Transactional
    public SearchHistory markAsViewedByExternalId(String externalId) {
        SearchHistory history = searchHistoryRepository.findByExternalId(externalId)
                .orElseThrow(() -> new IllegalArgumentException("Search history not found for externalId: " + externalId));
        
        history.markViewed();
        return searchHistoryRepository.save(history);
    }

    /**
     * Update completion status.
     */
    @Transactional
    public SearchHistory updateCompletionStatus(Long id, SearchHistory.CompletionStatus status) {
        SearchHistory history = searchHistoryRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Search history not found: " + id));
        
        history.setCompletionStatus(status);
        return searchHistoryRepository.save(history);
    }

    /**
     * Find by completion status.
     */
    public Page<SearchHistory> findByCompletionStatus(SearchHistory.CompletionStatus status, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("updatedAt").descending());
        return searchHistoryRepository.findByCompletionStatus(status, pageable);
    }

    /**
     * Find by project ID.
     */
    public Page<SearchHistory> findByProjectId(Long projectId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return searchHistoryRepository.findByProjectId(projectId, pageable);
    }

    /**
     * Find failed searches for potential retry.
     */
    public List<SearchHistory> findFailedSearches(int daysBack, int limit) {
        LocalDateTime after = LocalDateTime.now().minusDays(daysBack);
        Pageable pageable = PageRequest.of(0, limit);
        return searchHistoryRepository.findFailedSearches(after, pageable);
    }

    /**
     * Count in-progress searches for a user.
     */
    public long countInProgressByUser(String userId) {
        return searchHistoryRepository.countInProgressByUser(userId);
    }

    /**
     * Get continue work statistics.
     */
    public Map<String, Object> getContinueWorkStats(String userId, String sessionId) {
        List<SearchHistory> items = findContinueWorkItems(userId, sessionId, 100);
        
        long inProgress = items.stream()
                .filter(h -> h.getCompletionStatus() == SearchHistory.CompletionStatus.IN_PROGRESS)
                .count();
        long failed = items.stream()
                .filter(h -> h.getCompletionStatus() == SearchHistory.CompletionStatus.FAILED)
                .count();
        long draft = items.stream()
                .filter(h -> h.getCompletionStatus() == SearchHistory.CompletionStatus.DRAFT)
                .count();
        long partial = items.stream()
                .filter(h -> h.getCompletionStatus() == SearchHistory.CompletionStatus.PARTIAL)
                .count();
        long unviewed = items.stream()
                .filter(h -> h.getCompletionStatus() == SearchHistory.CompletionStatus.COMPLETED && !h.getViewed())
                .count();

        return Map.of(
                "total", items.size(),
                "inProgress", inProgress,
                "failed", failed,
                "draft", draft,
                "partial", partial,
                "unviewedCompleted", unviewed
        );
    }
}
