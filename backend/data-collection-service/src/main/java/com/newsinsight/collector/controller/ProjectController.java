package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.project.*;
import com.newsinsight.collector.service.ProjectService;
import com.newsinsight.collector.service.ProjectService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST Controller for Project API.
 * Provides endpoints for project CRUD, members, items, and activities.
 */
@RestController
@RequestMapping("/api/v1/projects")
@RequiredArgsConstructor
@Slf4j
public class ProjectController {

    private final ProjectService projectService;

    // ============================================
    // Project CRUD
    // ============================================

    /**
     * Create a new project.
     */
    @PostMapping
    public ResponseEntity<Project> createProject(@RequestBody CreateProjectRequest request) {
        log.info("Creating project: name='{}', owner={}", request.getName(), request.getOwnerId());

        if (request.getName() == null || request.getName().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        if (request.getOwnerId() == null || request.getOwnerId().isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        Project project = projectService.createProject(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(project);
    }

    /**
     * Get project by ID.
     */
    @GetMapping("/{id}")
    public ResponseEntity<Project> getProject(
            @PathVariable Long id,
            @RequestParam(required = false) String userId
    ) {
        if (userId != null) {
            return projectService.getProjectWithAccess(id, userId)
                    .map(ResponseEntity::ok)
                    .orElse(ResponseEntity.notFound().build());
        }
        return projectService.getProject(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Update project.
     */
    @PutMapping("/{id}")
    public ResponseEntity<Project> updateProject(
            @PathVariable Long id,
            @RequestBody UpdateProjectRequest request,
            @RequestParam String userId
    ) {
        try {
            Project updated = projectService.updateProject(id, request, userId);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Update project status.
     */
    @PutMapping("/{id}/status")
    public ResponseEntity<Project> updateProjectStatus(
            @PathVariable Long id,
            @RequestBody Map<String, String> body,
            @RequestParam String userId
    ) {
        String statusStr = body.get("status");
        if (statusStr == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            Project.ProjectStatus status = Project.ProjectStatus.valueOf(statusStr.toUpperCase());
            Project updated = projectService.updateProjectStatus(id, status, userId);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Delete project.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteProject(
            @PathVariable Long id,
            @RequestParam String userId
    ) {
        try {
            projectService.deleteProject(id, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Get projects by owner.
     */
    @GetMapping
    public ResponseEntity<PageResponse<Project>> getProjects(
            @RequestParam String ownerId,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<Project> result;

        if (status != null) {
            Project.ProjectStatus projectStatus = Project.ProjectStatus.valueOf(status.toUpperCase());
            result = projectService.getProjectsByOwnerAndStatus(ownerId, projectStatus, page, size);
        } else {
            result = projectService.getProjectsByOwner(ownerId, page, size);
        }

        PageResponse<Project> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Search projects.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<Project>> searchProjects(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<Project> result = projectService.searchProjects(q, page, size);

        PageResponse<Project> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get or create default project.
     */
    @GetMapping("/default")
    public ResponseEntity<Project> getDefaultProject(@RequestParam String userId) {
        Project project = projectService.getOrCreateDefaultProject(userId);
        return ResponseEntity.ok(project);
    }

    /**
     * Get project statistics.
     */
    @GetMapping("/{id}/stats")
    public ResponseEntity<Map<String, Object>> getProjectStats(@PathVariable Long id) {
        try {
            Map<String, Object> stats = projectService.getProjectStats(id);
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            return ResponseEntity.notFound().build();
        }
    }

    // ============================================
    // Member Management
    // ============================================

    /**
     * Get project members.
     */
    @GetMapping("/{id}/members")
    public ResponseEntity<List<ProjectMember>> getMembers(@PathVariable Long id) {
        List<ProjectMember> members = projectService.getMembers(id);
        return ResponseEntity.ok(members);
    }

    /**
     * Get active members.
     */
    @GetMapping("/{id}/members/active")
    public ResponseEntity<List<ProjectMember>> getActiveMembers(@PathVariable Long id) {
        List<ProjectMember> members = projectService.getActiveMembers(id);
        return ResponseEntity.ok(members);
    }

    /**
     * Invite member.
     */
    @PostMapping("/{id}/members/invite")
    public ResponseEntity<ProjectMember> inviteMember(
            @PathVariable Long id,
            @RequestBody Map<String, String> body,
            @RequestParam String invitedBy
    ) {
        String userId = body.get("userId");
        String roleStr = body.get("role");

        if (userId == null || userId.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        ProjectMember.MemberRole role = roleStr != null 
                ? ProjectMember.MemberRole.valueOf(roleStr.toUpperCase())
                : ProjectMember.MemberRole.VIEWER;

        try {
            ProjectMember member = projectService.inviteMember(id, userId, role, invitedBy);
            return ResponseEntity.status(HttpStatus.CREATED).body(member);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }
    }

    /**
     * Accept invitation.
     */
    @PostMapping("/invitations/{token}/accept")
    public ResponseEntity<ProjectMember> acceptInvitation(
            @PathVariable String token,
            @RequestParam String userId
    ) {
        try {
            ProjectMember member = projectService.acceptInvitation(token, userId);
            return ResponseEntity.ok(member);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Remove member.
     */
    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<Void> removeMember(
            @PathVariable Long id,
            @PathVariable String userId,
            @RequestParam String removedBy
    ) {
        try {
            projectService.removeMember(id, userId, removedBy);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Update member role.
     */
    @PutMapping("/{id}/members/{userId}/role")
    public ResponseEntity<ProjectMember> updateMemberRole(
            @PathVariable Long id,
            @PathVariable String userId,
            @RequestBody Map<String, String> body,
            @RequestParam String updatedBy
    ) {
        String roleStr = body.get("role");
        if (roleStr == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            ProjectMember.MemberRole role = ProjectMember.MemberRole.valueOf(roleStr.toUpperCase());
            ProjectMember member = projectService.updateMemberRole(id, userId, role, updatedBy);
            return ResponseEntity.ok(member);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    // ============================================
    // Item Management
    // ============================================

    /**
     * Add item to project.
     */
    @PostMapping("/{id}/items")
    public ResponseEntity<ProjectItem> addItem(
            @PathVariable Long id,
            @RequestBody AddItemRequest request,
            @RequestParam String userId
    ) {
        try {
            ProjectItem item = projectService.addItem(id, request, userId);
            return ResponseEntity.status(HttpStatus.CREATED).body(item);
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Get project items.
     */
    @GetMapping("/{id}/items")
    public ResponseEntity<PageResponse<ProjectItem>> getItems(
            @PathVariable Long id,
            @RequestParam(required = false) String type,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectItem> result;

        if (type != null) {
            ProjectItem.ItemType itemType = ProjectItem.ItemType.valueOf(type.toUpperCase());
            result = projectService.getItemsByType(id, itemType, page, size);
        } else {
            result = projectService.getItems(id, page, size);
        }

        PageResponse<ProjectItem> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Search items.
     */
    @GetMapping("/{id}/items/search")
    public ResponseEntity<PageResponse<ProjectItem>> searchItems(
            @PathVariable Long id,
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectItem> result = projectService.searchItems(id, q, page, size);

        PageResponse<ProjectItem> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Mark item as read.
     */
    @PostMapping("/{projectId}/items/{itemId}/read")
    public ResponseEntity<Void> markItemAsRead(
            @PathVariable Long projectId,
            @PathVariable Long itemId,
            @RequestParam String userId
    ) {
        projectService.markItemAsRead(itemId, userId);
        return ResponseEntity.ok().build();
    }

    /**
     * Toggle item bookmark.
     */
    @PostMapping("/{projectId}/items/{itemId}/bookmark")
    public ResponseEntity<Void> toggleItemBookmark(
            @PathVariable Long projectId,
            @PathVariable Long itemId,
            @RequestParam String userId
    ) {
        projectService.toggleItemBookmark(itemId, userId);
        return ResponseEntity.ok().build();
    }

    /**
     * Delete item.
     */
    @DeleteMapping("/{projectId}/items/{itemId}")
    public ResponseEntity<Void> deleteItem(
            @PathVariable Long projectId,
            @PathVariable Long itemId,
            @RequestParam String userId
    ) {
        try {
            projectService.deleteItem(projectId, itemId, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    // ============================================
    // Activity Log
    // ============================================

    /**
     * Get project activity log.
     */
    @GetMapping("/{id}/activities")
    public ResponseEntity<PageResponse<ProjectActivityLog>> getActivityLog(
            @PathVariable Long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectActivityLog> result = projectService.getActivityLog(id, page, size);

        PageResponse<ProjectActivityLog> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get recent activity.
     */
    @GetMapping("/{id}/activities/recent")
    public ResponseEntity<List<ProjectActivityLog>> getRecentActivity(@PathVariable Long id) {
        List<ProjectActivityLog> activities = projectService.getRecentActivity(id);
        return ResponseEntity.ok(activities);
    }

    // ============================================
    // Notifications
    // ============================================

    /**
     * Get user notifications.
     */
    @GetMapping("/notifications")
    public ResponseEntity<PageResponse<ProjectNotification>> getUserNotifications(
            @RequestParam String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<ProjectNotification> result = projectService.getUserNotifications(userId, page, size);

        PageResponse<ProjectNotification> response = new PageResponse<>(
                result.getContent(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.isFirst(),
                result.isLast(),
                result.hasNext(),
                result.hasPrevious()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get unread notifications.
     */
    @GetMapping("/notifications/unread")
    public ResponseEntity<List<ProjectNotification>> getUnreadNotifications(@RequestParam String userId) {
        List<ProjectNotification> notifications = projectService.getUnreadNotifications(userId);
        return ResponseEntity.ok(notifications);
    }

    /**
     * Mark notification as read.
     */
    @PostMapping("/notifications/{notificationId}/read")
    public ResponseEntity<Void> markNotificationAsRead(@PathVariable Long notificationId) {
        projectService.markNotificationAsRead(notificationId);
        return ResponseEntity.ok().build();
    }

    /**
     * Mark all notifications as read.
     */
    @PostMapping("/notifications/read-all")
    public ResponseEntity<Void> markAllNotificationsAsRead(@RequestParam String userId) {
        projectService.markAllNotificationsAsRead(userId);
        return ResponseEntity.ok().build();
    }

    // ============================================
    // Health
    // ============================================

    /**
     * Health check.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "projects", true,
                        "members", true,
                        "items", true,
                        "activities", true,
                        "notifications", true
                )
        ));
    }
}
