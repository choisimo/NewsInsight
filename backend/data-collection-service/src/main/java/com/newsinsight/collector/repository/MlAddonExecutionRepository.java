package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.addon.ExecutionStatus;
import com.newsinsight.collector.entity.addon.MlAddonExecution;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface MlAddonExecutionRepository extends JpaRepository<MlAddonExecution, Long> {

    Optional<MlAddonExecution> findByRequestId(String requestId);

    List<MlAddonExecution> findByArticleId(Long articleId);

    List<MlAddonExecution> findByBatchId(String batchId);

    List<MlAddonExecution> findByStatus(ExecutionStatus status);

    Page<MlAddonExecution> findByAddonId(Long addonId, Pageable pageable);

    @Query("SELECT e FROM MlAddonExecution e WHERE e.articleId = :articleId AND e.addon.addonKey = :addonKey")
    Optional<MlAddonExecution> findByArticleIdAndAddonKey(@Param("articleId") Long articleId, @Param("addonKey") String addonKey);

    @Query("SELECT e FROM MlAddonExecution e WHERE e.status = 'PENDING' AND e.createdAt < :cutoff")
    List<MlAddonExecution> findStaleExecutions(@Param("cutoff") LocalDateTime cutoff);

    @Modifying
    @Query("UPDATE MlAddonExecution e SET e.status = 'TIMEOUT' WHERE e.status IN ('PENDING', 'RUNNING') AND e.createdAt < :cutoff")
    int markTimedOutExecutions(@Param("cutoff") LocalDateTime cutoff);

    @Query("SELECT COUNT(e) FROM MlAddonExecution e WHERE e.addon.id = :addonId AND e.status = :status AND e.createdAt > :since")
    long countByAddonAndStatusSince(@Param("addonId") Long addonId, @Param("status") ExecutionStatus status, @Param("since") LocalDateTime since);

    @Query("SELECT AVG(e.latencyMs) FROM MlAddonExecution e WHERE e.addon.id = :addonId AND e.status = 'SUCCESS' AND e.createdAt > :since")
    Double getAverageLatency(@Param("addonId") Long addonId, @Param("since") LocalDateTime since);

    @Modifying
    @Query("DELETE FROM MlAddonExecution e WHERE e.createdAt < :cutoff")
    int deleteOldExecutions(@Param("cutoff") LocalDateTime cutoff);
}
