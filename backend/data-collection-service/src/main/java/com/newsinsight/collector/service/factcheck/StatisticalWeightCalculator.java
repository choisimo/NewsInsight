package com.newsinsight.collector.service.factcheck;

import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 통계적 가중치 계산기
 * 
 * 수집된 데이터의 특성(시의성, 품질, 다양성 등)을 분석하여
 * 각 소스의 동적 가중치를 계산합니다.
 * 
 * 주요 기능:
 * 1. 시의성(Recency) 분석 - 최신 데이터일수록 높은 점수
 * 2. 품질(Quality) 분석 - 관련성 점수, 내용 길이 등
 * 3. 다양성(Diversity) 분석 - 여러 소스에서 교차 검증
 * 4. 동적 가중치 조정 - 데이터 특성에 따라 실시간 조정
 */
@Component
@Slf4j
public class StatisticalWeightCalculator {

    // 기본 소스 가중치 (베이스라인)
    private static final Map<String, Double> BASE_WEIGHTS = Map.ofEntries(
            Map.entry("realtime_search", 1.2),      // 실시간 검색 (Perplexity)
            Map.entry("naver_news", 1.1),           // 뉴스 (시의성 중요)
            Map.entry("wikipedia", 1.0),            // 백과사전 (기본)
            Map.entry("academic", 1.3),             // 학술 자료 (신뢰도 높음)
            Map.entry("semantic_scholar", 1.3),     // 학술 검색
            Map.entry("crossref", 1.25),            // 학술 DB
            Map.entry("pubmed", 1.3),               // 의학 논문
            Map.entry("openalex", 1.25),            // 학술 DB
            Map.entry("core", 1.2),                 // 학술 자료
            Map.entry("google_factcheck", 1.15),    // 팩트체크
            Map.entry("news", 1.1)                  // 일반 뉴스
    );

    // 시의성 가중치 (시간에 따른 감쇠)
    private static final double RECENCY_WEIGHT = 0.3;
    // 품질 가중치
    private static final double QUALITY_WEIGHT = 0.4;
    // 다양성 가중치
    private static final double DIVERSITY_WEIGHT = 0.3;

    /**
     * 소스별 증거 리스트를 분석하여 동적 가중치 맵 생성
     * 
     * @param evidencesBySource 소스별로 그룹화된 증거 목록
     * @return 소스별 동적 가중치 맵
     */
    public Map<String, Double> calculateSourceWeights(Map<String, List<SourceEvidence>> evidencesBySource) {
        if (evidencesBySource == null || evidencesBySource.isEmpty()) {
            return new HashMap<>(BASE_WEIGHTS);
        }

        Map<String, Double> weights = new HashMap<>();
        
        // 1. 각 소스의 시의성, 품질, 다양성 점수 계산
        Map<String, SourceMetrics> metricsMap = new HashMap<>();
        
        for (Map.Entry<String, List<SourceEvidence>> entry : evidencesBySource.entrySet()) {
            String sourceType = entry.getKey();
            List<SourceEvidence> evidences = entry.getValue();
            
            if (evidences == null || evidences.isEmpty()) {
                continue;
            }
            
            SourceMetrics metrics = calculateSourceMetrics(evidences);
            metricsMap.put(sourceType, metrics);
        }
        
        // 2. 전체 평균 계산 (정규화용)
        double avgRecency = metricsMap.values().stream()
                .mapToDouble(SourceMetrics::getRecencyScore)
                .average()
                .orElse(0.5);
        
        double avgQuality = metricsMap.values().stream()
                .mapToDouble(SourceMetrics::getQualityScore)
                .average()
                .orElse(0.5);
        
        // 3. 각 소스의 최종 가중치 계산
        for (Map.Entry<String, SourceMetrics> entry : metricsMap.entrySet()) {
            String sourceType = entry.getKey();
            SourceMetrics metrics = entry.getValue();
            
            // 기본 가중치
            double baseWeight = BASE_WEIGHTS.getOrDefault(sourceType, 1.0);
            
            // 시의성 보너스/페널티 (평균 대비)
            double recencyFactor = 1.0;
            if (avgRecency > 0) {
                recencyFactor = 1.0 + (metrics.getRecencyScore() - avgRecency) * RECENCY_WEIGHT;
            }
            
            // 품질 보너스/페널티
            double qualityFactor = 1.0;
            if (avgQuality > 0) {
                qualityFactor = 1.0 + (metrics.getQualityScore() - avgQuality) * QUALITY_WEIGHT;
            }
            
            // 다양성 보너스 (여러 소스에서 교차 검증된 경우)
            double diversityFactor = 1.0 + metrics.getDiversityScore() * DIVERSITY_WEIGHT;
            
            // 최종 가중치 = 기본 가중치 × 시의성 × 품질 × 다양성
            double finalWeight = baseWeight * recencyFactor * qualityFactor * diversityFactor;
            
            // 가중치 범위 제한 (0.5 ~ 2.0)
            finalWeight = Math.max(0.5, Math.min(2.0, finalWeight));
            
            weights.put(sourceType, finalWeight);
            
            log.debug("Source '{}': base={}, recency={}, quality={}, diversity={} → final={}",
                    sourceType, baseWeight, recencyFactor, qualityFactor, diversityFactor, finalWeight);
        }
        
        // 4. 가중치가 없는 소스는 기본값 사용
        for (String sourceType : evidencesBySource.keySet()) {
            if (!weights.containsKey(sourceType)) {
                weights.put(sourceType, BASE_WEIGHTS.getOrDefault(sourceType, 1.0));
            }
        }
        
        log.info("Calculated dynamic weights for {} sources: {}", weights.size(), weights);
        
        return weights;
    }

    /**
     * 소스별 메트릭 계산
     */
    private SourceMetrics calculateSourceMetrics(List<SourceEvidence> evidences) {
        double recencyScore = calculateRecencyScore(evidences);
        double qualityScore = calculateQualityScore(evidences);
        double diversityScore = calculateDiversityScore(evidences);
        
        return new SourceMetrics(recencyScore, qualityScore, diversityScore);
    }

    /**
     * 시의성 점수 계산
     * 
     * 최근 데이터일수록 높은 점수 (시간 감쇠 함수 사용)
     */
    private double calculateRecencyScore(List<SourceEvidence> evidences) {
        if (evidences == null || evidences.isEmpty()) {
            return 0.0;
        }

        LocalDateTime now = LocalDateTime.now();
        List<Double> scores = new ArrayList<>();
        
        for (SourceEvidence evidence : evidences) {
            // 증거에서 날짜 정보 추출 시도
            LocalDateTime publishedDate = extractPublishedDate(evidence);
            
            if (publishedDate != null) {
                // 경과 시간 계산 (시간 단위)
                long hoursAgo = Duration.between(publishedDate, now).toHours();
                
                // 시간 감쇠 함수: 1 / (1 + hours/24)
                // 24시간 이내: 0.5~1.0, 1주일: ~0.2, 1개월: ~0.1
                double score = 1.0 / (1.0 + hoursAgo / 24.0);
                scores.add(score);
            }
        }
        
        // 평균 시의성 점수
        return scores.isEmpty() ? 0.5 : scores.stream()
                .mapToDouble(Double::doubleValue)
                .average()
                .orElse(0.5);
    }

    /**
     * 품질 점수 계산
     * 
     * 관련성 점수, 내용 길이, 출처 신뢰도 등을 종합
     */
    private double calculateQualityScore(List<SourceEvidence> evidences) {
        if (evidences == null || evidences.isEmpty()) {
            return 0.0;
        }

        return evidences.stream()
                .mapToDouble(evidence -> {
                    double score = 0.0;
                    
                    // 1. 관련성 점수 (가장 중요)
                    if (evidence.getRelevanceScore() != null) {
                        score += evidence.getRelevanceScore() * 0.6;
                    }
                    
                    // 2. 내용 길이 (적절한 길이일수록 높은 점수)
                    if (evidence.getExcerpt() != null) {
                        int length = evidence.getExcerpt().length();
                        // 100~1000자 사이가 이상적
                        if (length >= 100 && length <= 1000) {
                            score += 0.2;
                        } else if (length > 50 && length < 2000) {
                            score += 0.1;
                        }
                    }
                    
                    // 3. URL 존재 여부 (출처 확인 가능)
                    if (evidence.getUrl() != null && !evidence.getUrl().isBlank()) {
                        score += 0.1;
                    }
                    
                    // 4. 소스 이름 존재 여부
                    if (evidence.getSourceName() != null && !evidence.getSourceName().isBlank()) {
                        score += 0.1;
                    }
                    
                    return Math.min(1.0, score);
                })
                .average()
                .orElse(0.5);
    }

    /**
     * 다양성 점수 계산
     * 
     * 여러 소스에서 유사한 정보가 교차 검증되는 경우 높은 점수
     */
    private double calculateDiversityScore(List<SourceEvidence> evidences) {
        if (evidences == null || evidences.size() <= 1) {
            return 0.0;
        }

        // URL 중복도 체크
        Set<String> uniqueUrls = evidences.stream()
                .map(SourceEvidence::getUrl)
                .filter(url -> url != null && !url.isBlank())
                .collect(Collectors.toSet());
        
        // 고유 URL 비율 (중복이 적을수록 다양성 높음)
        double urlDiversity = uniqueUrls.isEmpty() ? 0.0 : 
                (double) uniqueUrls.size() / evidences.size();
        
        // 다양성 점수: 0.0 ~ 1.0
        return Math.min(1.0, urlDiversity);
    }

    /**
     * 증거에서 발행 날짜 추출
     * 
     * excerpt나 sourceName에서 날짜 정보를 파싱 시도
     */
    private LocalDateTime extractPublishedDate(SourceEvidence evidence) {
        if (evidence == null) {
            return null;
        }

        // 1. excerpt에서 날짜 패턴 찾기
        String excerpt = evidence.getExcerpt();
        if (excerpt != null) {
            // "2024-12-22", "2024년 12월 22일" 등의 패턴
            LocalDateTime date = tryParseDateFromText(excerpt);
            if (date != null) {
                return date;
            }
        }

        // 2. 실시간 검색 결과는 현재 시간으로 간주
        if ("realtime_search".equals(evidence.getSourceType()) || 
            "realtime_search_citation".equals(evidence.getSourceType())) {
            return LocalDateTime.now();
        }

        // 3. 뉴스는 최근 데이터로 간주 (1일 전)
        if ("news".equals(evidence.getSourceType()) || 
            evidence.getSourceName() != null && evidence.getSourceName().contains("뉴스")) {
            return LocalDateTime.now().minusDays(1);
        }

        // 4. 학술 자료는 오래된 데이터로 간주 (1년 전)
        if ("academic".equals(evidence.getSourceType())) {
            return LocalDateTime.now().minusYears(1);
        }

        // 5. 기본값: 1주일 전
        return LocalDateTime.now().minusWeeks(1);
    }

    /**
     * 텍스트에서 날짜 파싱 시도
     */
    private LocalDateTime tryParseDateFromText(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }

        // ISO 날짜 형식: 2024-12-22
        try {
            if (text.matches(".*\\d{4}-\\d{2}-\\d{2}.*")) {
                String dateStr = text.replaceAll(".*(\\d{4}-\\d{2}-\\d{2}).*", "$1");
                return LocalDateTime.parse(dateStr + "T00:00:00");
            }
        } catch (DateTimeParseException ignored) {}

        // 한국어 날짜 형식: 2024년 12월 22일
        try {
            if (text.matches(".*\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일.*")) {
                String dateStr = text.replaceAll(".*(\\d{4})년\\s*(\\d{1,2})월\\s*(\\d{1,2})일.*", "$1-$2-$3");
                return LocalDateTime.parse(dateStr + "T00:00:00");
            }
        } catch (DateTimeParseException ignored) {}

        return null;
    }

    /**
     * 소스 메트릭 내부 클래스
     */
    private static class SourceMetrics {
        private final double recencyScore;
        private final double qualityScore;
        private final double diversityScore;

        public SourceMetrics(double recencyScore, double qualityScore, double diversityScore) {
            this.recencyScore = recencyScore;
            this.qualityScore = qualityScore;
            this.diversityScore = diversityScore;
        }

        public double getRecencyScore() {
            return recencyScore;
        }

        public double getQualityScore() {
            return qualityScore;
        }

        public double getDiversityScore() {
            return diversityScore;
        }
    }
}
