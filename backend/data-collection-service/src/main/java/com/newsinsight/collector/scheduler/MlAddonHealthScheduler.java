package com.newsinsight.collector.scheduler;

import com.newsinsight.collector.entity.addon.AddonHealthStatus;
import com.newsinsight.collector.entity.addon.MlAddon;
import com.newsinsight.collector.repository.MlAddonRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * ML Addon Health Check Scheduler.
 * 
 * Periodically checks the health of registered ML addons and updates their status.
 * Supports automatic disabling of unhealthy addons after consecutive failures.
 */
@Component
@RequiredArgsConstructor
@Slf4j
@ConditionalOnProperty(name = "ml.addon.health-check.enabled", havingValue = "true", matchIfMissing = true)
public class MlAddonHealthScheduler {

    private final MlAddonRepository mlAddonRepository;
    private final RestTemplate restTemplate;

    @Value("${ml.addon.health-check.timeout-ms:5000}")
    private int healthCheckTimeoutMs;

    @Value("${ml.addon.health-check.max-consecutive-failures:3}")
    private int maxConsecutiveFailures;

    @Value("${ml.addon.health-check.auto-disable:false}")
    private boolean autoDisableUnhealthy;

    @Value("${ml.addon.health-check.interval-minutes:5}")
    private int healthCheckIntervalMinutes;

    // Track consecutive failures per addon
    private final Map<Long, AtomicInteger> failureCounters = new ConcurrentHashMap<>();

    /**
     * Periodic health check for all registered ML addons.
     * Default: runs every 5 minutes.
     */
    @Scheduled(fixedDelayString = "${ml.addon.health-check.interval-ms:300000}")
    @Transactional
    public void checkAddonHealth() {
        log.debug("[MlAddonHealth] Starting health check cycle...");
        
        // Get addons that need health check
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(healthCheckIntervalMinutes);
        List<MlAddon> addonsToCheck = mlAddonRepository.findAddonsNeedingHealthCheck(cutoff);
        
        if (addonsToCheck.isEmpty()) {
            log.debug("[MlAddonHealth] No addons need health check at this time");
            return;
        }
        
        log.info("[MlAddonHealth] Checking {} addons...", addonsToCheck.size());
        
        int healthy = 0;
        int unhealthy = 0;
        int degraded = 0;
        
        for (MlAddon addon : addonsToCheck) {
            try {
                AddonHealthStatus status = checkSingleAddon(addon);
                updateAddonHealth(addon, status);
                
                switch (status) {
                    case HEALTHY -> healthy++;
                    case UNHEALTHY -> unhealthy++;
                    case DEGRADED -> degraded++;
                    default -> {} // UNKNOWN - shouldn't happen after check
                }
            } catch (Exception e) {
                log.error("[MlAddonHealth] Error checking addon {}: {}", addon.getAddonKey(), e.getMessage());
                updateAddonHealth(addon, AddonHealthStatus.UNHEALTHY);
                unhealthy++;
            }
        }
        
        log.info("[MlAddonHealth] Health check complete: healthy={}, degraded={}, unhealthy={}", 
                healthy, degraded, unhealthy);
    }

    /**
     * Check health of a single addon.
     */
    private AddonHealthStatus checkSingleAddon(MlAddon addon) {
        if (addon.getHealthCheckUrl() == null || addon.getHealthCheckUrl().isBlank()) {
            log.debug("[MlAddonHealth] Addon {} has no health check URL, marking as UNKNOWN", addon.getAddonKey());
            return AddonHealthStatus.UNKNOWN;
        }
        
        try {
            long startTime = System.currentTimeMillis();
            ResponseEntity<Map> response = restTemplate.getForEntity(
                addon.getHealthCheckUrl(), 
                Map.class
            );
            long latencyMs = System.currentTimeMillis() - startTime;
            
            if (response.getStatusCode().is2xxSuccessful()) {
                // Clear failure counter on success
                failureCounters.remove(addon.getId());
                
                // Check if response indicates healthy status
                Map<?, ?> body = response.getBody();
                if (body != null) {
                    Object status = body.get("status");
                    if ("healthy".equalsIgnoreCase(String.valueOf(status)) ||
                        "ok".equalsIgnoreCase(String.valueOf(status))) {
                        
                        // Check latency for degraded status
                        if (latencyMs > addon.getTimeoutMs() / 2) {
                            log.warn("[MlAddonHealth] Addon {} responding slowly: {}ms", 
                                    addon.getAddonKey(), latencyMs);
                            return AddonHealthStatus.DEGRADED;
                        }
                        
                        log.debug("[MlAddonHealth] Addon {} is healthy ({}ms)", addon.getAddonKey(), latencyMs);
                        return AddonHealthStatus.HEALTHY;
                    }
                }
                
                // Response OK but status field not healthy
                return AddonHealthStatus.DEGRADED;
            } else {
                // Non-2xx response
                incrementFailureCounter(addon);
                return AddonHealthStatus.UNHEALTHY;
            }
            
        } catch (RestClientException e) {
            log.warn("[MlAddonHealth] Failed to reach addon {}: {}", addon.getAddonKey(), e.getMessage());
            incrementFailureCounter(addon);
            return AddonHealthStatus.UNHEALTHY;
        }
    }

    /**
     * Update addon health status in database.
     */
    @Transactional
    protected void updateAddonHealth(MlAddon addon, AddonHealthStatus status) {
        mlAddonRepository.updateHealthStatus(addon.getId(), status, LocalDateTime.now());
        
        // Check if we should auto-disable
        if (autoDisableUnhealthy && status == AddonHealthStatus.UNHEALTHY) {
            AtomicInteger counter = failureCounters.get(addon.getId());
            if (counter != null && counter.get() >= maxConsecutiveFailures) {
                log.warn("[MlAddonHealth] Auto-disabling addon {} after {} consecutive failures", 
                        addon.getAddonKey(), counter.get());
                mlAddonRepository.disableAddon(addon.getId());
                failureCounters.remove(addon.getId());
            }
        }
    }

    /**
     * Increment failure counter for an addon.
     */
    private void incrementFailureCounter(MlAddon addon) {
        failureCounters.computeIfAbsent(addon.getId(), k -> new AtomicInteger(0)).incrementAndGet();
    }

    /**
     * Manually trigger health check for a specific addon.
     */
    @Transactional
    public AddonHealthStatus checkAddonHealthNow(Long addonId) {
        MlAddon addon = mlAddonRepository.findById(addonId)
                .orElseThrow(() -> new IllegalArgumentException("Addon not found: " + addonId));
        
        AddonHealthStatus status = checkSingleAddon(addon);
        updateAddonHealth(addon, status);
        
        return status;
    }

    /**
     * Manually trigger health check for all addons.
     */
    @Transactional
    public Map<String, Integer> checkAllAddonsNow() {
        List<MlAddon> allAddons = mlAddonRepository.findByEnabledTrue();
        
        int healthy = 0;
        int unhealthy = 0;
        int degraded = 0;
        int unknown = 0;
        
        for (MlAddon addon : allAddons) {
            AddonHealthStatus status = checkSingleAddon(addon);
            updateAddonHealth(addon, status);
            
            switch (status) {
                case HEALTHY -> healthy++;
                case UNHEALTHY -> unhealthy++;
                case DEGRADED -> degraded++;
                case UNKNOWN -> unknown++;
            }
        }
        
        return Map.of(
            "healthy", healthy,
            "unhealthy", unhealthy,
            "degraded", degraded,
            "unknown", unknown,
            "total", allAddons.size()
        );
    }

    /**
     * Get current health statistics.
     */
    public Map<String, Object> getHealthStats() {
        List<MlAddon> allAddons = mlAddonRepository.findByEnabledTrue();
        
        long healthy = allAddons.stream()
                .filter(a -> a.getHealthStatus() == AddonHealthStatus.HEALTHY)
                .count();
        long unhealthy = allAddons.stream()
                .filter(a -> a.getHealthStatus() == AddonHealthStatus.UNHEALTHY)
                .count();
        long degraded = allAddons.stream()
                .filter(a -> a.getHealthStatus() == AddonHealthStatus.DEGRADED)
                .count();
        long unknown = allAddons.stream()
                .filter(a -> a.getHealthStatus() == AddonHealthStatus.UNKNOWN)
                .count();
        
        return Map.of(
            "healthy", healthy,
            "unhealthy", unhealthy,
            "degraded", degraded,
            "unknown", unknown,
            "total", allAddons.size(),
            "healthRate", allAddons.isEmpty() ? 0.0 : (double) healthy / allAddons.size()
        );
    }

    /**
     * Reset failure counter for an addon (e.g., after manual intervention).
     */
    public void resetFailureCounter(Long addonId) {
        failureCounters.remove(addonId);
        log.info("[MlAddonHealth] Reset failure counter for addon {}", addonId);
    }

    /**
     * Log health summary periodically (every hour).
     */
    @Scheduled(cron = "0 0 * * * *")
    public void logHealthSummary() {
        Map<String, Object> stats = getHealthStats();
        log.info("[MlAddonHealth] Hourly summary: healthy={}, degraded={}, unhealthy={}, unknown={}, total={}", 
                stats.get("healthy"), 
                stats.get("degraded"), 
                stats.get("unhealthy"), 
                stats.get("unknown"),
                stats.get("total"));
    }
}
