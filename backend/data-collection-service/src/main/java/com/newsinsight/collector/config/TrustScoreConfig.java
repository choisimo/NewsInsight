package com.newsinsight.collector.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

/**
 * Configuration for externalized trust scores.
 * 
 * Trust scores range from 0.0 to 1.0 where:
 * - 0.95+ : Very high trust (academic papers, official statistics)
 * - 0.90-0.94: High trust (encyclopedias, established fact-checkers)
 * - 0.80-0.89: Good trust (reputable news fact-check)
 * - 0.60-0.79: Moderate trust (community wikis, user-generated)
 * - 0.50 : Base trust (unknown sources)
 * - < 0.50: Low trust (unverified, suspicious)
 * 
 * Hierarchy: Academic > Official Statistics > Encyclopedia > News Fact Check
 */
@Configuration
@ConfigurationProperties(prefix = "collector.trust-scores")
@Data
public class TrustScoreConfig {

    /**
     * Trust scores for fact-check sources
     */
    private FactCheckSources factCheck = new FactCheckSources();

    /**
     * Trust scores for trusted reference sources (FactVerificationService)
     */
    private TrustedSources trusted = new TrustedSources();

    /**
     * Trust scores for collected data quality assessment
     */
    private DataQuality dataQuality = new DataQuality();

    /**
     * Additional custom source scores (can be configured dynamically)
     */
    private Map<String, Double> custom = new HashMap<>();

    @Data
    public static class FactCheckSources {
        /** CrossRef academic papers - highest trust */
        private double crossref = 0.95;
        
        /** OpenAlex academic database */
        private double openalex = 0.92;
        
        /** Wikipedia encyclopedia */
        private double wikipedia = 0.90;
        
        /** Google Fact Check verified results */
        private double googleFactCheck = 0.85;
    }

    @Data
    public static class TrustedSources {
        /** Korean Wikipedia */
        private double wikipediaKo = 0.90;
        
        /** English Wikipedia */
        private double wikipediaEn = 0.90;
        
        /** Britannica encyclopedia - very high trust */
        private double britannica = 0.95;
        
        /** Namu Wiki (community wiki - moderate trust) */
        private double namuWiki = 0.60;
        
        /** KOSIS Korean Statistics - official government data */
        private double kosis = 0.95;
        
        /** Google Scholar - academic search */
        private double googleScholar = 0.85;
    }

    @Data
    public static class DataQuality {
        /** Base score for unknown/unverified sources */
        private double baseScore = 0.50;
        
        /** Score for sources in domain whitelist */
        private double whitelistScore = 0.90;
        
        /** Bonus for successful HTTP connection */
        private double httpOkBonus = 0.10;
    }

    /**
     * Get trust score for a source by its key.
     * Falls back to custom map, then to base score.
     */
    public double getScoreForSource(String sourceKey) {
        if (sourceKey == null) return dataQuality.baseScore;
        
        String key = sourceKey.toLowerCase().replace("-", "_").replace(" ", "_");
        
        // Check fact-check sources
        if (key.contains("crossref")) return factCheck.crossref;
        if (key.contains("openalex")) return factCheck.openalex;
        if (key.contains("wikipedia")) {
            if (key.contains("en")) return trusted.wikipediaEn;
            if (key.contains("ko")) return trusted.wikipediaKo;
            return factCheck.wikipedia;
        }
        if (key.contains("google") && key.contains("fact")) return factCheck.googleFactCheck;
        
        // Check trusted sources
        if (key.contains("britannica")) return trusted.britannica;
        if (key.contains("namu")) return trusted.namuWiki;
        if (key.contains("kosis")) return trusted.kosis;
        if (key.contains("scholar")) return trusted.googleScholar;
        
        // Check custom sources
        if (custom.containsKey(key)) return custom.get(key);
        
        // Default
        return dataQuality.baseScore;
    }
}
