package com.newsinsight.collector.service;

import com.newsinsight.collector.entity.workspace.WorkspaceFile;
import com.newsinsight.collector.repository.WorkspaceFileRepository;
import lombok.Builder;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for managing workspace files.
 * Handles file upload, download, deletion and metadata management.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class WorkspaceFileService {

    private final WorkspaceFileRepository fileRepository;

    @Value("${workspace.storage.path:/data/workspace}")
    private String storagePath;

    @Value("${workspace.storage.max-file-size:104857600}") // 100MB default
    private long maxFileSize;

    @Value("${workspace.storage.max-files-per-session:100}")
    private int maxFilesPerSession;

    @Value("${workspace.storage.session-file-ttl-hours:24}")
    private int sessionFileTtlHours;

    private Path rootLocation;

    @PostConstruct
    public void init() {
        this.rootLocation = Paths.get(storagePath);
        try {
            Files.createDirectories(rootLocation);
            log.info("Workspace storage initialized at: {}", rootLocation.toAbsolutePath());
        } catch (IOException e) {
            log.warn("Could not initialize workspace storage location at {}: {}. Workspace file features will be disabled.", 
                    rootLocation.toAbsolutePath(), e.getMessage());
            // Don't throw exception - allow service to start without workspace storage
            this.rootLocation = null;
        }
    }

    // ============================================
    // File Upload
    // ============================================

    /**
     * Upload a file for session-based user.
     */
    @Transactional
    public WorkspaceFile uploadFile(MultipartFile file, String sessionId, UploadRequest request) {
        return uploadFileInternal(file, sessionId, null, request);
    }

    /**
     * Upload a file for authenticated user.
     */
    @Transactional
    public WorkspaceFile uploadFileForUser(MultipartFile file, String userId, UploadRequest request) {
        return uploadFileInternal(file, null, userId, request);
    }

    /**
     * Internal upload logic.
     */
    private WorkspaceFile uploadFileInternal(MultipartFile file, String sessionId, String userId, UploadRequest request) {
        // Check if storage is available
        if (rootLocation == null) {
            throw new RuntimeException("Workspace storage is not available. Please check server configuration.");
        }
        
        // Validate file
        validateFile(file, sessionId, userId);

        String originalFilename = StringUtils.cleanPath(file.getOriginalFilename());
        String extension = getFileExtension(originalFilename);
        String storedName = generateStoredName(extension);
        String relativePath = generateRelativePath(sessionId, userId, storedName);
        Path targetPath = rootLocation.resolve(relativePath);

        try {
            // Create directories if needed
            Files.createDirectories(targetPath.getParent());

            // Calculate checksum
            String checksum = calculateChecksum(file.getInputStream());

            // Check for duplicate (same file already uploaded)
            Optional<WorkspaceFile> existing = fileRepository.findByChecksumAndOwner(checksum, sessionId, userId);
            if (existing.isPresent()) {
                log.info("Duplicate file detected, returning existing: {}", existing.get().getFileUuid());
                return existing.get();
            }

            // Save file to disk
            Files.copy(file.getInputStream(), targetPath, StandardCopyOption.REPLACE_EXISTING);
            log.info("File saved to: {}", targetPath);

            // Create entity
            WorkspaceFile workspaceFile = WorkspaceFile.builder()
                    .fileUuid(UUID.randomUUID().toString())
                    .sessionId(sessionId)
                    .userId(userId)
                    .projectId(request != null ? request.getProjectId() : null)
                    .originalName(originalFilename)
                    .storedName(storedName)
                    .extension(extension)
                    .mimeType(file.getContentType())
                    .fileSize(file.getSize())
                    .fileType(WorkspaceFile.determineFileType(extension))
                    .storageType(WorkspaceFile.StorageType.LOCAL)
                    .storagePath(relativePath)
                    .status(WorkspaceFile.FileStatus.ACTIVE)
                    .description(request != null ? request.getDescription() : null)
                    .checksum(checksum)
                    .downloadCount(0)
                    .expiresAt(sessionId != null ? LocalDateTime.now().plusHours(sessionFileTtlHours) : null)
                    .metadata(request != null ? request.getMetadata() : null)
                    .build();

            WorkspaceFile saved = fileRepository.save(workspaceFile);
            log.info("Workspace file created: id={}, uuid={}, name='{}', size={}", 
                    saved.getId(), saved.getFileUuid(), saved.getOriginalName(), saved.getHumanReadableSize());

            return saved;

        } catch (IOException e) {
            log.error("Failed to store file: {}", originalFilename, e);
            throw new RuntimeException("Failed to store file: " + originalFilename, e);
        }
    }

    // ============================================
    // File Download
    // ============================================

    /**
     * Get file for download.
     */
    @Transactional
    public FileDownloadResponse getFileForDownload(String fileUuid, String sessionId, String userId) {
        WorkspaceFile file = fileRepository.findActiveByFileUuid(fileUuid)
                .orElseThrow(() -> new IllegalArgumentException("File not found: " + fileUuid));

        // Check access
        if (!file.isAccessibleBy(sessionId, userId)) {
            throw new IllegalStateException("Access denied to file: " + fileUuid);
        }

        // Check expiration
        if (file.isExpired()) {
            throw new IllegalStateException("File has expired: " + fileUuid);
        }

        // Load file resource
        try {
            Path filePath = rootLocation.resolve(file.getStoragePath());
            Resource resource = new UrlResource(filePath.toUri());

            if (!resource.exists() || !resource.isReadable()) {
                throw new RuntimeException("Could not read file: " + fileUuid);
            }

            // Update download count
            fileRepository.incrementDownloadCount(file.getId(), LocalDateTime.now());

            return FileDownloadResponse.builder()
                    .resource(resource)
                    .filename(file.getOriginalName())
                    .contentType(file.getMimeType())
                    .fileSize(file.getFileSize())
                    .build();

        } catch (MalformedURLException e) {
            throw new RuntimeException("Could not read file: " + fileUuid, e);
        }
    }

    /**
     * Get file metadata.
     */
    public Optional<WorkspaceFile> getFile(String fileUuid) {
        return fileRepository.findActiveByFileUuid(fileUuid);
    }

    /**
     * Get file metadata with access check.
     */
    public Optional<WorkspaceFile> getFileWithAccess(String fileUuid, String sessionId, String userId) {
        return fileRepository.findActiveByFileUuid(fileUuid)
                .filter(f -> f.isAccessibleBy(sessionId, userId));
    }

    // ============================================
    // File Listing
    // ============================================

    /**
     * List files for session.
     */
    public Page<WorkspaceFile> listFilesForSession(String sessionId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return fileRepository.findBySessionIdAndStatusOrderByCreatedAtDesc(
                sessionId, WorkspaceFile.FileStatus.ACTIVE, pageable);
    }

    /**
     * List files for user.
     */
    public Page<WorkspaceFile> listFilesForUser(String userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return fileRepository.findByUserIdAndStatusOrderByCreatedAtDesc(
                userId, WorkspaceFile.FileStatus.ACTIVE, pageable);
    }

    /**
     * List files for project.
     */
    public Page<WorkspaceFile> listFilesForProject(Long projectId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return fileRepository.findByProjectIdAndStatusOrderByCreatedAtDesc(
                projectId, WorkspaceFile.FileStatus.ACTIVE, pageable);
    }

    /**
     * List files by type for session.
     */
    public Page<WorkspaceFile> listFilesByTypeForSession(String sessionId, WorkspaceFile.FileType fileType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return fileRepository.findBySessionIdAndFileTypeAndStatus(
                sessionId, fileType, WorkspaceFile.FileStatus.ACTIVE, pageable);
    }

    /**
     * Search files for session.
     */
    public Page<WorkspaceFile> searchFilesForSession(String sessionId, String query, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return fileRepository.searchByNameForSession(sessionId, query, pageable);
    }

    /**
     * Search files for user.
     */
    public Page<WorkspaceFile> searchFilesForUser(String userId, String query, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return fileRepository.searchByNameForUser(userId, query, pageable);
    }

    // ============================================
    // File Deletion
    // ============================================

    /**
     * Delete file (soft delete).
     */
    @Transactional
    public void deleteFile(String fileUuid, String sessionId, String userId) {
        WorkspaceFile file = fileRepository.findActiveByFileUuid(fileUuid)
                .orElseThrow(() -> new IllegalArgumentException("File not found: " + fileUuid));

        // Check access
        if (!file.isAccessibleBy(sessionId, userId)) {
            throw new IllegalStateException("Access denied to file: " + fileUuid);
        }

        // Soft delete
        fileRepository.updateStatus(file.getId(), WorkspaceFile.FileStatus.DELETED, LocalDateTime.now());
        log.info("File marked as deleted: uuid={}, name='{}'", fileUuid, file.getOriginalName());
    }

    /**
     * Permanently delete file (hard delete).
     */
    @Transactional
    public void permanentlyDeleteFile(Long fileId) {
        WorkspaceFile file = fileRepository.findById(fileId)
                .orElseThrow(() -> new IllegalArgumentException("File not found: " + fileId));

        // Delete physical file
        try {
            Path filePath = rootLocation.resolve(file.getStoragePath());
            Files.deleteIfExists(filePath);
            log.info("Physical file deleted: {}", filePath);
        } catch (IOException e) {
            log.error("Failed to delete physical file: {}", file.getStoragePath(), e);
        }

        // Delete database record
        fileRepository.delete(file);
        log.info("File permanently deleted: id={}, name='{}'", fileId, file.getOriginalName());
    }

    /**
     * Delete all files for session.
     */
    @Transactional
    public void deleteAllFilesForSession(String sessionId) {
        fileRepository.markDeletedBySessionId(sessionId, LocalDateTime.now());
        log.info("All files marked as deleted for session: {}", sessionId);
    }

    // ============================================
    // File Migration (Session to User)
    // ============================================

    /**
     * Transfer session files to user (when anonymous user logs in).
     */
    @Transactional
    public int transferSessionFilesToUser(String sessionId, String userId) {
        long count = fileRepository.countBySessionIdAndStatus(sessionId, WorkspaceFile.FileStatus.ACTIVE);
        
        if (count > 0) {
            fileRepository.transferSessionFilesToUser(sessionId, userId, LocalDateTime.now());
            log.info("Transferred {} files from session {} to user {}", count, sessionId, userId);
        }
        
        return (int) count;
    }

    // ============================================
    // Cleanup
    // ============================================

    /**
     * Cleanup expired files.
     */
    @Transactional
    public int cleanupExpiredFiles() {
        List<WorkspaceFile> expired = fileRepository.findExpiredFiles(LocalDateTime.now());
        
        for (WorkspaceFile file : expired) {
            fileRepository.updateStatus(file.getId(), WorkspaceFile.FileStatus.PENDING_DELETE, LocalDateTime.now());
        }
        
        log.info("Marked {} expired files for deletion", expired.size());
        return expired.size();
    }

    /**
     * Cleanup old session files (orphaned anonymous files).
     */
    @Transactional
    public int cleanupOldSessionFiles(int olderThanHours) {
        LocalDateTime threshold = LocalDateTime.now().minusHours(olderThanHours);
        List<WorkspaceFile> oldFiles = fileRepository.findOldSessionFiles(threshold);
        
        for (WorkspaceFile file : oldFiles) {
            fileRepository.updateStatus(file.getId(), WorkspaceFile.FileStatus.PENDING_DELETE, LocalDateTime.now());
        }
        
        log.info("Marked {} old session files for deletion", oldFiles.size());
        return oldFiles.size();
    }

    /**
     * Permanently delete files marked for deletion.
     */
    @Transactional
    public int purgeDeletedFiles() {
        List<WorkspaceFile> pendingDelete = fileRepository.findByStatus(WorkspaceFile.FileStatus.PENDING_DELETE);
        List<WorkspaceFile> deleted = fileRepository.findByStatus(WorkspaceFile.FileStatus.DELETED);
        
        int count = 0;
        for (WorkspaceFile file : pendingDelete) {
            permanentlyDeleteFile(file.getId());
            count++;
        }
        for (WorkspaceFile file : deleted) {
            permanentlyDeleteFile(file.getId());
            count++;
        }
        
        log.info("Purged {} files permanently", count);
        return count;
    }

    // ============================================
    // Statistics
    // ============================================

    /**
     * Get storage statistics for session.
     */
    public StorageStats getStorageStatsForSession(String sessionId) {
        long fileCount = fileRepository.countBySessionIdAndStatus(sessionId, WorkspaceFile.FileStatus.ACTIVE);
        long totalSize = fileRepository.sumFileSizeBySessionId(sessionId);
        
        return StorageStats.builder()
                .fileCount(fileCount)
                .totalSize(totalSize)
                .maxFiles(maxFilesPerSession)
                .maxFileSize(maxFileSize)
                .build();
    }

    /**
     * Get storage statistics for user.
     */
    public StorageStats getStorageStatsForUser(String userId) {
        long fileCount = fileRepository.countByUserIdAndStatus(userId, WorkspaceFile.FileStatus.ACTIVE);
        long totalSize = fileRepository.sumFileSizeByUserId(userId);
        
        return StorageStats.builder()
                .fileCount(fileCount)
                .totalSize(totalSize)
                .maxFiles(-1) // No limit for users
                .maxFileSize(maxFileSize)
                .build();
    }

    // ============================================
    // Helper Methods
    // ============================================

    private void validateFile(MultipartFile file, String sessionId, String userId) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("File is empty");
        }

        if (file.getSize() > maxFileSize) {
            throw new IllegalArgumentException(
                    String.format("File size exceeds maximum allowed (%d bytes)", maxFileSize));
        }

        // Check file count limit for session
        if (sessionId != null) {
            long currentCount = fileRepository.countBySessionIdAndStatus(sessionId, WorkspaceFile.FileStatus.ACTIVE);
            if (currentCount >= maxFilesPerSession) {
                throw new IllegalStateException(
                        String.format("Maximum file limit reached (%d files)", maxFilesPerSession));
            }
        }
    }

    private String getFileExtension(String filename) {
        if (filename == null) return "";
        int dotIndex = filename.lastIndexOf('.');
        return dotIndex > 0 ? filename.substring(dotIndex + 1).toLowerCase() : "";
    }

    private String generateStoredName(String extension) {
        String uuid = UUID.randomUUID().toString().replace("-", "");
        return extension.isEmpty() ? uuid : uuid + "." + extension;
    }

    private String generateRelativePath(String sessionId, String userId, String storedName) {
        String datePath = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy/MM/dd"));
        String ownerPath = userId != null ? "users/" + userId : "sessions/" + sessionId;
        return ownerPath + "/" + datePath + "/" + storedName;
    }

    private String calculateChecksum(InputStream inputStream) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int bytesRead;
            
            inputStream.mark(Integer.MAX_VALUE);
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }
            inputStream.reset();
            
            byte[] hashBytes = digest.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException | IOException e) {
            log.warn("Failed to calculate checksum", e);
            return null;
        }
    }

    // ============================================
    // DTOs
    // ============================================

    @Data
    @Builder
    public static class UploadRequest {
        private Long projectId;
        private String description;
        private Map<String, Object> metadata;
    }

    @Data
    @Builder
    public static class FileDownloadResponse {
        private Resource resource;
        private String filename;
        private String contentType;
        private Long fileSize;
    }

    @Data
    @Builder
    public static class StorageStats {
        private long fileCount;
        private long totalSize;
        private int maxFiles;
        private long maxFileSize;
        
        public String getHumanReadableTotalSize() {
            if (totalSize < 1024) return totalSize + " B";
            if (totalSize < 1024 * 1024) return String.format("%.1f KB", totalSize / 1024.0);
            if (totalSize < 1024 * 1024 * 1024) return String.format("%.1f MB", totalSize / (1024.0 * 1024));
            return String.format("%.1f GB", totalSize / (1024.0 * 1024 * 1024));
        }
    }
}
