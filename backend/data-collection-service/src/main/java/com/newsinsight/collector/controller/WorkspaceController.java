package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.PageResponse;
import com.newsinsight.collector.entity.workspace.WorkspaceFile;
import com.newsinsight.collector.service.WorkspaceFileService;
import com.newsinsight.collector.service.WorkspaceFileService.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * REST Controller for Workspace File API.
 * Provides endpoints for file upload, download, listing, and deletion.
 */
@RestController
@RequestMapping("/api/v1/workspace/files")
@RequiredArgsConstructor
@Slf4j
public class WorkspaceController {

    private final WorkspaceFileService fileService;

    // ============================================
    // File Upload
    // ============================================

    /**
     * Upload a file.
     * Supports both session-based (anonymous) and user-based uploads.
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<WorkspaceFile> uploadFile(
            @RequestParam("file") MultipartFile file,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId,
            @RequestParam(value = "description", required = false) String description
    ) {
        log.info("File upload request: name='{}', size={}, sessionId={}, userId={}",
                file.getOriginalFilename(), file.getSize(), sessionId, userId);

        if (sessionId == null && userId == null) {
            log.warn("Neither sessionId nor userId provided for file upload");
            return ResponseEntity.badRequest().build();
        }

        try {
            UploadRequest request = UploadRequest.builder()
                    .projectId(projectId)
                    .description(description)
                    .build();

            WorkspaceFile uploaded;
            if (userId != null) {
                uploaded = fileService.uploadFileForUser(file, userId, request);
            } else {
                uploaded = fileService.uploadFile(file, sessionId, request);
            }

            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);

        } catch (IllegalArgumentException e) {
            log.warn("Invalid upload request: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        } catch (IllegalStateException e) {
            log.warn("Upload denied: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        } catch (Exception e) {
            log.error("File upload failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Upload multiple files.
     */
    @PostMapping(value = "/batch", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<List<WorkspaceFile>> uploadFiles(
            @RequestParam("files") MultipartFile[] files,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId
    ) {
        log.info("Batch upload request: {} files, sessionId={}, userId={}", files.length, sessionId, userId);

        if (sessionId == null && userId == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            UploadRequest request = UploadRequest.builder()
                    .projectId(projectId)
                    .build();

            List<WorkspaceFile> uploaded = java.util.Arrays.stream(files)
                    .map(file -> {
                        if (userId != null) {
                            return fileService.uploadFileForUser(file, userId, request);
                        } else {
                            return fileService.uploadFile(file, sessionId, request);
                        }
                    })
                    .toList();

            return ResponseEntity.status(HttpStatus.CREATED).body(uploaded);

        } catch (Exception e) {
            log.error("Batch upload failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // ============================================
    // File Download
    // ============================================

    /**
     * Download a file by UUID.
     */
    @GetMapping("/{fileUuid}/download")
    public ResponseEntity<Resource> downloadFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        log.info("File download request: uuid={}, sessionId={}, userId={}", fileUuid, sessionId, userId);

        try {
            FileDownloadResponse download = fileService.getFileForDownload(fileUuid, sessionId, userId);

            String encodedFilename = URLEncoder.encode(download.getFilename(), StandardCharsets.UTF_8)
                    .replace("+", "%20");

            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(
                            download.getContentType() != null ? download.getContentType() : "application/octet-stream"))
                    .contentLength(download.getFileSize())
                    .header(HttpHeaders.CONTENT_DISPOSITION, 
                            "attachment; filename=\"" + encodedFilename + "\"; filename*=UTF-8''" + encodedFilename)
                    .body(download.getResource());

        } catch (IllegalArgumentException e) {
            log.warn("File not found: {}", fileUuid);
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            log.warn("Access denied to file: {}", fileUuid);
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        } catch (Exception e) {
            log.error("File download failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Get file metadata by UUID.
     */
    @GetMapping("/{fileUuid}")
    public ResponseEntity<WorkspaceFile> getFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        return fileService.getFileWithAccess(fileUuid, sessionId, userId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    // ============================================
    // File Listing
    // ============================================

    /**
     * List files for current session/user.
     */
    @GetMapping
    public ResponseEntity<PageResponse<WorkspaceFile>> listFiles(
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(value = "projectId", required = false) Long projectId,
            @RequestParam(value = "type", required = false) String fileType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        log.debug("List files request: sessionId={}, userId={}, projectId={}, type={}", 
                sessionId, userId, projectId, fileType);

        Page<WorkspaceFile> result;

        if (projectId != null) {
            result = fileService.listFilesForProject(projectId, page, size);
        } else if (userId != null) {
            if (fileType != null) {
                WorkspaceFile.FileType type = WorkspaceFile.FileType.valueOf(fileType.toUpperCase());
                result = fileService.listFilesByTypeForSession(userId, type, page, size);
            } else {
                result = fileService.listFilesForUser(userId, page, size);
            }
        } else if (sessionId != null) {
            if (fileType != null) {
                WorkspaceFile.FileType type = WorkspaceFile.FileType.valueOf(fileType.toUpperCase());
                result = fileService.listFilesByTypeForSession(sessionId, type, page, size);
            } else {
                result = fileService.listFilesForSession(sessionId, page, size);
            }
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(PageResponse.from(result));
    }

    /**
     * Search files by name.
     */
    @GetMapping("/search")
    public ResponseEntity<PageResponse<WorkspaceFile>> searchFiles(
            @RequestParam String q,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        Page<WorkspaceFile> result;

        if (userId != null) {
            result = fileService.searchFilesForUser(userId, q, page, size);
        } else if (sessionId != null) {
            result = fileService.searchFilesForSession(sessionId, q, page, size);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(PageResponse.from(result));
    }

    // ============================================
    // File Deletion
    // ============================================

    /**
     * Delete a file.
     */
    @DeleteMapping("/{fileUuid}")
    public ResponseEntity<Void> deleteFile(
            @PathVariable String fileUuid,
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        log.info("File delete request: uuid={}, sessionId={}, userId={}", fileUuid, sessionId, userId);

        try {
            fileService.deleteFile(fileUuid, sessionId, userId);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
    }

    /**
     * Delete all files for session (for cleanup).
     */
    @DeleteMapping("/session/{sessionId}")
    public ResponseEntity<Void> deleteAllSessionFiles(@PathVariable String sessionId) {
        log.info("Delete all files for session: {}", sessionId);
        fileService.deleteAllFilesForSession(sessionId);
        return ResponseEntity.noContent().build();
    }

    // ============================================
    // File Migration
    // ============================================

    /**
     * Transfer session files to user (when anonymous user logs in).
     */
    @PostMapping("/transfer")
    public ResponseEntity<Map<String, Object>> transferFiles(
            @RequestParam String sessionId,
            @RequestParam String userId
    ) {
        log.info("Transfer files from session {} to user {}", sessionId, userId);

        int count = fileService.transferSessionFilesToUser(sessionId, userId);
        
        return ResponseEntity.ok(Map.of(
                "transferred", count,
                "sessionId", sessionId,
                "userId", userId
        ));
    }

    // ============================================
    // Storage Statistics
    // ============================================

    /**
     * Get storage statistics.
     */
    @GetMapping("/stats")
    public ResponseEntity<StorageStats> getStorageStats(
            @RequestHeader(value = "X-Session-ID", required = false) String sessionId,
            @RequestParam(value = "userId", required = false) String userId
    ) {
        StorageStats stats;

        if (userId != null) {
            stats = fileService.getStorageStatsForUser(userId);
        } else if (sessionId != null) {
            stats = fileService.getStorageStatsForSession(sessionId);
        } else {
            return ResponseEntity.badRequest().build();
        }

        return ResponseEntity.ok(stats);
    }

    // ============================================
    // Admin Operations (Internal)
    // ============================================

    /**
     * Cleanup expired files (should be called by scheduler).
     */
    @PostMapping("/admin/cleanup/expired")
    public ResponseEntity<Map<String, Object>> cleanupExpiredFiles() {
        int count = fileService.cleanupExpiredFiles();
        return ResponseEntity.ok(Map.of("markedForDeletion", count));
    }

    /**
     * Cleanup old session files.
     */
    @PostMapping("/admin/cleanup/sessions")
    public ResponseEntity<Map<String, Object>> cleanupOldSessionFiles(
            @RequestParam(defaultValue = "48") int olderThanHours
    ) {
        int count = fileService.cleanupOldSessionFiles(olderThanHours);
        return ResponseEntity.ok(Map.of("markedForDeletion", count));
    }

    /**
     * Purge deleted files permanently.
     */
    @PostMapping("/admin/purge")
    public ResponseEntity<Map<String, Object>> purgeDeletedFiles() {
        int count = fileService.purgeDeletedFiles();
        return ResponseEntity.ok(Map.of("purged", count));
    }

    // ============================================
    // Health Check
    // ============================================

    /**
     * Health check endpoint.
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "available",
                "features", Map.of(
                        "upload", true,
                        "download", true,
                        "delete", true,
                        "search", true,
                        "transfer", true
                )
        ));
    }
}
