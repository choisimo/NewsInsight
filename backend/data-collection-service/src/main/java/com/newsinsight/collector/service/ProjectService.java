package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.project.*;
import com.newsinsight.collector.repository.*;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Service for managing Projects.
 * Provides CRUD operations for projects, members, items, and activity logging.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository projectMemberRepository;
    private final ProjectItemRepository projectItemRepository;
    private final ProjectActivityLogRepository activityLogRepository;
    private final ProjectNotificationRepository notificationRepository;

    // ============================================
    // Project CRUD
    // ============================================

    /**
     * Create a new project.
     */
    @Transactional
    public Project createProject(CreateProjectRequest request) {
        Project project = Project.builder()
                .name(request.getName())
                .description(request.getDescription())
                .keywords(request.getKeywords())
                .category(request.getCategory() != null ? request.getCategory() : Project.ProjectCategory.CUSTOM)
                .status(Project.ProjectStatus.ACTIVE)
                .visibility(request.getVisibility() != null ? request.getVisibility() : Project.ProjectVisibility.PRIVATE)
                .ownerId(request.getOwnerId())
                .color(request.getColor())
                .icon(request.getIcon())
                .isDefault(request.getIsDefault() != null && request.getIsDefault())
                .settings(request.getSettings())
                .tags(request.getTags())
                .lastActivityAt(LocalDateTime.now())
                .build();

        Project saved = projectRepository.save(project);
        log.info("Created project: id={}, name='{}', owner={}", saved.getId(), saved.getName(), saved.getOwnerId());

        // Add owner as admin member
        addMember(saved.getId(), request.getOwnerId(), ProjectMember.MemberRole.ADMIN, null);

        // Log activity
        logActivity(saved.getId(), request.getOwnerId(), ProjectActivityLog.ActivityType.PROJECT_CREATED,
                "프로젝트 생성: " + saved.getName(), "project", saved.getId().toString(), null);

        return saved;
    }

    /**
     * Get project by ID.
     */
    public Optional<Project> getProject(Long id) {
        return projectRepository.findById(id);
    }

    /**
     * Get project with access check.
     */
    public Optional<Project> getProjectWithAccess(Long id, String userId) {
        Optional<Project> project = projectRepository.findById(id);
        if (project.isEmpty()) {
            return Optional.empty();
        }

        Project p = project.get();
        
        // Owner always has access
        if (p.getOwnerId().equals(userId)) {
            return project;
        }

        // Public projects are accessible to all
        if (p.getVisibility() == Project.ProjectVisibility.PUBLIC) {
            return project;
        }

        // Check membership for team projects
        if (p.getVisibility() == Project.ProjectVisibility.TEAM) {
            boolean isMember = projectMemberRepository.existsByProjectIdAndUserIdAndStatus(
                    id, userId, ProjectMember.MemberStatus.ACTIVE
            );
            if (isMember) {
                return project;
            }
        }

        return Optional.empty();
    }

    /**
     * Update project.
     */
    @Transactional
    public Project updateProject(Long id, UpdateProjectRequest request, String userId) {
        Project project = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + id));

        // Check permission
        if (!hasEditPermission(id, userId)) {
            throw new IllegalStateException("User does not have edit permission for this project");
        }

        if (request.getName() != null) {
            project.setName(request.getName());
        }
        if (request.getDescription() != null) {
            project.setDescription(request.getDescription());
        }
        if (request.getKeywords() != null) {
            project.setKeywords(request.getKeywords());
        }
        if (request.getCategory() != null) {
            project.setCategory(request.getCategory());
        }
        if (request.getVisibility() != null) {
            project.setVisibility(request.getVisibility());
        }
        if (request.getColor() != null) {
            project.setColor(request.getColor());
        }
        if (request.getIcon() != null) {
            project.setIcon(request.getIcon());
        }
        if (request.getSettings() != null) {
            project.setSettings(request.getSettings());
        }
        if (request.getTags() != null) {
            project.setTags(request.getTags());
        }

        project.touchActivity();
        Project saved = projectRepository.save(project);

        // Log activity
        logActivity(id, userId, ProjectActivityLog.ActivityType.PROJECT_UPDATED,
                "프로젝트 수정", "project", id.toString(), null);

        log.info("Updated project: id={}, name='{}'", saved.getId(), saved.getName());
        return saved;
    }

    /**
     * Update project status.
     */
    @Transactional
    public Project updateProjectStatus(Long id, Project.ProjectStatus status, String userId) {
        Project project = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + id));

        if (!project.getOwnerId().equals(userId)) {
            throw new IllegalStateException("Only owner can change project status");
        }

        project.setStatus(status);
        project.touchActivity();
        
        Project saved = projectRepository.save(project);

        // Log activity
        logActivity(id, userId, ProjectActivityLog.ActivityType.PROJECT_STATUS_CHANGED,
                "프로젝트 상태 변경: " + status, "project", id.toString(), null);

        return saved;
    }

    /**
     * Delete project.
     */
    @Transactional
    public void deleteProject(Long id, String userId) {
        Project project = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + id));

        if (!project.getOwnerId().equals(userId)) {
            throw new IllegalStateException("Only owner can delete the project");
        }

        // Delete all related data
        notificationRepository.deleteByProjectId(id);
        activityLogRepository.deleteByProjectId(id);
        projectItemRepository.deleteByProjectId(id);
        projectMemberRepository.deleteByProjectId(id);
        projectRepository.delete(project);

        log.info("Deleted project: id={}, name='{}'", id, project.getName());
    }

    /**
     * Get projects by owner.
     */
    public Page<Project> getProjectsByOwner(String ownerId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return projectRepository.findByOwnerIdOrderByLastActivityAtDesc(ownerId, pageable);
    }

    /**
     * Get projects by owner and status.
     */
    public Page<Project> getProjectsByOwnerAndStatus(String ownerId, Project.ProjectStatus status, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return projectRepository.findByOwnerIdAndStatus(ownerId, status, pageable);
    }

    /**
     * Search projects by name.
     */
    public Page<Project> searchProjects(String name, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return projectRepository.searchByName(name, pageable);
    }

    /**
     * Get user's default project (create if not exists).
     */
    @Transactional
    public Project getOrCreateDefaultProject(String userId) {
        return projectRepository.findByOwnerIdAndIsDefaultTrue(userId)
                .orElseGet(() -> {
                    CreateProjectRequest request = CreateProjectRequest.builder()
                            .name("My Project")
                            .description("기본 프로젝트")
                            .ownerId(userId)
                            .isDefault(true)
                            .build();
                    return createProject(request);
                });
    }

    // ============================================
    // Member Management
    // ============================================

    /**
     * Add member to project.
     */
    @Transactional
    public ProjectMember addMember(Long projectId, String userId, ProjectMember.MemberRole role, String invitedBy) {
        // Check if already a member
        Optional<ProjectMember> existing = projectMemberRepository.findByProjectIdAndUserId(projectId, userId);
        if (existing.isPresent()) {
            ProjectMember member = existing.get();
            if (member.getStatus() == ProjectMember.MemberStatus.ACTIVE) {
                return member;
            }
            // Reactivate if previously left
            member.setStatus(ProjectMember.MemberStatus.ACTIVE);
            member.setRole(role);
            return projectMemberRepository.save(member);
        }

        ProjectMember member = ProjectMember.builder()
                .projectId(projectId)
                .userId(userId)
                .role(role)
                .status(ProjectMember.MemberStatus.ACTIVE)
                .invitedBy(invitedBy)
                .joinedAt(LocalDateTime.now())
                .lastActiveAt(LocalDateTime.now())
                .build();

        ProjectMember saved = projectMemberRepository.save(member);

        // Log activity
        if (invitedBy != null) {
            logActivity(projectId, invitedBy, ProjectActivityLog.ActivityType.MEMBER_ADDED,
                    "멤버 추가: " + userId, "member", saved.getId().toString(), null);
        }

        // Update project activity
        projectRepository.updateLastActivity(projectId, LocalDateTime.now());

        return saved;
    }

    /**
     * Invite member (creates pending invitation).
     */
    @Transactional
    public ProjectMember inviteMember(Long projectId, String userId, ProjectMember.MemberRole role, String invitedBy) {
        // Check inviter has permission
        if (!hasInvitePermission(projectId, invitedBy)) {
            throw new IllegalStateException("User does not have permission to invite members");
        }

        // Check if already invited or member
        Optional<ProjectMember> existing = projectMemberRepository.findByProjectIdAndUserId(projectId, userId);
        if (existing.isPresent()) {
            throw new IllegalStateException("User is already invited or a member");
        }

        String inviteToken = UUID.randomUUID().toString();

        ProjectMember member = ProjectMember.builder()
                .projectId(projectId)
                .userId(userId)
                .role(role)
                .status(ProjectMember.MemberStatus.PENDING)
                .invitedBy(invitedBy)
                .inviteToken(inviteToken)
                .inviteExpiresAt(LocalDateTime.now().plusDays(7))
                .build();

        ProjectMember saved = projectMemberRepository.save(member);

        // Create notification
        createNotification(projectId, userId, ProjectNotification.NotificationType.MEMBER_INVITED,
                "프로젝트 초대", "프로젝트에 초대되었습니다", null);

        log.info("Invited member: projectId={}, userId={}, invitedBy={}", projectId, userId, invitedBy);
        return saved;
    }

    /**
     * Accept invitation.
     */
    @Transactional
    public ProjectMember acceptInvitation(String inviteToken, String userId) {
        ProjectMember member = projectMemberRepository.findByInviteToken(inviteToken)
                .orElseThrow(() -> new IllegalArgumentException("Invalid or expired invitation"));

        if (!member.getUserId().equals(userId)) {
            throw new IllegalStateException("Invitation is for a different user");
        }

        if (member.getInviteExpiresAt() != null && member.getInviteExpiresAt().isBefore(LocalDateTime.now())) {
            throw new IllegalStateException("Invitation has expired");
        }

        member.setStatus(ProjectMember.MemberStatus.ACTIVE);
        member.setJoinedAt(LocalDateTime.now());
        member.setInviteToken(null);
        member.setInviteExpiresAt(null);

        ProjectMember saved = projectMemberRepository.save(member);

        // Log activity
        logActivity(member.getProjectId(), userId, ProjectActivityLog.ActivityType.MEMBER_JOINED,
                "멤버 참여", "member", saved.getId().toString(), null);

        return saved;
    }

    /**
     * Remove member from project.
     */
    @Transactional
    public void removeMember(Long projectId, String userId, String removedBy) {
        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Member not found"));

        // Check permission
        if (!canRemoveMember(projectId, removedBy, member)) {
            throw new IllegalStateException("User does not have permission to remove this member");
        }

        member.setStatus(ProjectMember.MemberStatus.LEFT);
        projectMemberRepository.save(member);

        // Log activity
        logActivity(projectId, removedBy, ProjectActivityLog.ActivityType.MEMBER_REMOVED,
                "멤버 제거: " + userId, "member", member.getId().toString(), null);

        log.info("Removed member: projectId={}, userId={}, removedBy={}", projectId, userId, removedBy);
    }

    /**
     * Update member role.
     */
    @Transactional
    public ProjectMember updateMemberRole(Long projectId, String userId, ProjectMember.MemberRole newRole, String updatedBy) {
        ProjectMember member = projectMemberRepository.findByProjectIdAndUserId(projectId, userId)
                .orElseThrow(() -> new IllegalArgumentException("Member not found"));

        // Only admin or owner can change roles
        if (!hasAdminPermission(projectId, updatedBy)) {
            throw new IllegalStateException("User does not have permission to change roles");
        }

        member.setRole(newRole);
        ProjectMember saved = projectMemberRepository.save(member);

        // Log activity
        logActivity(projectId, updatedBy, ProjectActivityLog.ActivityType.MEMBER_ROLE_CHANGED,
                "멤버 역할 변경: " + userId + " -> " + newRole, "member", member.getId().toString(), null);

        return saved;
    }

    /**
     * Get project members.
     */
    public List<ProjectMember> getMembers(Long projectId) {
        return projectMemberRepository.findByProjectIdOrderByJoinedAtDesc(projectId);
    }

    /**
     * Get active members.
     */
    public List<ProjectMember> getActiveMembers(Long projectId) {
        return projectMemberRepository.findByProjectIdAndStatus(projectId, ProjectMember.MemberStatus.ACTIVE);
    }

    // ============================================
    // Item Management
    // ============================================

    /**
     * Add item to project.
     */
    @Transactional
    public ProjectItem addItem(Long projectId, AddItemRequest request, String userId) {
        // Check permission
        if (!hasEditPermission(projectId, userId)) {
            throw new IllegalStateException("User does not have permission to add items");
        }

        ProjectItem item = ProjectItem.builder()
                .projectId(projectId)
                .itemType(request.getItemType())
                .title(request.getTitle())
                .summary(request.getSummary())
                .url(request.getUrl())
                .imageUrl(request.getImageUrl())
                .sourceName(request.getSourceName())
                .sourceId(request.getSourceId())
                .sourceType(request.getSourceType())
                .publishedAt(request.getPublishedAt())
                .category(request.getCategory())
                .tags(request.getTags())
                .sentiment(request.getSentiment())
                .importance(request.getImportance() != null ? request.getImportance() : 50)
                .addedBy(userId)
                .addedAt(LocalDateTime.now())
                .isRead(false)
                .bookmarked(false)
                .metadata(request.getMetadata())
                .build();

        ProjectItem saved = projectItemRepository.save(item);

        // Log activity
        logActivity(projectId, userId, ProjectActivityLog.ActivityType.ITEM_ADDED,
                "아이템 추가: " + item.getTitle(), "item", saved.getId().toString(), null);

        // Update project activity
        projectRepository.updateLastActivity(projectId, LocalDateTime.now());

        return saved;
    }

    /**
     * Get project items.
     */
    public Page<ProjectItem> getItems(Long projectId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return projectItemRepository.findByProjectIdOrderByAddedAtDesc(projectId, pageable);
    }

    /**
     * Get project items by type.
     */
    public Page<ProjectItem> getItemsByType(Long projectId, ProjectItem.ItemType type, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return projectItemRepository.findByProjectIdAndItemType(projectId, type, pageable);
    }

    /**
     * Search items.
     */
    public Page<ProjectItem> searchItems(Long projectId, String query, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return projectItemRepository.searchByContent(projectId, query, pageable);
    }

    /**
     * Mark item as read.
     */
    @Transactional
    public void markItemAsRead(Long itemId, String userId) {
        projectItemRepository.markAsRead(itemId);
    }

    /**
     * Toggle item bookmark.
     */
    @Transactional
    public void toggleItemBookmark(Long itemId, String userId) {
        projectItemRepository.toggleBookmark(itemId);
    }

    /**
     * Delete item.
     */
    @Transactional
    public void deleteItem(Long projectId, Long itemId, String userId) {
        if (!hasEditPermission(projectId, userId)) {
            throw new IllegalStateException("User does not have permission to delete items");
        }

        projectItemRepository.deleteById(itemId);

        logActivity(projectId, userId, ProjectActivityLog.ActivityType.ITEM_DELETED,
                "아이템 삭제", "item", itemId.toString(), null);
    }

    // ============================================
    // Activity Log
    // ============================================

    /**
     * Log activity.
     */
    @Transactional
    public ProjectActivityLog logActivity(Long projectId, String userId, ProjectActivityLog.ActivityType type,
                                          String description, String entityType, String entityId, Map<String, Object> details) {
        ProjectActivityLog log = ProjectActivityLog.builder()
                .projectId(projectId)
                .userId(userId)
                .activityType(type)
                .description(description)
                .entityType(entityType)
                .entityId(entityId)
                .details(details)
                .build();

        return activityLogRepository.save(log);
    }

    /**
     * Get project activity log.
     */
    public Page<ProjectActivityLog> getActivityLog(Long projectId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return activityLogRepository.findByProjectIdOrderByCreatedAtDesc(projectId, pageable);
    }

    /**
     * Get recent activity.
     */
    public List<ProjectActivityLog> getRecentActivity(Long projectId) {
        return activityLogRepository.findTop20ByProjectIdOrderByCreatedAtDesc(projectId);
    }

    // ============================================
    // Notifications
    // ============================================

    /**
     * Create notification.
     */
    @Transactional
    public ProjectNotification createNotification(Long projectId, String userId, 
                                                   ProjectNotification.NotificationType type,
                                                   String title, String message, String actionUrl) {
        ProjectNotification notification = ProjectNotification.builder()
                .projectId(projectId)
                .userId(userId)
                .notificationType(type)
                .title(title)
                .message(message)
                .actionUrl(actionUrl)
                .isRead(false)
                .build();

        return notificationRepository.save(notification);
    }

    /**
     * Get user notifications.
     */
    public Page<ProjectNotification> getUserNotifications(String userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return notificationRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable);
    }

    /**
     * Get unread notifications.
     */
    public List<ProjectNotification> getUnreadNotifications(String userId) {
        return notificationRepository.findByUserIdAndIsReadFalseOrderByCreatedAtDesc(userId);
    }

    /**
     * Mark notification as read.
     */
    @Transactional
    public void markNotificationAsRead(Long notificationId) {
        notificationRepository.markAsRead(notificationId, LocalDateTime.now());
    }

    /**
     * Mark all notifications as read.
     */
    @Transactional
    public void markAllNotificationsAsRead(String userId) {
        notificationRepository.markAllAsRead(userId, LocalDateTime.now());
    }

    // ============================================
    // Statistics
    // ============================================

    /**
     * Get project statistics.
     */
    public Map<String, Object> getProjectStats(Long projectId) {
        long itemCount = projectItemRepository.countByProjectId(projectId);
        long unreadCount = projectItemRepository.countByProjectIdAndIsReadFalse(projectId);
        long memberCount = projectMemberRepository.countByProjectIdAndStatus(projectId, ProjectMember.MemberStatus.ACTIVE);
        List<String> categories = projectItemRepository.findDistinctCategories(projectId);

        return Map.of(
                "itemCount", itemCount,
                "unreadCount", unreadCount,
                "memberCount", memberCount,
                "categories", categories
        );
    }

    // ============================================
    // Permission Helpers
    // ============================================

    private boolean hasEditPermission(Long projectId, String userId) {
        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null) return false;
        
        if (project.getOwnerId().equals(userId)) return true;

        Optional<ProjectMember> member = projectMemberRepository.findByProjectIdAndUserId(projectId, userId);
        if (member.isEmpty() || member.get().getStatus() != ProjectMember.MemberStatus.ACTIVE) {
            return false;
        }

        ProjectMember.MemberRole role = member.get().getRole();
        return role == ProjectMember.MemberRole.ADMIN || role == ProjectMember.MemberRole.EDITOR;
    }

    private boolean hasAdminPermission(Long projectId, String userId) {
        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null) return false;
        
        if (project.getOwnerId().equals(userId)) return true;

        Optional<ProjectMember> member = projectMemberRepository.findByProjectIdAndUserId(projectId, userId);
        return member.isPresent() 
                && member.get().getStatus() == ProjectMember.MemberStatus.ACTIVE
                && member.get().getRole() == ProjectMember.MemberRole.ADMIN;
    }

    private boolean hasInvitePermission(Long projectId, String userId) {
        return hasAdminPermission(projectId, userId);
    }

    private boolean canRemoveMember(Long projectId, String removedBy, ProjectMember member) {
        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null) return false;

        // Owner can remove anyone
        if (project.getOwnerId().equals(removedBy)) return true;

        // Member can remove themselves
        if (member.getUserId().equals(removedBy)) return true;

        // Admin can remove non-admin members
        if (hasAdminPermission(projectId, removedBy) && member.getRole() != ProjectMember.MemberRole.ADMIN) {
            return true;
        }

        return false;
    }

    // ============================================
    // DTOs
    // ============================================

    @Data
    @Builder
    public static class CreateProjectRequest {
        private String name;
        private String description;
        private List<String> keywords;
        private Project.ProjectCategory category;
        private Project.ProjectVisibility visibility;
        private String ownerId;
        private String color;
        private String icon;
        private Boolean isDefault;
        private Project.ProjectSettings settings;
        private List<String> tags;
    }

    @Data
    @Builder
    public static class UpdateProjectRequest {
        private String name;
        private String description;
        private List<String> keywords;
        private Project.ProjectCategory category;
        private Project.ProjectVisibility visibility;
        private String color;
        private String icon;
        private Project.ProjectSettings settings;
        private List<String> tags;
    }

    @Data
    @Builder
    public static class AddItemRequest {
        private ProjectItem.ItemType itemType;
        private String title;
        private String summary;
        private String url;
        private String imageUrl;
        private String sourceName;
        private String sourceId;
        private String sourceType;
        private LocalDateTime publishedAt;
        private String category;
        private List<String> tags;
        private String sentiment;
        private Integer importance;
        private Map<String, Object> metadata;
    }
}
