package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CollectedData;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface CollectedDataRepository extends JpaRepository<CollectedData, Long> {

    Optional<CollectedData> findByContentHash(String contentHash);

    List<CollectedData> findBySourceIdOrderByCollectedAtDesc(Long sourceId);

    Page<CollectedData> findBySourceId(Long sourceId, Pageable pageable);

    List<CollectedData> findByProcessedFalse();

    Page<CollectedData> findByProcessedFalse(Pageable pageable);

    Page<CollectedData> findByProcessed(Boolean processed, Pageable pageable);

    long countByProcessedFalse();

    @Query("SELECT COUNT(cd) FROM CollectedData cd WHERE cd.collectedAt >= :startDate")
    long countCollectedSince(@Param("startDate") LocalDateTime startDate);

    @Query("SELECT COUNT(cd) FROM CollectedData cd WHERE cd.sourceId = :sourceId")
    long countBySourceId(@Param("sourceId") Long sourceId);

    boolean existsByContentHash(String contentHash);
}
