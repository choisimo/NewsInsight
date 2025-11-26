package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CrawlEvidence;
import com.newsinsight.collector.entity.EvidenceStance;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CrawlEvidenceRepository extends JpaRepository<CrawlEvidence, Long> {

    /**
     * Find all evidence for a job
     */
    List<CrawlEvidence> findByJobId(String jobId);

    /**
     * Find evidence by job ID with pagination
     */
    Page<CrawlEvidence> findByJobId(String jobId, Pageable pageable);

    /**
     * Find evidence by job ID and stance
     */
    List<CrawlEvidence> findByJobIdAndStance(String jobId, EvidenceStance stance);

    /**
     * Count evidence by job ID
     */
    long countByJobId(String jobId);

    /**
     * Count evidence by stance for a job
     */
    long countByJobIdAndStance(String jobId, EvidenceStance stance);

    /**
     * Delete all evidence for a job
     */
    @Modifying
    @Query("DELETE FROM CrawlEvidence e WHERE e.jobId = :jobId")
    int deleteByJobId(@Param("jobId") String jobId);

    /**
     * Delete evidence for multiple jobs
     */
    @Modifying
    @Query("DELETE FROM CrawlEvidence e WHERE e.jobId IN :jobIds")
    int deleteByJobIdIn(@Param("jobIds") List<String> jobIds);

    /**
     * Search evidence by snippet content
     */
    @Query("SELECT e FROM CrawlEvidence e WHERE e.jobId = :jobId AND " +
            "(LOWER(e.snippet) LIKE LOWER(CONCAT('%', :keyword, '%')) OR " +
            "LOWER(e.title) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    List<CrawlEvidence> searchByKeyword(
            @Param("jobId") String jobId,
            @Param("keyword") String keyword
    );

    /**
     * Get stance distribution for a job
     */
    @Query("SELECT e.stance, COUNT(e) FROM CrawlEvidence e WHERE e.jobId = :jobId GROUP BY e.stance")
    List<Object[]> getStanceDistribution(@Param("jobId") String jobId);
}
