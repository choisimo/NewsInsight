package com.newsinsight.collector.config;

import com.newsinsight.collector.entity.addon.*;
import com.newsinsight.collector.repository.MlAddonRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * Seeds the database with default ML Add-ons on application startup.
 * Registers sentiment, factcheck, and bias analysis add-ons if not already present.
 * 
 * Profiles:
 * - default: Runs automatically
 * - no-seed: Skip seeding (for production or when using external config)
 */
@Component
@Profile("!no-seed")
@RequiredArgsConstructor
@Slf4j
public class MlAddonSeeder implements ApplicationRunner {

    private final MlAddonRepository mlAddonRepository;

    @Value("${ml.addon.sentiment.host:sentiment-addon}")
    private String sentimentHost;

    @Value("${ml.addon.sentiment.port:8100}")
    private int sentimentPort;

    @Value("${ml.addon.factcheck.host:factcheck-addon}")
    private String factcheckHost;

    @Value("${ml.addon.factcheck.port:8101}")
    private int factcheckPort;

    @Value("${ml.addon.bias.host:bias-addon}")
    private String biasHost;

    @Value("${ml.addon.bias.port:8102}")
    private int biasPort;

    @Value("${ml.addon.seed.enabled:true}")
    private boolean seedEnabled;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!seedEnabled) {
            log.info("ML Add-on seeding is disabled via configuration.");
            return;
        }

        log.info("Seeding ML Add-ons...");

        List<MlAddon> defaultAddons = createDefaultAddons();

        int created = 0;
        int skipped = 0;

        for (MlAddon addon : defaultAddons) {
            if (mlAddonRepository.existsByAddonKey(addon.getAddonKey())) {
                log.debug("ML Add-on '{}' already exists, skipping.", addon.getAddonKey());
                skipped++;
            } else {
                mlAddonRepository.save(addon);
                log.info("Created ML Add-on: {} ({})", addon.getName(), addon.getAddonKey());
                created++;
            }
        }

        log.info("Successfully seeded ML Add-ons. created={}, skipped={}, total={}", 
                created, skipped, defaultAddons.size());
    }

    private List<MlAddon> createDefaultAddons() {
        return List.of(
            // ========== Sentiment Analysis Add-on ==========
            MlAddon.builder()
                .addonKey("sentiment-v1")
                .name("한국어 감정 분석")
                .description("한국어 뉴스 기사의 감정(긍정/부정/중립)을 분석합니다. " +
                        "KoBERT/KoELECTRA 기반 모델을 사용하여 정확한 감정 분석을 제공합니다.")
                .category(AddonCategory.SENTIMENT)
                .invokeType(AddonInvokeType.HTTP_SYNC)
                .endpointUrl(String.format("http://%s:%d/analyze", sentimentHost, sentimentPort))
                .healthCheckUrl(String.format("http://%s:%d/health", sentimentHost, sentimentPort))
                .authType(AddonAuthType.NONE)
                .inputSchemaVersion("1.0")
                .outputSchemaVersion("1.0")
                .timeoutMs(30000)
                .maxQps(20)
                .maxRetries(3)
                .enabled(true)
                .priority(10)
                .healthStatus(AddonHealthStatus.UNKNOWN)
                .owner("system")
                .config(Map.of(
                    "model", "koelectra-sentiment",
                    "language", "ko",
                    "min_confidence", 0.5,
                    "include_emotions", true
                ))
                .build(),

            // ========== Fact Check Add-on ==========
            MlAddon.builder()
                .addonKey("factcheck-v1")
                .name("팩트체크 분석")
                .description("뉴스 기사의 주장을 추출하고 신뢰도를 검증합니다. " +
                        "KoELECTRA, Sentence Transformers, KLUE BERT를 활용한 다중 모델 앙상블 분석.")
                .category(AddonCategory.FACTCHECK)
                .invokeType(AddonInvokeType.HTTP_SYNC)
                .endpointUrl(String.format("http://%s:%d/analyze", factcheckHost, factcheckPort))
                .healthCheckUrl(String.format("http://%s:%d/health", factcheckHost, factcheckPort))
                .authType(AddonAuthType.NONE)
                .inputSchemaVersion("1.0")
                .outputSchemaVersion("1.0")
                .timeoutMs(60000) // Factcheck may take longer due to cross-reference
                .maxQps(10)
                .maxRetries(2)
                .enabled(true)
                .priority(20)
                .healthStatus(AddonHealthStatus.UNKNOWN)
                .owner("system")
                .config(Map.of(
                    "models", List.of("koelectra", "sentence-transformers", "klue-bert"),
                    "language", "ko",
                    "extract_claims", true,
                    "cross_reference", true,
                    "min_claim_confidence", 0.6
                ))
                .build(),

            // ========== Bias Analysis Add-on ==========
            MlAddon.builder()
                .addonKey("bias-v1")
                .name("편향도 분석")
                .description("뉴스 기사의 정치적/이념적 편향도를 분석합니다. " +
                        "출처 신뢰도, 언어 패턴, 프레이밍 분석을 통한 종합 편향 점수 제공.")
                .category(AddonCategory.BIAS)
                .invokeType(AddonInvokeType.HTTP_SYNC)
                .endpointUrl(String.format("http://%s:%d/analyze", biasHost, biasPort))
                .healthCheckUrl(String.format("http://%s:%d/health", biasHost, biasPort))
                .authType(AddonAuthType.NONE)
                .inputSchemaVersion("1.0")
                .outputSchemaVersion("1.0")
                .timeoutMs(30000)
                .maxQps(15)
                .maxRetries(3)
                .enabled(true)
                .priority(30)
                .healthStatus(AddonHealthStatus.UNKNOWN)
                .owner("system")
                .config(Map.of(
                    "model", "bias-detector-ko",
                    "language", "ko",
                    "analyze_source", true,
                    "analyze_language", true,
                    "analyze_framing", true,
                    "political_spectrum", true
                ))
                .build(),

            // ========== Source Quality Add-on ==========
            MlAddon.builder()
                .addonKey("source-quality-v1")
                .name("출처 신뢰도 분석")
                .description("뉴스 출처의 신뢰도와 품질을 평가합니다. " +
                        "미디어 출처 데이터베이스와 역사적 정확도 데이터를 기반으로 분석.")
                .category(AddonCategory.SOURCE_QUALITY)
                .invokeType(AddonInvokeType.HTTP_SYNC)
                .endpointUrl(String.format("http://%s:%d/analyze/source", biasHost, biasPort))
                .healthCheckUrl(String.format("http://%s:%d/health", biasHost, biasPort))
                .authType(AddonAuthType.NONE)
                .inputSchemaVersion("1.0")
                .outputSchemaVersion("1.0")
                .timeoutMs(15000)
                .maxQps(30)
                .maxRetries(2)
                .enabled(true)
                .priority(5) // Run early as other addons may depend on source info
                .healthStatus(AddonHealthStatus.UNKNOWN)
                .owner("system")
                .config(Map.of(
                    "include_history", true,
                    "check_domain_reputation", true,
                    "check_author", false
                ))
                .build(),

            // ========== Topic Classification Add-on ==========
            MlAddon.builder()
                .addonKey("topic-classifier-v1")
                .name("주제 분류")
                .description("뉴스 기사를 정치, 경제, 사회, 문화, IT 등의 카테고리로 분류합니다.")
                .category(AddonCategory.TOPIC_CLASSIFICATION)
                .invokeType(AddonInvokeType.HTTP_SYNC)
                .endpointUrl(String.format("http://%s:%d/analyze/topic", sentimentHost, sentimentPort))
                .healthCheckUrl(String.format("http://%s:%d/health", sentimentHost, sentimentPort))
                .authType(AddonAuthType.NONE)
                .inputSchemaVersion("1.0")
                .outputSchemaVersion("1.0")
                .timeoutMs(20000)
                .maxQps(25)
                .maxRetries(3)
                .enabled(false) // Disabled by default, enable when model is ready
                .priority(15)
                .healthStatus(AddonHealthStatus.UNKNOWN)
                .owner("system")
                .config(Map.of(
                    "model", "klue-ynat",
                    "language", "ko",
                    "categories", List.of("정치", "경제", "사회", "문화", "세계", "IT/과학", "스포츠", "연예"),
                    "multi_label", true
                ))
                .build(),

            // ========== Entity Extraction (NER) Add-on ==========
            MlAddon.builder()
                .addonKey("ner-v1")
                .name("개체명 인식 (NER)")
                .description("뉴스 기사에서 인물, 조직, 장소, 날짜 등의 개체명을 추출합니다.")
                .category(AddonCategory.NER)
                .invokeType(AddonInvokeType.HTTP_SYNC)
                .endpointUrl(String.format("http://%s:%d/analyze/ner", factcheckHost, factcheckPort))
                .healthCheckUrl(String.format("http://%s:%d/health", factcheckHost, factcheckPort))
                .authType(AddonAuthType.NONE)
                .inputSchemaVersion("1.0")
                .outputSchemaVersion("1.0")
                .timeoutMs(25000)
                .maxQps(20)
                .maxRetries(3)
                .enabled(false) // Disabled by default
                .priority(8)
                .healthStatus(AddonHealthStatus.UNKNOWN)
                .owner("system")
                .config(Map.of(
                    "model", "klue-ner",
                    "language", "ko",
                    "entity_types", List.of("PERSON", "ORGANIZATION", "LOCATION", "DATE", "QUANTITY"),
                    "link_entities", true
                ))
                .build()
        );
    }
}
