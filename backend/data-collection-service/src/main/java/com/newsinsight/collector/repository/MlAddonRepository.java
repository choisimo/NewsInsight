package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.addon.AddonCategory;
import com.newsinsight.collector.entity.addon.AddonHealthStatus;
import com.newsinsight.collector.entity.addon.MlAddon;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface MlAddonRepository extends JpaRepository<MlAddon, Long> {

    Optional<MlAddon> findByAddonKey(String addonKey);

    List<MlAddon> findByEnabledTrue();

    List<MlAddon> findByCategory(AddonCategory category);

    List<MlAddon> findByCategoryAndEnabledTrue(AddonCategory category);

    List<MlAddon> findByEnabledTrueOrderByPriorityAsc();

    @Query("SELECT a FROM MlAddon a WHERE a.enabled = true AND a.category IN :categories ORDER BY a.priority ASC")
    List<MlAddon> findEnabledByCategories(@Param("categories") List<AddonCategory> categories);

    @Query("SELECT a FROM MlAddon a WHERE a.enabled = true AND a.healthStatus = :status")
    List<MlAddon> findEnabledByHealthStatus(@Param("status") AddonHealthStatus status);

    @Modifying
    @Query("UPDATE MlAddon a SET a.healthStatus = :status, a.lastHealthCheck = :checkTime WHERE a.id = :id")
    void updateHealthStatus(@Param("id") Long id, @Param("status") AddonHealthStatus status, @Param("checkTime") LocalDateTime checkTime);

    @Modifying
    @Query("UPDATE MlAddon a SET a.enabled = false WHERE a.id = :id")
    void disableAddon(@Param("id") Long id);

    @Query("SELECT a FROM MlAddon a WHERE a.healthCheckUrl IS NOT NULL AND " +
           "(a.lastHealthCheck IS NULL OR a.lastHealthCheck < :cutoff)")
    List<MlAddon> findAddonsNeedingHealthCheck(@Param("cutoff") LocalDateTime cutoff);

    boolean existsByAddonKey(String addonKey);
}
