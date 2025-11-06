package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface DataSourceRepository extends JpaRepository<DataSource, Long> {

    List<DataSource> findByIsActiveTrue();

    List<DataSource> findBySourceType(SourceType sourceType);

    List<DataSource> findByIsActiveTrueAndSourceType(SourceType sourceType);

    Optional<DataSource> findByName(String name);

    @Query("SELECT ds FROM DataSource ds WHERE ds.isActive = true " +
           "AND (ds.lastCollected IS NULL OR ds.lastCollected < :threshold)")
    List<DataSource> findDueForCollection(LocalDateTime threshold);

    long countByIsActiveTrue();
}
