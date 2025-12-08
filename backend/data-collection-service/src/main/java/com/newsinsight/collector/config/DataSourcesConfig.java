package com.newsinsight.collector.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Configuration for externalized data sources.
 * 
 * Data sources can be configured via application.yml or environment variables.
 * This replaces hardcoded sources in DataSourceSeeder with configurable ones.
 */
@Configuration
@ConfigurationProperties(prefix = "collector.data-sources")
@Data
public class DataSourcesConfig {

    /**
     * Enable/disable automatic seeding of data sources
     */
    private boolean seedEnabled = true;

    /**
     * List of predefined data source configurations
     */
    private List<DataSourceEntry> sources = new ArrayList<>();

    @Data
    public static class DataSourceEntry {
        /**
         * Display name for the source
         */
        private String name;

        /**
         * URL for the data source (RSS feed, API endpoint, etc.)
         */
        private String url;

        /**
         * Type of source: RSS, API, WEB_SCRAPER, BROWSER_AGENT
         */
        private String sourceType = "RSS";

        /**
         * Whether this source is active and should be collected
         */
        private boolean active = true;

        /**
         * Collection frequency in seconds
         */
        private int collectionFrequency = 3600;

        /**
         * Additional metadata as key-value pairs
         */
        private Map<String, String> metadata;

        /**
         * Region/country code (e.g., "korea", "international")
         */
        private String region;

        /**
         * Language code (e.g., "ko", "en")
         */
        private String language = "ko";

        /**
         * Reliability level: "high", "medium", "low"
         */
        private String reliability = "medium";

        /**
         * Category: "news_agency", "broadcast", "newspaper", "business", "tech", etc.
         */
        private String category;

        /**
         * Political stance (optional): "conservative", "progressive", "center", "center-right", "center-left"
         */
        private String stance;
    }
}
