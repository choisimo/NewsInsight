package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.analysis.ArticleDiscussion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ArticleDiscussionRepository extends JpaRepository<ArticleDiscussion, Long> {

    Optional<ArticleDiscussion> findByArticleId(Long articleId);

    List<ArticleDiscussion> findByArticleIdIn(List<Long> articleIds);

    boolean existsByArticleId(Long articleId);
}
