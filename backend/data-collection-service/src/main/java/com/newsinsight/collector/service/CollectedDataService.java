package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.repository.CollectedDataRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Slf4j
public class CollectedDataService {

    private final CollectedDataRepository collectedDataRepository;

    /**
     * Compute SHA-256 content hash for deduplication
     */
    public String computeContentHash(String url, String title, String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update((url != null ? url : "").getBytes(StandardCharsets.UTF_8));
            digest.update((title != null ? title : "").getBytes(StandardCharsets.UTF_8));
            digest.update((content != null ? content : "").getBytes(StandardCharsets.UTF_8));
            
            byte[] hash = digest.digest();
            StringBuilder hexString = new StringBuilder();
            for (byte b : hash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1) hexString.append('0');
                hexString.append(hex);
            }
            return hexString.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }

    /**
     * Check if content already exists by hash
     */
    public boolean isDuplicate(String contentHash) {
        return collectedDataRepository.findByContentHash(contentHash).isPresent();
    }

    /**
     * Save collected data item
     */
    @Transactional
    public CollectedData save(CollectedData data) {
        // Compute content hash if not set
        if (data.getContentHash() == null) {
            String hash = computeContentHash(data.getUrl(), data.getTitle(), data.getContent());
            data.setContentHash(hash);
        }
        
        // Check if duplicate
        if (isDuplicate(data.getContentHash())) {
            log.debug("Duplicate content detected: {}", data.getContentHash());
            data.setDuplicate(true);
        }
        
        return collectedDataRepository.save(data);
    }

    /**
     * Get collected data by ID
     */
    public Optional<CollectedData> findById(Long id) {
        return collectedDataRepository.findById(id);
    }

    /**
     * Get all collected data with pagination
     */
    public Page<CollectedData> findAll(Pageable pageable) {
        return collectedDataRepository.findAll(pageable);
    }

    /**
     * Get unprocessed data
     */
    public Page<CollectedData> findUnprocessed(Pageable pageable) {
        return collectedDataRepository.findByProcessedFalse(pageable);
    }

    /**
     * Get data by source ID
     */
    public Page<CollectedData> findBySourceId(Long sourceId, Pageable pageable) {
        return collectedDataRepository.findBySourceId(sourceId, pageable);
    }

    /**
     * Mark data as processed
     */
    @Transactional
    public boolean markAsProcessed(Long id) {
        Optional<CollectedData> dataOpt = collectedDataRepository.findById(id);
        if (dataOpt.isEmpty()) {
            return false;
        }
        
        CollectedData data = dataOpt.get();
        data.setProcessed(true);
        collectedDataRepository.save(data);
        return true;
    }

    /**
     * Count total collected items
     */
    public long countTotal() {
        return collectedDataRepository.count();
    }

    /**
     * Count unprocessed items
     */
    public long countUnprocessed() {
        return collectedDataRepository.countByProcessedFalse();
    }

    /**
     * Calculate quality score based on QA metrics
     */
    public double calculateQualityScore(
            Boolean httpOk,
            boolean hasContent,
            boolean duplicate,
            double semanticConsistency,
            double outlierScore) {
        
        double httpScore = httpOk == null ? 0.5 : (httpOk ? 1.0 : 0.0);
        double contentScore = hasContent ? 1.0 : 0.0;
        double duplicatePenalty = duplicate ? 1.0 : 0.0;
        double outlierPenalty = Math.max(0.0, Math.min(1.0, outlierScore));
        double sem = Math.max(0.0, Math.min(1.0, semanticConsistency));
        
        double score = 0.25 * httpScore + 0.25 * contentScore + 0.3 * sem + 
                      0.2 * (1.0 - outlierPenalty) - 0.2 * duplicatePenalty;
        
        return Math.max(0.0, Math.min(1.0, score));
    }

    /**
     * Calculate trust score based on URL domain
     */
    public double calculateTrustScore(String url, Boolean httpOk, boolean inWhitelist) {
        double base = inWhitelist ? 0.9 : 0.5;
        if (Boolean.TRUE.equals(httpOk)) {
            base += 0.1;
        }
        return Math.max(0.0, Math.min(1.0, base));
    }
}
