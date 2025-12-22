package com.newsinsight.collector.config;

import com.newsinsight.collector.entity.settings.LlmProviderSettings;
import com.newsinsight.collector.repository.LlmProviderSettingsRepository;
import com.newsinsight.collector.util.ApiKeyEncryptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Migration runner to encrypt existing plain text API keys in the database.
 * 
 * This component runs on application startup when enabled via configuration.
 * It scans all LLM provider settings and encrypts any API keys that are
 * stored in plain text (not prefixed with "ENC:").
 * 
 * Configuration:
 * - Enable: newsinsight.encryption.migrate-on-startup=true
 * - Disable: newsinsight.encryption.migrate-on-startup=false (default)
 * 
 * The migration is idempotent - already encrypted keys are skipped.
 */
@Component
@ConditionalOnProperty(
    name = "newsinsight.encryption.migrate-on-startup",
    havingValue = "true",
    matchIfMissing = false
)
@RequiredArgsConstructor
@Slf4j
public class ApiKeyMigrationRunner implements ApplicationRunner {

    private final LlmProviderSettingsRepository repository;
    private final ApiKeyEncryptor apiKeyEncryptor;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        log.info("Starting API key encryption migration...");
        
        List<LlmProviderSettings> allSettings = repository.findAll();
        AtomicInteger migratedCount = new AtomicInteger(0);
        AtomicInteger skippedCount = new AtomicInteger(0);
        AtomicInteger errorCount = new AtomicInteger(0);
        
        for (LlmProviderSettings settings : allSettings) {
            try {
                String apiKey = settings.getApiKey();
                
                // Skip if no API key
                if (apiKey == null || apiKey.isBlank()) {
                    skippedCount.incrementAndGet();
                    continue;
                }
                
                // Skip if already encrypted
                if (apiKeyEncryptor.isEncrypted(apiKey)) {
                    skippedCount.incrementAndGet();
                    log.debug("Skipping already encrypted key for provider: {} (id: {})", 
                            settings.getProviderType(), settings.getId());
                    continue;
                }
                
                // Encrypt the plain text API key
                String encryptedKey = apiKeyEncryptor.encrypt(apiKey);
                settings.setApiKey(encryptedKey);
                repository.save(settings);
                
                migratedCount.incrementAndGet();
                log.info("Migrated API key for provider: {} (id: {}, user: {})", 
                        settings.getProviderType(), 
                        settings.getId(),
                        settings.getUserId() != null ? settings.getUserId() : "GLOBAL");
                
            } catch (Exception e) {
                errorCount.incrementAndGet();
                log.error("Failed to migrate API key for settings id: {}, provider: {}", 
                        settings.getId(), settings.getProviderType(), e);
            }
        }
        
        log.info("API key encryption migration completed:");
        log.info("  - Total settings found: {}", allSettings.size());
        log.info("  - Successfully migrated: {}", migratedCount.get());
        log.info("  - Skipped (no key or already encrypted): {}", skippedCount.get());
        log.info("  - Errors: {}", errorCount.get());
        
        if (errorCount.get() > 0) {
            log.warn("Some API keys failed to migrate. Please check the logs for details.");
        }
    }
}
