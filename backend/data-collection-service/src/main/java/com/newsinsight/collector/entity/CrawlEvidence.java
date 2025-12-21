package com.newsinsight.collector.entity;

import com.newsinsight.collector.dto.EvidenceDto;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * Entity representing a piece of evidence collected by the deep AI search.
 * Each evidence item contains a URL, stance classification, and content snippet.
 */
@Entity
@Table(name = "crawl_evidence", indexes = {
        @Index(name = "idx_crawl_evidence_job_id", columnList = "job_id"),
        @Index(name = "idx_crawl_evidence_stance", columnList = "stance")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlEvidence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "job_id", nullable = false, length = 64)
    private String jobId;

    @Column(length = 2048)
    private String url;

    @Column(length = 512)
    private String title;

    /**
     * Stance classification: pro, con, or neutral
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private EvidenceStance stance;

    @Column(columnDefinition = "TEXT")
    private String snippet;

    @Column(length = 255)
    private String source;

    /**
     * Source category: news, community, blog, official, academic
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "source_category", length = 32)
    private SourceCategory sourceCategory;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /**
     * Create evidence from EvidenceDto
     */
    public static CrawlEvidence fromEvidenceDto(String jobId, EvidenceDto evidence) {
        EvidenceStance stance = EvidenceStance.NEUTRAL;
        if (evidence.getStance() != null) {
            try {
                stance = EvidenceStance.valueOf(evidence.getStance().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // Keep default NEUTRAL
            }
        }

        // Infer source category from URL domain
        SourceCategory category = SourceCategory.NEWS;
        if (evidence.getUrl() != null) {
            try {
                java.net.URI uri = java.net.URI.create(evidence.getUrl());
                category = SourceCategory.inferFromDomain(uri.getHost());
            } catch (Exception ignored) {
                // Keep default NEWS
            }
        }

        return CrawlEvidence.builder()
                .jobId(jobId)
                .url(evidence.getUrl())
                .title(evidence.getTitle())
                .stance(stance)
                .snippet(evidence.getSnippet())
                .source(evidence.getSource())
                .sourceCategory(category)
                .build();
    }
}
