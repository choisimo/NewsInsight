package com.newsinsight.collector.service;

import com.newsinsight.collector.config.TrustScoreConfig;
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
    private final TrustScoreConfig trustScoreConfig;

    /**
     * 중복 제거를 위한 SHA-256 콘텐츠 해시 계산
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
     * 해시값으로 콘텐츠 존재 여부 확인
     */
    public boolean isDuplicate(String contentHash) {
        return collectedDataRepository.findByContentHash(contentHash).isPresent();
    }

    /**
     * 수집된 데이터 저장
     */
    @Transactional
    public CollectedData save(CollectedData data) {
        // 콘텐츠 해시가 비어있으면 계산하여 설정
        if (data.getContentHash() == null) {
            String hash = computeContentHash(data.getUrl(), data.getTitle(), data.getContent());
            data.setContentHash(hash);
        }
        
        // 중복 여부 확인
        if (isDuplicate(data.getContentHash())) {
            log.debug("Duplicate content detected: {}", data.getContentHash());
            data.setDuplicate(true);
        }
        
        return collectedDataRepository.save(data);
    }

    /**
     * 수집된 데이터 단건 조회 (ID)
     */
    public Optional<CollectedData> findById(Long id) {
        return collectedDataRepository.findById(id);
    }

    /**
     * 수집된 데이터 전체 조회 (페이지네이션)
     */
    public Page<CollectedData> findAll(Pageable pageable) {
        return collectedDataRepository.findAll(pageable);
    }

    /**
     * 미처리 데이터 조회
     */
    public Page<CollectedData> findUnprocessed(Pageable pageable) {
        return collectedDataRepository.findByProcessedFalse(pageable);
    }

    /**
     * 소스 ID 기준 데이터 조회
     */
    public Page<CollectedData> findBySourceId(Long sourceId, Pageable pageable) {
        return collectedDataRepository.findBySourceId(sourceId, pageable);
    }

    /**
     * 데이터 처리 완료로 마킹
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
     * 전체 수집 건수 카운트
     */
    public long countTotal() {
        return collectedDataRepository.count();
    }

    /**
     * 미처리 건수 카운트
     */
    public long countUnprocessed() {
        return collectedDataRepository.countByProcessedFalse();
    }

    /**
     * QA 지표 기반 품질 점수 계산
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
     * URL 도메인 기반 신뢰도 점수 계산
     * Uses externalized trust score configuration.
     */
    public double calculateTrustScore(String url, Boolean httpOk, boolean inWhitelist) {
        TrustScoreConfig.DataQuality dq = trustScoreConfig.getDataQuality();
        double base = inWhitelist ? dq.getWhitelistScore() : dq.getBaseScore();
        if (Boolean.TRUE.equals(httpOk)) {
            base += dq.getHttpOkBonus();
        }
        return Math.max(0.0, Math.min(1.0, base));
    }
}
