package com.newsinsight.collector.entity.project;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Entity representing a project member.
 * Manages team access and permissions for collaborative projects.
 */
@Entity
@Table(name = "project_members", indexes = {
        @Index(name = "idx_pm_project_id", columnList = "project_id"),
        @Index(name = "idx_pm_user_id", columnList = "user_id"),
        @Index(name = "idx_pm_role", columnList = "role")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_project_member", columnNames = {"project_id", "user_id"})
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProjectMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Project ID
     */
    @Column(name = "project_id", nullable = false)
    private Long projectId;

    /**
     * User ID
     */
    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    /**
     * Member role
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "role", length = 32)
    @Builder.Default
    private MemberRole role = MemberRole.VIEWER;

    /**
     * Specific permissions (optional, overrides role defaults)
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "permissions", columnDefinition = "jsonb")
    private List<String> permissions;

    /**
     * User who invited this member
     */
    @Column(name = "invited_by", length = 64)
    private String invitedBy;

    /**
     * Invitation status
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 32)
    @Builder.Default
    private MemberStatus status = MemberStatus.PENDING;

    /**
     * Invitation token (for email invites)
     */
    @Column(name = "invite_token", length = 128)
    private String inviteToken;

    /**
     * When the invitation expires
     */
    @Column(name = "invite_expires_at")
    private LocalDateTime inviteExpiresAt;

    @CreationTimestamp
    @Column(name = "joined_at", updatable = false)
    private LocalDateTime joinedAt;

    @Column(name = "last_active_at")
    private LocalDateTime lastActiveAt;

    // ============ Enums ============

    public enum MemberRole {
        /** Full control including delete */
        OWNER,
        /** Can manage members and settings */
        ADMIN,
        /** Can add/edit items */
        EDITOR,
        /** Read-only access */
        VIEWER
    }

    public enum MemberStatus {
        /** Invitation pending acceptance */
        PENDING,
        /** Active member */
        ACTIVE,
        /** Membership revoked */
        REVOKED,
        /** User left the project */
        LEFT
    }

    // ============ Permission constants ============

    public static class Permission {
        public static final String MANAGE_PROJECT = "manage_project";
        public static final String DELETE_PROJECT = "delete_project";
        public static final String INVITE_MEMBERS = "invite_members";
        public static final String REMOVE_MEMBERS = "remove_members";
        public static final String CHANGE_ROLES = "change_roles";
        public static final String ADD_ITEMS = "add_items";
        public static final String EDIT_ITEMS = "edit_items";
        public static final String DELETE_ITEMS = "delete_items";
        public static final String RUN_SEARCH = "run_search";
        public static final String GENERATE_REPORT = "generate_report";
        public static final String CHANGE_SETTINGS = "change_settings";
        public static final String VIEW_ANALYTICS = "view_analytics";
    }

    // ============ Helper methods ============

    /**
     * Check if member has a specific permission
     */
    public boolean hasPermission(String permission) {
        // Owner has all permissions
        if (role == MemberRole.OWNER) return true;
        
        // Check explicit permissions first
        if (permissions != null && permissions.contains(permission)) {
            return true;
        }
        
        // Check role-based permissions
        return switch (role) {
            case ADMIN -> !permission.equals(Permission.DELETE_PROJECT);
            case EDITOR -> permission.equals(Permission.ADD_ITEMS) 
                    || permission.equals(Permission.EDIT_ITEMS)
                    || permission.equals(Permission.RUN_SEARCH)
                    || permission.equals(Permission.GENERATE_REPORT)
                    || permission.equals(Permission.VIEW_ANALYTICS);
            case VIEWER -> permission.equals(Permission.VIEW_ANALYTICS);
            default -> false;
        };
    }

    /**
     * Accept invitation
     */
    public void accept() {
        this.status = MemberStatus.ACTIVE;
        this.inviteToken = null;
        this.inviteExpiresAt = null;
    }

    /**
     * Touch last active timestamp
     */
    public void touchActive() {
        this.lastActiveAt = LocalDateTime.now();
    }
}
