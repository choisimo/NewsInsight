package com.newsinsight.collector.repository;

import com.newsinsight.collector.entity.project.ProjectMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Repository for ProjectMember entity.
 */
@Repository
public interface ProjectMemberRepository extends JpaRepository<ProjectMember, Long> {

    /**
     * Find by project ID
     */
    List<ProjectMember> findByProjectIdOrderByJoinedAtDesc(Long projectId);

    /**
     * Find by project ID and status
     */
    List<ProjectMember> findByProjectIdAndStatus(Long projectId, ProjectMember.MemberStatus status);

    /**
     * Find by user ID
     */
    List<ProjectMember> findByUserIdOrderByJoinedAtDesc(String userId);

    /**
     * Find by user ID and status
     */
    List<ProjectMember> findByUserIdAndStatus(String userId, ProjectMember.MemberStatus status);

    /**
     * Find specific membership
     */
    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, String userId);

    /**
     * Find by invite token
     */
    Optional<ProjectMember> findByInviteToken(String inviteToken);

    /**
     * Find pending invitations for user
     */
    List<ProjectMember> findByUserIdAndStatusOrderByJoinedAtDesc(String userId, ProjectMember.MemberStatus status);

    /**
     * Find expired invitations
     */
    @Query("""
            SELECT m FROM ProjectMember m 
            WHERE m.status = 'PENDING' 
            AND m.inviteExpiresAt < :now
            """)
    List<ProjectMember> findExpiredInvitations(@Param("now") LocalDateTime now);

    /**
     * Find members by role
     */
    List<ProjectMember> findByProjectIdAndRole(Long projectId, ProjectMember.MemberRole role);

    /**
     * Find projects where user is a member
     */
    @Query("""
            SELECT m.projectId FROM ProjectMember m 
            WHERE m.userId = :userId 
            AND m.status = 'ACTIVE'
            """)
    List<Long> findProjectIdsByUser(@Param("userId") String userId);

    /**
     * Check if user is member of project
     */
    boolean existsByProjectIdAndUserIdAndStatus(Long projectId, String userId, ProjectMember.MemberStatus status);

    /**
     * Update role
     */
    @Modifying
    @Query("UPDATE ProjectMember m SET m.role = :role WHERE m.id = :id")
    void updateRole(@Param("id") Long id, @Param("role") ProjectMember.MemberRole role);

    /**
     * Update status
     */
    @Modifying
    @Query("UPDATE ProjectMember m SET m.status = :status WHERE m.id = :id")
    void updateStatus(@Param("id") Long id, @Param("status") ProjectMember.MemberStatus status);

    /**
     * Update last active
     */
    @Modifying
    @Query("UPDATE ProjectMember m SET m.lastActiveAt = :activeAt WHERE m.projectId = :projectId AND m.userId = :userId")
    void updateLastActive(
            @Param("projectId") Long projectId,
            @Param("userId") String userId,
            @Param("activeAt") LocalDateTime activeAt
    );

    /**
     * Count members by project
     */
    long countByProjectIdAndStatus(Long projectId, ProjectMember.MemberStatus status);

    /**
     * Delete by project
     */
    void deleteByProjectId(Long projectId);

    /**
     * Delete expired invitations
     */
    @Modifying
    @Query("DELETE FROM ProjectMember m WHERE m.status = 'PENDING' AND m.inviteExpiresAt < :now")
    void deleteExpiredInvitations(@Param("now") LocalDateTime now);
}
