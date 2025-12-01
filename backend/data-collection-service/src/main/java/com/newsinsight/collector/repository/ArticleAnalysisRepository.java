package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.analysis.ArticleAnalysis;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ArticleAnalysisRepository extends JpaRepository<ArticleAnalysis, Long> {

    Optional<ArticleAnalysis> findByArticleId(Long articleId);

    List<ArticleAnalysis> findByArticleIdIn(List<Long> articleIds);

    @Query("SELECT a FROM ArticleAnalysis a WHERE a.fullyAnalyzed = false")
    List<ArticleAnalysis> findIncompleteAnalyses();

    @Query("SELECT a FROM ArticleAnalysis a WHERE a.reliabilityScore >= :minScore")
    List<ArticleAnalysis> findByReliabilityScoreGreaterThanEqual(@Param("minScore") Double minScore);

    @Query("SELECT a FROM ArticleAnalysis a WHERE a.misinfoRisk = :risk")
    List<ArticleAnalysis> findByMisinfoRisk(@Param("risk") String risk);

    @Query("SELECT a.articleId FROM ArticleAnalysis a WHERE a.articleId IN :articleIds")
    List<Long> findAnalyzedArticleIds(@Param("articleIds") List<Long> articleIds);

    boolean existsByArticleId(Long articleId);
}
