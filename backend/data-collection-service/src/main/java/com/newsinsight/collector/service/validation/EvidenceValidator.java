package com.newsinsight.collector.service.validation;

import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import com.newsinsight.collector.service.validation.UrlLivenessValidator.ValidationResult;
import com.newsinsight.collector.service.validation.UrlLivenessValidator.ContentValidationResult;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 증거(Evidence) 유효성 검증 서비스
 * 
 * RRF 알고리즘과 연동하여 수집된 증거의 품질을 검증합니다.
 * 
 * 주요 기능:
 * 1. URL 실존 여부 검증 (UrlLivenessValidator 활용)
 * 2. 콘텐츠 유효성 검증 (삭제 페이지, 에러 페이지 필터링)
 * 3. LLM 환각(Hallucination) 필터링
 * 4. 검증된 증거만 RRF 파이프라인에 전달
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EvidenceValidator {

    private final UrlLivenessValidator urlLivenessValidator;

    @Value("${collector.evidence-validation.enabled:true}")
    private boolean validationEnabled;

    @Value("${collector.evidence-validation.strict-mode:false}")
    private boolean strictMode;

    @Value("${collector.evidence-validation.min-content-length:50}")
    private int minContentLength;

    /**
     * 단일 증거 검증
     */
    public Mono<EvidenceValidationResult> validateEvidence(SourceEvidence evidence) {
        if (!validationEnabled) {
            return Mono.just(EvidenceValidationResult.builder()
                    .evidence(evidence)
                    .isValid(true)
                    .build());
        }

        if (evidence == null) {
            return Mono.just(EvidenceValidationResult.builder()
                    .isValid(false)
                    .failureReason("Evidence is null")
                    .build());
        }

        String url = evidence.getUrl();
        String content = evidence.getExcerpt();

        // 1. URL 검증
        Mono<ValidationResult> urlValidation;
        if (url != null && !url.isBlank()) {
            urlValidation = urlLivenessValidator.validateUrl(url);
        } else {
            // URL이 없는 경우 - strict mode에서는 실패
            urlValidation = Mono.just(ValidationResult.builder()
                    .url(url)
                    .isValid(!strictMode) // strict mode가 아니면 허용
                    .isAccessible(false)
                    .failureReason("No URL provided")
                    .build());
        }

        return urlValidation.map(urlResult -> {
            // 2. 콘텐츠 검증
            ContentValidationResult contentResult = urlLivenessValidator.validateContent(url, content);

            // 3. 종합 판정
            boolean isUrlValid = urlResult.isValid() || urlResult.isTrustedDomain();
            boolean isContentValid = contentResult.isValid();
            boolean isHallucination = urlResult.isHallucination();

            // 최종 유효성: URL과 콘텐츠 모두 유효해야 함
            boolean isValid;
            String failureReason = null;

            if (isHallucination) {
                isValid = false;
                failureReason = "URL is likely LLM hallucination";
            } else if (strictMode) {
                isValid = isUrlValid && isContentValid;
                if (!isUrlValid) {
                    failureReason = urlResult.getFailureReason();
                } else if (!isContentValid) {
                    failureReason = contentResult.getFailureReason();
                }
            } else {
                // 완화 모드: URL 또는 콘텐츠 중 하나만 유효해도 통과
                isValid = isUrlValid || isContentValid;
                if (!isValid) {
                    failureReason = "Both URL and content validation failed";
                }
            }

            // 신뢰도 점수 조정
            double adjustedRelevance = calculateAdjustedRelevance(
                    evidence.getRelevanceScore(),
                    urlResult,
                    contentResult
            );

            return EvidenceValidationResult.builder()
                    .evidence(evidence)
                    .isValid(isValid)
                    .isUrlValid(isUrlValid)
                    .isContentValid(isContentValid)
                    .isHallucination(isHallucination)
                    .isTrustedSource(urlResult.isTrustedDomain())
                    .urlValidation(urlResult)
                    .contentValidation(contentResult)
                    .adjustedRelevanceScore(adjustedRelevance)
                    .failureReason(failureReason)
                    .build();
        });
    }

    /**
     * 다중 증거 병렬 검증
     */
    public Flux<EvidenceValidationResult> validateEvidences(List<SourceEvidence> evidences) {
        if (evidences == null || evidences.isEmpty()) {
            return Flux.empty();
        }

        return Flux.fromIterable(evidences)
                .flatMap(this::validateEvidence, 10); // 동시성 10개 제한
    }

    /**
     * 증거 목록에서 유효한 증거만 필터링 (RRF 파이프라인용)
     */
    public Mono<List<SourceEvidence>> filterValidEvidences(List<SourceEvidence> evidences) {
        if (!validationEnabled) {
            return Mono.just(new ArrayList<>(evidences));
        }

        return validateEvidences(evidences)
                .filter(EvidenceValidationResult::isValid)
                .map(result -> {
                    // 조정된 관련성 점수 적용
                    SourceEvidence evidence = result.getEvidence();
                    if (result.getAdjustedRelevanceScore() != null) {
                        evidence.setRelevanceScore(result.getAdjustedRelevanceScore());
                    }
                    return evidence;
                })
                .collectList()
                .doOnNext(validEvidences -> {
                    int filtered = evidences.size() - validEvidences.size();
                    if (filtered > 0) {
                        log.info("Evidence validation: {} valid, {} filtered out of {} total",
                                validEvidences.size(), filtered, evidences.size());
                    }
                });
    }

    /**
     * 증거 목록 검증 및 상세 보고서 생성
     */
    public Mono<ValidationReport> generateValidationReport(List<SourceEvidence> evidences) {
        return validateEvidences(evidences)
                .collectList()
                .map(results -> {
                    int total = results.size();
                    int valid = (int) results.stream().filter(EvidenceValidationResult::isValid).count();
                    int urlInvalid = (int) results.stream().filter(r -> !r.isUrlValid()).count();
                    int contentInvalid = (int) results.stream().filter(r -> !r.isContentValid()).count();
                    int hallucinations = (int) results.stream().filter(EvidenceValidationResult::isHallucination).count();
                    int trustedSources = (int) results.stream().filter(EvidenceValidationResult::isTrustedSource).count();

                    // 실패 이유별 그룹화
                    Map<String, Long> failureReasons = results.stream()
                            .filter(r -> !r.isValid())
                            .filter(r -> r.getFailureReason() != null)
                            .collect(Collectors.groupingBy(
                                    EvidenceValidationResult::getFailureReason,
                                    Collectors.counting()
                            ));

                    return ValidationReport.builder()
                            .totalEvidences(total)
                            .validEvidences(valid)
                            .invalidEvidences(total - valid)
                            .urlValidationFailures(urlInvalid)
                            .contentValidationFailures(contentInvalid)
                            .hallucinationDetections(hallucinations)
                            .trustedSourceCount(trustedSources)
                            .validationRate(total > 0 ? (double) valid / total : 0.0)
                            .failureReasonCounts(failureReasons)
                            .validEvidenceList(results.stream()
                                    .filter(EvidenceValidationResult::isValid)
                                    .map(EvidenceValidationResult::getEvidence)
                                    .toList())
                            .build();
                });
    }

    /**
     * 검증 결과에 따른 관련성 점수 조정
     */
    private double calculateAdjustedRelevance(
            Double originalScore,
            ValidationResult urlResult,
            ContentValidationResult contentResult) {
        
        double base = originalScore != null ? originalScore : 0.5;

        // 신뢰할 수 있는 도메인: 보너스
        if (urlResult.isTrustedDomain()) {
            base = Math.min(1.0, base + 0.1);
        }

        // URL 접근 불가: 페널티
        if (!urlResult.isAccessible() && !urlResult.isTrustedDomain()) {
            base = base * 0.7;
        }

        // 콘텐츠 유효성 검증 실패: 페널티
        if (!contentResult.isValid()) {
            base = base * 0.5;
        }

        // 환각 의심: 대폭 감점
        if (urlResult.isHallucination()) {
            base = base * 0.1;
        }

        // 응답 시간이 너무 긴 경우: 약간 감점
        if (urlResult.getResponseTimeMs() > 3000) {
            base = base * 0.95;
        }

        return Math.max(0.0, Math.min(1.0, base));
    }

    /**
     * 증거 검증 결과
     */
    @Data
    @Builder
    public static class EvidenceValidationResult {
        private SourceEvidence evidence;
        private boolean isValid;
        private boolean isUrlValid;
        private boolean isContentValid;
        private boolean isHallucination;
        private boolean isTrustedSource;
        private ValidationResult urlValidation;
        private ContentValidationResult contentValidation;
        private Double adjustedRelevanceScore;
        private String failureReason;
    }

    /**
     * 검증 보고서
     */
    @Data
    @Builder
    public static class ValidationReport {
        private int totalEvidences;
        private int validEvidences;
        private int invalidEvidences;
        private int urlValidationFailures;
        private int contentValidationFailures;
        private int hallucinationDetections;
        private int trustedSourceCount;
        private double validationRate;
        private Map<String, Long> failureReasonCounts;
        private List<SourceEvidence> validEvidenceList;
    }

    /**
     * 설정 정보 조회
     */
    public Map<String, Object> getConfiguration() {
        return Map.of(
                "validationEnabled", validationEnabled,
                "strictMode", strictMode,
                "minContentLength", minContentLength,
                "urlValidatorCacheStats", urlLivenessValidator.getCacheStats()
        );
    }
}
