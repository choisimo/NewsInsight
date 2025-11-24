package com.newsinsight.collector.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

@Entity
@Table(name = "collected_data", indexes = {
    @Index(name = "idx_source_id", columnList = "source_id"),
    @Index(name = "idx_content_hash", columnList = "content_hash"),
    @Index(name = "idx_processed", columnList = "processed"),
    @Index(name = "idx_collected_at", columnList = "collected_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CollectedData {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "source_id", nullable = false)
    private Long sourceId;

    @Column(name = "title", columnDefinition = "TEXT")
    private String title;

    @Column(name = "content", columnDefinition = "TEXT")
    private String content;

    @Column(name = "url", columnDefinition = "TEXT")
    private String url;

    @Column(name = "published_date")
    private LocalDateTime publishedDate;

    @CreationTimestamp
    @Column(name = "collected_at", nullable = false, updatable = false)
    private LocalDateTime collectedAt;

    @Column(name = "content_hash", length = 64)
    private String contentHash;

    @Column(name = "metadata_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String metadataJson;

    @Column(name = "processed", nullable = false)
    @Builder.Default
    private Boolean processed = false;

    // QA pipeline results
    @Column(name = "http_ok")
    private Boolean httpOk;

    @Column(name = "has_content")
    private Boolean hasContent;

    @Column(name = "duplicate")
    private Boolean duplicate;

    @Column(name = "normalized")
    private Boolean normalized;

    @Column(name = "quality_score")
    private Double qualityScore;

    @Column(name = "semantic_consistency")
    private Double semanticConsistency;

    @Column(name = "outlier_score")
    private Double outlierScore;

    @Column(name = "trust_score")
    private Double trustScore;
}
