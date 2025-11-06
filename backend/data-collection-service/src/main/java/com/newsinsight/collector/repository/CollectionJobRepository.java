package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.CollectionJob;
import com.newsinsight.collector.entity.CollectionJob.JobStatus;
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
public interface CollectionJobRepository extends JpaRepository<CollectionJob, Long> {

    List<CollectionJob> findBySourceIdOrderByCreatedAtDesc(Long sourceId);

    Page<CollectionJob> findBySourceId(Long sourceId, Pageable pageable);

    List<CollectionJob> findByStatus(JobStatus status);

    Page<CollectionJob> findByStatus(JobStatus status, Pageable pageable);

    Optional<CollectionJob> findFirstBySourceIdAndStatusOrderByCreatedAtDesc(
        Long sourceId, JobStatus status);

    @Query("SELECT cj FROM CollectionJob cj WHERE cj.status = :status " +
           "AND cj.startedAt < :threshold")
    List<CollectionJob> findStaleJobs(
        @Param("status") JobStatus status,
        @Param("threshold") LocalDateTime threshold);

    @Query("SELECT cj FROM CollectionJob cj WHERE cj.createdAt >= :startDate " +
           "ORDER BY cj.createdAt DESC")
    List<CollectionJob> findRecentJobs(@Param("startDate") LocalDateTime startDate);

    List<CollectionJob> findByStatusAndCompletedAtBefore(JobStatus status, LocalDateTime completedAt);

    long countByStatus(JobStatus status);
}
