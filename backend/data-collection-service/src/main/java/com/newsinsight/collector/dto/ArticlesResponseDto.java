package com.newsinsight.collector.dto;

import java.util.List;

public record ArticlesResponseDto(
        String query,
        List<ArticleDto> articles,
        long total
) {}
