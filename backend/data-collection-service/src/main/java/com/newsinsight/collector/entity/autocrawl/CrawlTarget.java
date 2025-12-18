package com.newsinsight.collector.entity.autocrawl;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 자동 크롤링 대상 URL 엔티티.
 * 검색, 기사 분석, 외부 링크 등에서 자동으로 발견된 URL을 관리합니다.
 */
@Entity
@Table(name = "crawl_targets", indexes = {
        @Index(name = "idx_crawl_target_url_hash", columnList = "urlHash"),
        @Index(name = "idx_crawl_target_status", columnList = "status"),
        @Index(name = "idx_crawl_target_priority", columnList = "priority DESC"),
        @Index(name = "idx_crawl_target_discovered", columnList = "discoveredAt DESC")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CrawlTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 크롤링 대상 URL
     */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String url;

    /**
     * URL 해시 (중복 체크용)
     */
    @Column(nullable = false, length = 64)
    private String urlHash;

    /**
     * 발견 출처 (SEARCH, ARTICLE_LINK, TRENDING, RSS_MENTION, MANUAL, DEEP_SEARCH)
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private DiscoverySource discoverySource;

    /**
     * 발견 컨텍스트 (검색어, 원본 기사 ID 등)
     */
    @Column(columnDefinition = "TEXT")
    private String discoveryContext;

    /**
     * 크롤링 우선순위 (0-100, 높을수록 우선)
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer priority = 50;

    /**
     * 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private CrawlTargetStatus status = CrawlTargetStatus.PENDING;

    /**
     * 도메인 (파싱된 호스트)
     */
    @Column(length = 255)
    private String domain;

    /**
     * 예상 콘텐츠 타입 (NEWS, BLOG, FORUM, SOCIAL, UNKNOWN)
     */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    @Builder.Default
    private ContentType expectedContentType = ContentType.UNKNOWN;

    /**
     * 관련 키워드 (쉼표 구분)
     */
    @Column(columnDefinition = "TEXT")
    private String relatedKeywords;

    /**
     * 재시도 횟수
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer retryCount = 0;

    /**
     * 최대 재시도 횟수
     */
    @Column(nullable = false)
    @Builder.Default
    private Integer maxRetries = 3;

    /**
     * 마지막 시도 시각
     */
    private LocalDateTime lastAttemptAt;

    /**
     * 다음 시도 가능 시각 (재시도 백오프용)
     */
    private LocalDateTime nextAttemptAfter;

    /**
     * 마지막 오류 메시지
     */
    @Column(columnDefinition = "TEXT")
    private String lastError;

    /**
     * 크롤링 성공 시 저장된 CollectedData ID
     */
    private Long collectedDataId;

    /**
     * 발견 시각
     */
    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime discoveredAt;

    /**
     * 마지막 수정 시각
     */
    @UpdateTimestamp
    private LocalDateTime updatedAt;

    /**
     * 처리 완료 시각
     */
    private LocalDateTime completedAt;

    // ========================================
    // 유틸리티 메서드
    // ========================================

    public void markInProgress() {
        this.status = CrawlTargetStatus.IN_PROGRESS;
        this.lastAttemptAt = LocalDateTime.now();
    }

    public void markCompleted(Long collectedDataId) {
        this.status = CrawlTargetStatus.COMPLETED;
        this.completedAt = LocalDateTime.now();
        this.collectedDataId = collectedDataId;
    }

    public void markFailed(String error) {
        this.retryCount++;
        this.lastError = error;
        this.lastAttemptAt = LocalDateTime.now();

        if (this.retryCount >= this.maxRetries) {
            this.status = CrawlTargetStatus.FAILED;
        } else {
            this.status = CrawlTargetStatus.PENDING;
            // 지수 백오프: 2^retry * 5분
            int delayMinutes = (int) Math.pow(2, this.retryCount) * 5;
            this.nextAttemptAfter = LocalDateTime.now().plusMinutes(delayMinutes);
        }
    }

    public void markSkipped(String reason) {
        this.status = CrawlTargetStatus.SKIPPED;
        this.lastError = reason;
        this.completedAt = LocalDateTime.now();
    }

    public boolean isRetryable() {
        if (status != CrawlTargetStatus.PENDING) return false;
        if (retryCount >= maxRetries) return false;
        if (nextAttemptAfter != null && LocalDateTime.now().isBefore(nextAttemptAfter)) return false;
        return true;
    }

    /**
     * 우선순위 부스트 (특정 조건에서 우선순위 상승)
     */
    public void boostPriority(int amount) {
        this.priority = Math.min(100, this.priority + amount);
    }
}
