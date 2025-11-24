package com.newsinsight.collector.controller;

import com.newsinsight.collector.client.PerplexityClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

@RestController
@RequestMapping("/api/v1/analysis")
@RequiredArgsConstructor
@Slf4j
public class LiveAnalysisController {

    private final PerplexityClient perplexityClient;

    @GetMapping(value = "/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamLiveAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        String prompt = buildPrompt(query, window);
        log.info("Starting live analysis stream for query='{}', window='{}'", query, window);
        return perplexityClient.streamCompletion(prompt)
                .onErrorResume(e -> {
                    log.error("Live analysis streaming failed", e);
                    return Flux.just("실시간 분석 중 오류가 발생했습니다: " + e.getMessage());
                });
    }

    private String buildPrompt(String query, String window) {
        String normalizedQuery = (query == null || query.isBlank()) ? "지정된 키워드 없음" : query;

        String windowDescription;
        if ("1d".equals(window)) {
            windowDescription = "최근 1일";
        } else if ("30d".equals(window)) {
            windowDescription = "최근 30일";
        } else {
            windowDescription = "최근 7일";
        }

        return "다음 키워드 '" + normalizedQuery + "' 에 대해 " + windowDescription +
                " 동안의 주요 뉴스 흐름과 핵심 인사이트를 한국어로 자세히 요약해 주세요. " +
                "가능하면 bullet 형식으로 정리하고, 마지막에 전반적인 의미를 한 문단으로 정리해 주세요.";
    }
}

