package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.addon.AddonRequest;
import com.newsinsight.collector.dto.addon.AddonResponse;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.entity.addon.*;
import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import com.newsinsight.collector.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/**
 * ML Add-on Orchestrator Service.
 * 
 * 기사 분석 요청을 받아 등록된 Add-on들에게 분배하고,
 * 결과를 수집하여 ArticleAnalysis/ArticleDiscussion에 저장.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AddonOrchestratorService {

    private final MlAddonRepository addonRepository;
    private final MlAddonExecutionRepository executionRepository;
    private final ArticleAnalysisRepository analysisRepository;
    private final ArticleDiscussionRepository discussionRepository;
    private final CollectedDataRepository collectedDataRepository;
    private final WebClient.Builder webClientBuilder;
    private final AnalysisEventService analysisEventService;

    /**
     * 단일 기사에 대해 모든 활성화된 Add-on 실행.
     * 
     * @param articleId 분석할 기사 ID
     * @param importance 중요도 (realtime / batch)
     * @return 배치 ID
     */
    @Async
    public CompletableFuture<String> analyzeArticle(Long articleId, String importance) {
        String batchId = UUID.randomUUID().toString();
        log.info("Starting article analysis: articleId={}, batchId={}, importance={}", articleId, batchId, importance);

        // 기사 조회
        CollectedData article = collectedDataRepository.findById(articleId)
                .orElseThrow(() -> new IllegalArgumentException("Article not found: " + articleId));

        // 활성화된 Add-on 목록 조회 (우선순위 순)
        List<MlAddon> addons = addonRepository.findByEnabledTrueOrderByPriorityAsc();
        
        if (addons.isEmpty()) {
            log.warn("No enabled Add-ons found");
            return CompletableFuture.completedFuture(batchId);
        }

        // 의존성 없는 Add-on들은 병렬 실행, 의존성 있는 것들은 순차 실행
        Map<String, AddonResponse> results = new HashMap<>();
        List<MlAddon> pendingAddons = new ArrayList<>(addons);

        while (!pendingAddons.isEmpty()) {
            // 현재 실행 가능한 Add-on 찾기 (의존성이 모두 충족된 것들)
            List<MlAddon> readyAddons = pendingAddons.stream()
                    .filter(addon -> areDependenciesSatisfied(addon, results.keySet()))
                    .collect(Collectors.toList());

            if (readyAddons.isEmpty() && !pendingAddons.isEmpty()) {
                log.warn("Circular dependency or missing addon detected. Remaining: {}", 
                        pendingAddons.stream().map(MlAddon::getAddonKey).collect(Collectors.toList()));
                break;
            }

            // 병렬 실행
            List<CompletableFuture<AddonResponse>> futures = readyAddons.stream()
                    .map(addon -> executeAddon(addon, article, batchId, importance, results))
                    .collect(Collectors.toList());

            // 모든 실행 완료 대기
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

            // 결과 수집
            for (int i = 0; i < readyAddons.size(); i++) {
                MlAddon addon = readyAddons.get(i);
                try {
                    AddonResponse response = futures.get(i).get();
                    if (response != null && "success".equals(response.getStatus())) {
                        results.put(addon.getAddonKey(), response);
                    }
                } catch (Exception e) {
                    log.error("Failed to get result for addon: {}", addon.getAddonKey(), e);
                }
            }

            pendingAddons.removeAll(readyAddons);
        }

        // 결과를 ArticleAnalysis에 저장
        saveAnalysisResults(articleId, results);

        saveDiscussionResults(articleId, results);

        log.info("Article analysis completed: articleId={}, batchId={}, addonsExecuted={}", 
                articleId, batchId, results.size());

        return CompletableFuture.completedFuture(batchId);
    }

    @Transactional
    public void saveDiscussionResults(Long articleId, Map<String, AddonResponse> results) {
        ArticleDiscussion discussion = discussionRepository.findByArticleId(articleId)
                .orElse(ArticleDiscussion.builder().articleId(articleId).build());

        List<String> analyzedBy = discussion.getAnalyzedBy() != null
                ? new ArrayList<>(discussion.getAnalyzedBy())
                : new ArrayList<>();

        boolean updated = false;

        for (Map.Entry<String, AddonResponse> entry : results.entrySet()) {
            String addonKey = entry.getKey();
            AddonResponse response = entry.getValue();

            if (response == null || response.getResults() == null) continue;

            AddonResponse.AnalysisResults r = response.getResults();
            if (r.getDiscussion() == null) continue;

            AddonResponse.DiscussionResult d = r.getDiscussion();

            if (d.getOverallSentiment() != null) discussion.setOverallSentiment(d.getOverallSentiment());
            if (d.getSentimentDistribution() != null) discussion.setSentimentDistribution(d.getSentimentDistribution());
            if (d.getStanceDistribution() != null) discussion.setStanceDistribution(d.getStanceDistribution());
            if (d.getToxicityScore() != null) discussion.setToxicityScore(d.getToxicityScore());
            if (d.getTopKeywords() != null) discussion.setTopKeywords(d.getTopKeywords());
            if (d.getTimeSeries() != null) discussion.setTimeSeries(d.getTimeSeries());

            if (d.getBotLikelihood() != null) {
                discussion.setBotLikelihoodScore(d.getBotLikelihood());
                discussion.setSuspiciousPatternDetected(d.getBotLikelihood() >= 0.7);
            }

            if (r.getRaw() != null) {
                Object totalObj = r.getRaw().get("total");
                if (totalObj instanceof Number n) {
                    discussion.setTotalCommentCount(n.intValue());
                    discussion.setAnalyzedCount(n.intValue());
                }

                Object reasonsObj = r.getRaw().get("detection_reasons");
                if (reasonsObj instanceof List<?> list) {
                    List<String> reasons = list.stream()
                            .filter(Objects::nonNull)
                            .map(Object::toString)
                            .collect(Collectors.toList());
                    discussion.setSuspiciousPatterns(reasons);
                }
            }

            analyzedBy.add(addonKey);
            updated = true;
        }

        if (!updated) return;

        discussion.setAnalyzedBy(analyzedBy.stream().distinct().collect(Collectors.toList()));
        ArticleDiscussion savedDiscussion = discussionRepository.save(discussion);

        analysisEventService.publishDiscussionComplete(articleId, savedDiscussion);
    }

    /**
     * 여러 기사 일괄 분석.
     */
    @Async
    public CompletableFuture<String> analyzeArticles(List<Long> articleIds, String importance) {
        String batchId = UUID.randomUUID().toString();
        log.info("Starting batch analysis: articleCount={}, batchId={}", articleIds.size(), batchId);

        for (Long articleId : articleIds) {
            try {
                analyzeArticle(articleId, importance).join();
            } catch (Exception e) {
                log.error("Failed to analyze article: {}", articleId, e);
            }
        }

        return CompletableFuture.completedFuture(batchId);
    }

    /**
     * 특정 카테고리의 Add-on만 실행.
     */
    @Async
    public CompletableFuture<AddonResponse> executeCategory(Long articleId, AddonCategory category) {
        List<MlAddon> addons = addonRepository.findByCategoryAndEnabledTrue(category);
        if (addons.isEmpty()) {
            log.warn("No enabled addon found for category: {}", category);
            return CompletableFuture.completedFuture(null);
        }

        CollectedData article = collectedDataRepository.findById(articleId)
                .orElseThrow(() -> new IllegalArgumentException("Article not found: " + articleId));

        // 첫 번째 활성화된 Add-on 실행
        MlAddon addon = addons.get(0);
        return executeAddon(addon, article, UUID.randomUUID().toString(), "batch", new HashMap<>());
    }

    /**
     * 개별 Add-on 실행.
     */
    private CompletableFuture<AddonResponse> executeAddon(
            MlAddon addon,
            CollectedData article,
            String batchId,
            String importance,
            Map<String, AddonResponse> previousResults
    ) {
        String requestId = UUID.randomUUID().toString();

        // 실행 기록 생성
        MlAddonExecution execution = MlAddonExecution.builder()
                .requestId(requestId)
                .batchId(batchId)
                .addon(addon)
                .articleId(article.getId())
                .importance(importance)
                .status(ExecutionStatus.PENDING)
                .build();
        executionRepository.save(execution);

        // 요청 페이로드 생성
        AddonRequest request = buildRequest(requestId, addon, article, previousResults, importance);

        // 실행 시작
        execution.markStarted();
        executionRepository.save(execution);

        // SSE 이벤트 발행: 분석 시작
        analysisEventService.publishAnalysisStarted(article.getId(), addon.getAddonKey());

        // Add-on 호출
        return callAddon(addon, request)
                .map(response -> {
                    // 성공 처리
                    execution.markSuccess(
                            response.getResults() != null ? Map.of("results", response.getResults()) : null,
                            response.getMeta() != null ? response.getMeta().getModelVersion() : null
                    );
                    addon.incrementSuccess(execution.getLatencyMs());
                    executionRepository.save(execution);
                    addonRepository.save(addon);

                    // SSE 이벤트 발행: 부분 결과
                    if (response.getResults() != null) {
                        Map<String, Object> partialResult = new HashMap<>();
                        AddonResponse.AnalysisResults r = response.getResults();
                        if (r.getSentiment() != null) {
                            partialResult.put("sentimentLabel", r.getSentiment().getLabel());
                            partialResult.put("sentimentScore", r.getSentiment().getScore());
                        }
                        if (r.getReliability() != null) {
                            partialResult.put("reliabilityScore", r.getReliability().getScore());
                            partialResult.put("reliabilityGrade", r.getReliability().getGrade());
                        }
                        if (r.getBias() != null) {
                            partialResult.put("biasLabel", r.getBias().getLabel());
                            partialResult.put("biasScore", r.getBias().getScore());
                        }
                        analysisEventService.publishPartialResult(article.getId(), addon.getAddonKey(), partialResult);
                    }

                    return response;
                })
                .onErrorResume(error -> {
                    // 실패 처리
                    execution.markFailed("EXECUTION_ERROR", error.getMessage());
                    addon.incrementFailure();
                    executionRepository.save(execution);
                    addonRepository.save(addon);
                    log.error("Addon execution failed: addon={}, error={}", addon.getAddonKey(), error.getMessage());

                    // SSE 이벤트 발행: 에러
                    analysisEventService.publishAnalysisError(article.getId(), addon.getAddonKey(), error.getMessage());

                    return Mono.empty();
                })
                .toFuture();
    }

    /**
     * Add-on HTTP 호출.
     */
    private Mono<AddonResponse> callAddon(MlAddon addon, AddonRequest request) {
        if (!addon.isHttpBased()) {
            log.warn("Non-HTTP addon not yet supported: {}", addon.getInvokeType());
            return Mono.empty();
        }

        WebClient client = webClientBuilder.build();
        
        return client.post()
                .uri(addon.getEndpointUrl())
                .contentType(MediaType.APPLICATION_JSON)
                .headers(headers -> {
                    // 인증 헤더 추가
                    if (addon.getAuthType() == AddonAuthType.API_KEY && addon.getAuthCredentials() != null) {
                        headers.set("X-API-Key", addon.getAuthCredentials());
                    } else if (addon.getAuthType() == AddonAuthType.BEARER_TOKEN && addon.getAuthCredentials() != null) {
                        headers.setBearerAuth(addon.getAuthCredentials());
                    }
                })
                .bodyValue(request)
                .retrieve()
                .bodyToMono(AddonResponse.class)
                .timeout(Duration.ofMillis(addon.getTimeoutMs()))
                .doOnSubscribe(s -> log.debug("Calling addon: {} at {}", addon.getAddonKey(), addon.getEndpointUrl()))
                .doOnSuccess(r -> log.debug("Addon response received: {}", addon.getAddonKey()));
    }

    /**
     * 요청 페이로드 생성.
     */
    private AddonRequest buildRequest(
            String requestId,
            MlAddon addon,
            CollectedData article,
            Map<String, AddonResponse> previousResults,
            String importance
    ) {
        return AddonRequest.builder()
                .requestId(requestId)
                .addonId(addon.getAddonKey())
                .task("article_analysis")
                .inputSchemaVersion(addon.getInputSchemaVersion())
                .article(AddonRequest.ArticleInput.builder()
                        .id(article.getId())
                        .title(article.getTitle())
                        .content(article.getContent())
                        .url(article.getUrl())
                        .publishedAt(article.getPublishedDate() != null ? article.getPublishedDate().toString() : null)
                        .build())
                .context(AddonRequest.AnalysisContext.builder()
                        .language("ko")
                        .country("KR")
                        .previousResults(previousResults.entrySet().stream()
                                .collect(Collectors.toMap(
                                        Map.Entry::getKey,
                                        e -> e.getValue().getResults()
                                )))
                        .build())
                .options(AddonRequest.ExecutionOptions.builder()
                        .importance(importance)
                        .timeoutMs(addon.getTimeoutMs())
                        .build())
                .build();
    }

    /**
     * 의존성 충족 여부 확인.
     */
    private boolean areDependenciesSatisfied(MlAddon addon, Set<String> completedAddons) {
        if (addon.getDependsOn() == null || addon.getDependsOn().isEmpty()) {
            return true;
        }
        return completedAddons.containsAll(addon.getDependsOn());
    }

    /**
     * 분석 결과를 ArticleAnalysis에 저장.
     */
    @Transactional
    public void saveAnalysisResults(Long articleId, Map<String, AddonResponse> results) {
        ArticleAnalysis analysis = analysisRepository.findByArticleId(articleId)
                .orElse(ArticleAnalysis.builder().articleId(articleId).build());

        List<String> analyzedBy = new ArrayList<>();
        Map<String, Boolean> analysisStatus = new HashMap<>();

        for (Map.Entry<String, AddonResponse> entry : results.entrySet()) {
            String addonKey = entry.getKey();
            AddonResponse response = entry.getValue();
            
            if (response == null || response.getResults() == null) continue;

            analyzedBy.add(addonKey);
            analysisStatus.put(addonKey, true);

            AddonResponse.AnalysisResults r = response.getResults();

            // 감정 분석 결과 저장
            if (r.getSentiment() != null) {
                analysis.setSentimentScore(r.getSentiment().getScore());
                analysis.setSentimentLabel(r.getSentiment().getLabel());
                analysis.setSentimentDistribution(r.getSentiment().getDistribution());
            }

            // 신뢰도 결과 저장
            if (r.getReliability() != null) {
                analysis.setReliabilityScore(r.getReliability().getScore());
                analysis.setReliabilityGrade(r.getReliability().getGrade());
                analysis.setReliabilityFactors(r.getReliability().getFactors());
            }

            // 편향도 결과 저장
            if (r.getBias() != null) {
                analysis.setBiasLabel(r.getBias().getLabel());
                analysis.setBiasScore(r.getBias().getScore());
                analysis.setBiasDetails(r.getBias().getDetails());
            }

            // 팩트체크 결과 저장
            if (r.getFactcheck() != null) {
                analysis.setFactcheckStatus(r.getFactcheck().getStatus());
                analysis.setFactcheckNotes(r.getFactcheck().getNotes());
            }

            // 요약 결과 저장
            if (r.getSummary() != null) {
                analysis.setSummary(r.getSummary().getAbstractiveSummary());
                analysis.setKeySentences(r.getSummary().getExtractiveSentences());
            }

            // 주제 분류 결과 저장
            if (r.getTopics() != null) {
                analysis.setTopics(r.getTopics().getLabels());
                analysis.setTopicScores(r.getTopics().getScores());
            }

            // 허위정보 결과 저장
            if (r.getMisinformation() != null) {
                analysis.setMisinfoRisk(r.getMisinformation().getRiskLevel());
                analysis.setMisinfoScore(r.getMisinformation().getScore());
            }

            // 독성 분석 결과 저장
            if (r.getToxicity() != null) {
                analysis.setToxicityScore(r.getToxicity().getScore());
            }
        }

        analysis.setAnalyzedBy(analyzedBy);
        analysis.setAnalysisStatus(analysisStatus);
        analysis.setFullyAnalyzed(!results.isEmpty());

        ArticleAnalysis savedAnalysis = analysisRepository.save(analysis);
        log.info("Saved analysis results for article: {}, addons: {}", articleId, analyzedBy);

        // SSE 이벤트 발행: 분석 완료
        analysisEventService.publishAnalysisComplete(articleId, savedAnalysis);
    }

    /**
     * Add-on 헬스체크 실행.
     */
    @Async
    public void runHealthChecks() {
        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(5);
        List<MlAddon> addons = addonRepository.findAddonsNeedingHealthCheck(cutoff);

        for (MlAddon addon : addons) {
            try {
                WebClient client = webClientBuilder.build();
                client.get()
                        .uri(addon.getHealthCheckUrl())
                        .retrieve()
                        .toBodilessEntity()
                        .timeout(Duration.ofSeconds(10))
                        .subscribe(
                                response -> {
                                    addonRepository.updateHealthStatus(addon.getId(), AddonHealthStatus.HEALTHY, LocalDateTime.now());
                                    log.debug("Health check passed: {}", addon.getAddonKey());
                                },
                                error -> {
                                    addonRepository.updateHealthStatus(addon.getId(), AddonHealthStatus.UNHEALTHY, LocalDateTime.now());
                                    log.warn("Health check failed: {}", addon.getAddonKey());
                                }
                        );
            } catch (Exception e) {
                log.error("Health check error for addon: {}", addon.getAddonKey(), e);
            }
        }
    }

    /**
     * 특정 Add-on으로 직접 분석 실행 (커스텀 입력, 기사 ID 없이).
     * 프론트엔드에서 직접 호출 시 사용.
     * 
     * @param addon 실행할 Add-on
     * @param articleData 기사 데이터 (title, content, url 등)
     * @param requestId 요청 ID
     * @param importance 중요도
     * @return 분석 결과
     */
    public AddonResponse executeAddonDirect(
            MlAddon addon,
            Map<String, Object> articleData,
            String requestId,
            String importance
    ) {
        log.info("Direct addon execution: addon={}, requestId={}", addon.getAddonKey(), requestId);
        
        // 요청 페이로드 생성
        AddonRequest request = AddonRequest.builder()
                .requestId(requestId)
                .addonId(addon.getAddonKey())
                .task("direct_analysis")
                .inputSchemaVersion(addon.getInputSchemaVersion())
                .article(AddonRequest.ArticleInput.builder()
                        .id(articleData.get("id") != null ? Long.parseLong(articleData.get("id").toString()) : null)
                        .title((String) articleData.get("title"))
                        .content((String) articleData.get("content"))
                        .url((String) articleData.get("url"))
                        .source((String) articleData.get("source"))
                        .publishedAt((String) articleData.get("publishedAt"))
                        .build())
                .context(AddonRequest.AnalysisContext.builder()
                        .language("ko")
                        .country("KR")
                        .build())
                .options(AddonRequest.ExecutionOptions.builder()
                        .importance(importance)
                        .timeoutMs(addon.getTimeoutMs())
                        .build())
                .build();
        
        // 실행 기록 생성
        MlAddonExecution execution = MlAddonExecution.builder()
                .requestId(requestId)
                .batchId(null)
                .addon(addon)
                .articleId(articleData.get("id") != null ? Long.parseLong(articleData.get("id").toString()) : null)
                .importance(importance)
                .status(ExecutionStatus.PENDING)
                .build();
        executionRepository.save(execution);
        
        execution.markStarted();
        executionRepository.save(execution);
        
        try {
            // Add-on 호출 (동기)
            AddonResponse response = callAddon(addon, request)
                    .block(Duration.ofMillis(addon.getTimeoutMs() + 5000));
            
            if (response != null && "success".equals(response.getStatus())) {
                execution.markSuccess(
                        response.getResults() != null ? Map.of("results", response.getResults()) : null,
                        response.getMeta() != null ? response.getMeta().getModelVersion() : null
                );
                addon.incrementSuccess(execution.getLatencyMs());
            } else {
                String errorMsg = response != null && response.getError() != null 
                        ? response.getError().getMessage() 
                        : "Unknown error";
                execution.markFailed("ADDON_ERROR", errorMsg);
                addon.incrementFailure();
            }
            
            executionRepository.save(execution);
            addonRepository.save(addon);
            
            return response;
        } catch (Exception e) {
            execution.markFailed("EXECUTION_ERROR", e.getMessage());
            addon.incrementFailure();
            executionRepository.save(execution);
            addonRepository.save(addon);
            log.error("Direct addon execution failed: addon={}, error={}", addon.getAddonKey(), e.getMessage());
            throw new RuntimeException("Addon execution failed: " + e.getMessage(), e);
        }
    }
}
