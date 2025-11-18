package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.AnalysisResponseDto;
import com.newsinsight.collector.dto.ArticlesResponseDto;
import com.newsinsight.collector.service.AnalysisService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AnalysisController {

    private final AnalysisService analysisService;

    @GetMapping("/analysis")
    public ResponseEntity<AnalysisResponseDto> getAnalysis(
            @RequestParam String query,
            @RequestParam(defaultValue = "7d") String window
    ) {
        return ResponseEntity.ok(analysisService.analyze(query, window));
    }

    @GetMapping("/articles")
    public ResponseEntity<ArticlesResponseDto> getArticles(
            @RequestParam String query,
            @RequestParam(defaultValue = "50") int limit
    ) {
        return ResponseEntity.ok(analysisService.searchArticles(query, limit));
    }
}
