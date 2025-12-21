package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.settings.LlmProviderSettings;
import com.newsinsight.collector.entity.settings.LlmProviderType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface LlmProviderSettingsRepository extends JpaRepository<LlmProviderSettings, Long> {

    // === 전역(관리자) 설정 조회 ===

    /**
     * 전역 설정 전체 조회 (userId가 null인 것들)
     */
    @Query("SELECT s FROM LlmProviderSettings s WHERE s.userId IS NULL ORDER BY s.priority ASC")
    List<LlmProviderSettings> findAllGlobalSettings();

    /**
     * 활성화된 전역 설정만 조회
     */
    @Query("SELECT s FROM LlmProviderSettings s WHERE s.userId IS NULL AND s.enabled = true ORDER BY s.priority ASC")
    List<LlmProviderSettings> findEnabledGlobalSettings();

    /**
     * 특정 Provider의 전역 설정 조회
     */
    @Query("SELECT s FROM LlmProviderSettings s WHERE s.providerType = :providerType AND s.userId IS NULL")
    Optional<LlmProviderSettings> findGlobalByProviderType(@Param("providerType") LlmProviderType providerType);

    // === 사용자별 설정 조회 ===

    /**
     * 특정 사용자의 모든 설정 조회
     */
    List<LlmProviderSettings> findByUserIdOrderByPriorityAsc(String userId);

    /**
     * 특정 사용자의 활성화된 설정만 조회
     */
    List<LlmProviderSettings> findByUserIdAndEnabledTrueOrderByPriorityAsc(String userId);

    /**
     * 특정 사용자의 특정 Provider 설정 조회
     */
    Optional<LlmProviderSettings> findByProviderTypeAndUserId(LlmProviderType providerType, String userId);

    // === 유효(effective) 설정 조회 (사용자 설정 우선, 없으면 전역) ===

    /**
     * 특정 Provider의 유효 설정 조회 (사용자 > 전역 우선순위)
     */
    @Query("SELECT s FROM LlmProviderSettings s " +
           "WHERE s.providerType = :providerType " +
           "AND (s.userId = :userId OR s.userId IS NULL) " +
           "ORDER BY CASE WHEN s.userId IS NOT NULL THEN 0 ELSE 1 END, s.priority ASC")
    List<LlmProviderSettings> findEffectiveSettings(
            @Param("providerType") LlmProviderType providerType,
            @Param("userId") String userId
    );

    /**
     * 사용자에게 유효한 모든 활성화된 설정 조회
     * 사용자 설정이 있으면 그것을, 없으면 전역 설정 반환
     */
    @Query(value = """
        SELECT DISTINCT ON (provider_type) * FROM llm_provider_settings 
        WHERE (user_id = :userId OR user_id IS NULL) 
        AND enabled = true 
        ORDER BY provider_type, 
                 CASE WHEN user_id IS NOT NULL THEN 0 ELSE 1 END, 
                 priority ASC
        """, nativeQuery = true)
    List<LlmProviderSettings> findAllEffectiveSettingsForUser(@Param("userId") String userId);

    // === 업데이트 쿼리 ===

    @Modifying
    @Query("UPDATE LlmProviderSettings s SET s.enabled = :enabled WHERE s.id = :id")
    void updateEnabled(@Param("id") Long id, @Param("enabled") Boolean enabled);

    @Modifying
    @Query("UPDATE LlmProviderSettings s SET s.lastTestedAt = :testedAt, s.lastTestSuccess = :success WHERE s.id = :id")
    void updateTestResult(@Param("id") Long id, @Param("testedAt") LocalDateTime testedAt, @Param("success") Boolean success);

    // === 존재 여부 확인 ===

    boolean existsByProviderTypeAndUserId(LlmProviderType providerType, String userId);

    @Query("SELECT CASE WHEN COUNT(s) > 0 THEN true ELSE false END FROM LlmProviderSettings s " +
           "WHERE s.providerType = :providerType AND s.userId IS NULL")
    boolean existsGlobalByProviderType(@Param("providerType") LlmProviderType providerType);

    // === 삭제 ===

    void deleteByProviderTypeAndUserId(LlmProviderType providerType, String userId);

    @Modifying
    @Query("DELETE FROM LlmProviderSettings s WHERE s.providerType = :providerType AND s.userId IS NULL")
    void deleteGlobalByProviderType(@Param("providerType") LlmProviderType providerType);

    /**
     * 특정 사용자의 모든 설정 삭제
     */
    void deleteByUserId(String userId);
}
