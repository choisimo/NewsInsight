package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.project.Project;
import com.newsinsight.collector.entity.project.ProjectActivityLog;
import com.newsinsight.collector.entity.project.ProjectItem;
import com.newsinsight.collector.entity.project.ProjectNotification;
import com.newsinsight.collector.entity.search.SearchType;
import com.newsinsight.collector.repository.ProjectRepository;
import com.newsinsight.collector.service.SearchJobQueueService.SearchJobRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Service for automatic news collection for projects.
 * Runs on a schedule to collect news for projects with auto-collect enabled.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProjectAutoCollectService {

    private final ProjectRepository projectRepository;
    private final ProjectService projectService;
    private final SearchJobQueueService searchJobQueueService;
    private final UnifiedSearchService unifiedSearchService;

    /**
     * Scheduled task to process auto-collection for projects.
     * Runs every 30 minutes.
     */
    @Scheduled(fixedRate = 1800000) // 30 minutes
    @Transactional
    public void processAutoCollection() {
        log.info("Starting scheduled auto-collection processing");

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime hourAgo = now.minusHours(1);
        LocalDateTime dayAgo = now.minusDays(1);
        LocalDateTime weekAgo = now.minusWeeks(1);

        List<Project> projectsToCollect = projectRepository.findProjectsNeedingCollection(
                hourAgo, dayAgo, weekAgo
        );

        log.info("Found {} projects needing collection", projectsToCollect.size());

        for (Project project : projectsToCollect) {
            try {
                collectForProject(project);
            } catch (Exception e) {
                log.error("Failed to collect for project {}: {}", project.getId(), e.getMessage(), e);
            }
        }

        log.info("Completed auto-collection processing");
    }

    /**
     * Collect news for a specific project.
     */
    @Transactional
    public void collectForProject(Project project) {
        log.info("Starting collection for project: id={}, name='{}'", project.getId(), project.getName());

        List<String> keywords = project.getKeywords();
        if (keywords == null || keywords.isEmpty()) {
            log.warn("Project {} has no keywords configured for collection", project.getId());
            return;
        }

        Project.ProjectSettings settings = project.getSettings();
        String timeWindow = settings != null && settings.getTimeWindow() != null 
                ? settings.getTimeWindow() 
                : "7d";

        // Build search query from keywords
        String query = buildSearchQuery(keywords);

        // Start search job
        SearchJobRequest jobRequest = SearchJobRequest.builder()
                .type(SearchType.UNIFIED)
                .query(query)
                .timeWindow(timeWindow)
                .userId(project.getOwnerId())
                .projectId(project.getId())
                .options(Map.of(
                        "autoCollect", true,
                        "projectName", project.getName()
                ))
                .build();

        String jobId = searchJobQueueService.startJob(jobRequest);
        log.info("Started auto-collection job: jobId={}, projectId={}", jobId, project.getId());

        // Update project last collected timestamp
        projectRepository.updateLastCollected(project.getId(), LocalDateTime.now());

        // Log activity
        projectService.logActivity(
                project.getId(),
                "system",
                ProjectActivityLog.ActivityType.AUTO_COLLECTION,
                "자동 수집 실행: " + query,
                "job",
                jobId,
                Map.of("keywords", keywords, "timeWindow", timeWindow)
        );
    }

    /**
     * Manually trigger collection for a project.
     */
    @Transactional
    public String triggerCollection(Long projectId, String userId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + projectId));

        log.info("Manual collection triggered: projectId={}, triggeredBy={}", projectId, userId);

        List<String> keywords = project.getKeywords();
        if (keywords == null || keywords.isEmpty()) {
            throw new IllegalStateException("Project has no keywords configured for collection");
        }

        Project.ProjectSettings settings = project.getSettings();
        String timeWindow = settings != null && settings.getTimeWindow() != null 
                ? settings.getTimeWindow() 
                : "7d";

        String query = buildSearchQuery(keywords);

        SearchJobRequest jobRequest = SearchJobRequest.builder()
                .type(SearchType.UNIFIED)
                .query(query)
                .timeWindow(timeWindow)
                .userId(userId)
                .projectId(projectId)
                .options(Map.of(
                        "manualTrigger", true,
                        "triggeredBy", userId
                ))
                .build();

        String jobId = searchJobQueueService.startJob(jobRequest);

        // Update project
        projectRepository.updateLastCollected(projectId, LocalDateTime.now());
        projectRepository.updateLastActivity(projectId, LocalDateTime.now());

        // Log activity
        projectService.logActivity(
                projectId,
                userId,
                ProjectActivityLog.ActivityType.MANUAL_COLLECTION,
                "수동 수집 실행: " + query,
                "job",
                jobId,
                Map.of("keywords", keywords, "timeWindow", timeWindow)
        );

        return jobId;
    }

    /**
     * Process search results and add to project.
     * Called by SearchJobQueueService when a project-related search completes.
     */
    @Transactional
    public void processSearchResults(Long projectId, String jobId, List<Map<String, Object>> results, String userId) {
        log.info("Processing search results for project: projectId={}, resultCount={}", projectId, results.size());

        int addedCount = 0;
        int duplicateCount = 0;

        for (Map<String, Object> result : results) {
            try {
                String url = (String) result.get("url");
                
                // Check for duplicates by URL
                List<ProjectItem> existing = projectService.getProject(projectId)
                        .map(p -> List.<ProjectItem>of()) // Simplified - would need actual check
                        .orElse(List.of());
                
                // For now, assume no duplicates check needed (would need proper implementation)
                
                ProjectService.AddItemRequest itemRequest = ProjectService.AddItemRequest.builder()
                        .itemType(ProjectItem.ItemType.ARTICLE)
                        .title((String) result.get("title"))
                        .summary((String) result.get("snippet"))
                        .url(url)
                        .imageUrl((String) result.get("imageUrl"))
                        .sourceName((String) result.get("source"))
                        .sourceId(jobId)
                        .sourceType("auto_collect")
                        .publishedAt(parsePublishedAt(result.get("publishedAt")))
                        .sentiment((String) result.get("sentiment"))
                        .importance(calculateImportance(result))
                        .metadata(Map.of(
                                "jobId", jobId,
                                "autoCollected", true
                        ))
                        .build();

                projectService.addItem(projectId, itemRequest, userId != null ? userId : "system");
                addedCount++;
                
            } catch (Exception e) {
                log.warn("Failed to add result to project: {}", e.getMessage());
            }
        }

        log.info("Added {} items to project {} (duplicates: {})", addedCount, projectId, duplicateCount);

        // Notify project owner if significant results found
        if (addedCount > 0) {
            Project project = projectRepository.findById(projectId).orElse(null);
            if (project != null) {
                projectService.createNotification(
                        projectId,
                        project.getOwnerId(),
                        ProjectNotification.NotificationType.NEW_ARTICLES,
                        "새로운 기사 수집 완료",
                        String.format("%d개의 새로운 기사가 수집되었습니다.", addedCount),
                        "/projects/" + projectId + "/items"
                );
            }
        }
    }

    /**
     * Build search query from keywords.
     */
    private String buildSearchQuery(List<String> keywords) {
        if (keywords.size() == 1) {
            return keywords.get(0);
        }
        
        // Join keywords with OR for broader search
        // Could be made more sophisticated with AND/OR options
        return String.join(" OR ", keywords);
    }

    /**
     * Parse published date from result.
     */
    private LocalDateTime parsePublishedAt(Object publishedAt) {
        if (publishedAt == null) {
            return null;
        }
        
        if (publishedAt instanceof LocalDateTime) {
            return (LocalDateTime) publishedAt;
        }
        
        if (publishedAt instanceof String dateStr) {
            try {
                return LocalDateTime.parse(dateStr);
            } catch (Exception e) {
                // Try other formats
                try {
                    return LocalDateTime.parse(dateStr.replace("Z", ""));
                } catch (Exception e2) {
                    return null;
                }
            }
        }
        
        return null;
    }

    /**
     * Calculate importance score for an article.
     */
    private int calculateImportance(Map<String, Object> result) {
        int importance = 50; // Default

        // Boost for credibility score
        Object credibility = result.get("credibilityScore");
        if (credibility instanceof Number) {
            importance += ((Number) credibility).intValue() / 2;
        }

        // Boost for recent articles
        LocalDateTime publishedAt = parsePublishedAt(result.get("publishedAt"));
        if (publishedAt != null && publishedAt.isAfter(LocalDateTime.now().minusDays(1))) {
            importance += 10;
        }

        // Cap at 100
        return Math.min(importance, 100);
    }

    /**
     * Get collection status for a project.
     */
    public Map<String, Object> getCollectionStatus(Long projectId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + projectId));

        boolean autoCollectEnabled = project.isAutoCollectEnabled();
        LocalDateTime lastCollected = project.getLastCollectedAt();
        String interval = project.getSettings() != null ? project.getSettings().getCollectInterval() : "daily";

        LocalDateTime nextCollection = null;
        if (lastCollected != null && autoCollectEnabled) {
            nextCollection = switch (interval) {
                case "hourly" -> lastCollected.plusHours(1);
                case "weekly" -> lastCollected.plusWeeks(1);
                default -> lastCollected.plusDays(1); // daily
            };
        }

        return Map.of(
                "projectId", projectId,
                "autoCollectEnabled", autoCollectEnabled,
                "interval", interval,
                "lastCollectedAt", lastCollected != null ? lastCollected.toString() : null,
                "nextCollectionAt", nextCollection != null ? nextCollection.toString() : null,
                "keywords", project.getKeywords() != null ? project.getKeywords() : List.of()
        );
    }

    /**
     * Update auto-collect settings for a project.
     */
    @Transactional
    public void updateAutoCollectSettings(Long projectId, boolean enabled, String interval, String userId) {
        Project project = projectRepository.findById(projectId)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + projectId));

        Project.ProjectSettings settings = project.getSettings();
        if (settings == null) {
            settings = Project.ProjectSettings.builder().build();
        }

        settings.setAutoCollect(enabled);
        if (interval != null) {
            settings.setCollectInterval(interval);
        }

        project.setSettings(settings);
        projectRepository.save(project);

        // Log activity
        projectService.logActivity(
                projectId,
                userId,
                ProjectActivityLog.ActivityType.SETTINGS_CHANGED,
                "자동 수집 설정 변경: " + (enabled ? "활성화" : "비활성화"),
                "project",
                projectId.toString(),
                Map.of("autoCollect", enabled, "interval", interval != null ? interval : settings.getCollectInterval())
        );

        log.info("Updated auto-collect settings: projectId={}, enabled={}, interval={}", 
                projectId, enabled, interval);
    }
}
