import { useState, useCallback, useMemo } from "react";
import type {
  FactCheckAnalytics,
  SourceCredibilityAnalysis,
  ClickbaitAnalysis,
  MisinformationAnalysis,
  ClaimAnalysis,
  ScoreBreakdown,
} from "@/components/FactCheckAnalyticsPanel";
import type {
  DetailedAnalytics,
  FactcheckResult,
  FactcheckAddonResponse,
} from "@/types/api";

// Trusted sources list (matches backend)
const TRUSTED_SOURCES = [
  "연합뉴스", "한국일보", "경향신문", "한겨레", "동아일보",
  "조선일보", "중앙일보", "매일경제", "한국경제", "KBS",
  "MBC", "SBS", "YTN", "JTBC", "채널A", "MBN", "TV조선"
];

// Clickbait patterns
const CLICKBAIT_PATTERNS = [
  { pattern: "충격", severity: "high" as const },
  { pattern: "경악", severity: "high" as const },
  { pattern: "대박", severity: "medium" as const },
  { pattern: "헉", severity: "low" as const },
  { pattern: "알고\\s*보니", severity: "medium" as const },
  { pattern: "결국", severity: "low" as const },
  { pattern: "드디어", severity: "low" as const },
  { pattern: "\\.\\.\\.+$", severity: "low" as const },
  { pattern: "\\?\\?\\?+", severity: "medium" as const },
  { pattern: "!!!+", severity: "medium" as const },
  { pattern: "속보", severity: "low" as const },
  { pattern: "단독", severity: "low" as const },
  { pattern: "긴급", severity: "medium" as const },
];

// Misinformation patterns
const MISINFO_PATTERNS = [
  { pattern: "정부가\\s*숨기", type: "misinformation" as const, severity: "high" as const },
  { pattern: "언론이\\s*보도하지\\s*않는", type: "misinformation" as const, severity: "high" as const },
  { pattern: "비밀리에", type: "misinformation" as const, severity: "medium" as const },
  { pattern: "충격\\s*진실", type: "misinformation" as const, severity: "high" as const },
  { pattern: "알려지지\\s*않은\\s*진실", type: "misinformation" as const, severity: "high" as const },
];

const UNVERIFIABLE_PATTERNS = [
  { pattern: "최초", type: "unverifiable" as const, severity: "low" as const },
  { pattern: "유일", type: "unverifiable" as const, severity: "low" as const },
  { pattern: "최고", type: "unverifiable" as const, severity: "low" as const },
  { pattern: "최대", type: "unverifiable" as const, severity: "low" as const },
  { pattern: "100%", type: "unverifiable" as const, severity: "medium" as const },
  { pattern: "모든\\s*사람", type: "unverifiable" as const, severity: "medium" as const },
  { pattern: "아무도", type: "unverifiable" as const, severity: "medium" as const },
  { pattern: "절대", type: "unverifiable" as const, severity: "medium" as const },
  { pattern: "반드시", type: "unverifiable" as const, severity: "low" as const },
];

// Claim indicators
const CLAIM_INDICATORS = [
  "라고 밝혔다", "라고 주장했다", "라고 전했다",
  "에 따르면", "것으로 알려졌다", "것으로 확인됐다",
  "것으로 보인다", "할 전망이다", "할 예정이다",
  "관계자는", "전문가는", "소식통에 따르면"
];

interface VerificationResult {
  claimId: string;
  originalClaim: string;
  status: string;
  confidenceScore: number;
  supportingEvidence: unknown[];
  contradictingEvidence: unknown[];
  verificationSummary: string;
  relatedConcepts: string[];
}

interface UseFactCheckAnalyticsOptions {
  topic?: string;
  sourceName?: string;
  content?: string;
  title?: string;
}

/**
 * Convert backend DetailedAnalytics to frontend FactCheckAnalytics format
 */
function convertBackendAnalytics(backend: DetailedAnalytics): FactCheckAnalytics {
  // Convert source analysis
  const sourceAnalysis: SourceCredibilityAnalysis = {
    sourceName: backend.source_analysis.source_name || "알 수 없음",
    isTrusted: backend.source_analysis.is_trusted,
    trustScore: backend.source_analysis.trust_score,
    trustLevel: backend.source_analysis.trust_level,
    reason: backend.source_analysis.reason,
    matchedTrustedSource: backend.source_analysis.matched_trusted_source,
  };

  // Convert clickbait analysis
  const clickbaitAnalysis: ClickbaitAnalysis = {
    isClickbait: backend.clickbait_analysis.is_clickbait,
    score: backend.clickbait_analysis.score,
    detectedPatterns: backend.clickbait_analysis.detected_patterns.map(p => ({
      pattern: p.pattern,
      matchedText: p.matched_text,
      severity: p.severity,
    })),
    totalPatternsChecked: backend.clickbait_analysis.total_patterns_checked,
  };

  // Convert misinfo analysis
  const misinfoAnalysis: MisinformationAnalysis = {
    riskScore: backend.misinfo_analysis.risk_score,
    riskLevel: backend.misinfo_analysis.risk_level,
    detectedPatterns: backend.misinfo_analysis.detected_patterns.map(p => ({
      type: p.type,
      pattern: p.pattern,
      matchedText: p.matched_text,
      severity: p.severity,
    })),
    unverifiableClaimCount: backend.misinfo_analysis.unverifiable_claim_count,
  };

  // Convert claim analyses
  const claimAnalyses: ClaimAnalysis[] = backend.claim_analyses.map(c => ({
    claimId: c.claim_id,
    claimText: c.claim_text,
    verdict: c.verdict as ClaimAnalysis["verdict"],
    confidence: c.confidence,
    claimIndicator: c.claim_indicator || "직접 주장",
    analysisMethod: c.analysis_method,
    supportingFactors: c.supporting_factors,
    contradictingFactors: c.contradicting_factors,
  }));

  // Convert score breakdown
  const scoreBreakdown: ScoreBreakdown = {
    sourceWeight: backend.score_breakdown.source_weight,
    clickbaitWeight: backend.score_breakdown.clickbait_weight,
    misinfoWeight: backend.score_breakdown.misinfo_weight,
    verificationWeight: backend.score_breakdown.verification_weight,
    sourceContribution: backend.score_breakdown.source_contribution,
    clickbaitContribution: backend.score_breakdown.clickbait_contribution,
    misinfoContribution: backend.score_breakdown.misinfo_contribution,
    verificationContribution: backend.score_breakdown.verification_contribution,
    totalScore: backend.score_breakdown.total_score,
    grade: backend.score_breakdown.grade as ScoreBreakdown["grade"],
  };

  return {
    sourceAnalysis,
    clickbaitAnalysis,
    misinfoAnalysis,
    claimAnalyses,
    scoreBreakdown,
    analysisVersion: `${backend.analysis_mode}-v2.0`,
    processingTimeMs: backend.processing_time_ms,
    analyzedAt: backend.analyzed_at,
    // Add ML metadata
    mlModelsUsed: backend.ml_models_used,
    externalApisUsed: backend.external_apis_used,
  };
}

/**
 * Hook to analyze content and generate detailed factcheck analytics
 */
export function useFactCheckAnalytics() {
  const [analytics, setAnalytics] = useState<FactCheckAnalytics | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Analyze source credibility (client-side fallback)
   */
  const analyzeSource = useCallback((sourceName?: string): SourceCredibilityAnalysis => {
    if (!sourceName) {
      return {
        sourceName: "알 수 없음",
        isTrusted: false,
        trustScore: 0.3,
        trustLevel: "untrusted",
        reason: "출처 정보가 제공되지 않았습니다. 신뢰도를 평가할 수 없습니다.",
      };
    }

    const matchedSource = TRUSTED_SOURCES.find(s => 
      sourceName.includes(s) || s.includes(sourceName)
    );

    if (matchedSource) {
      return {
        sourceName,
        isTrusted: true,
        trustScore: 0.9,
        trustLevel: "trusted",
        reason: `${matchedSource}은(는) 신뢰할 수 있는 주요 언론사로 분류됩니다.`,
        matchedTrustedSource: matchedSource,
      };
    }

    return {
      sourceName,
      isTrusted: false,
      trustScore: 0.5,
      trustLevel: "unknown",
      reason: "신뢰 매체 목록에 없는 출처입니다. 추가 확인이 필요합니다.",
    };
  }, []);

  /**
   * Detect clickbait patterns (client-side fallback)
   */
  const analyzeClickbait = useCallback((title?: string, content?: string): ClickbaitAnalysis => {
    const text = `${title || ""} ${content || ""}`;
    const detectedPatterns: ClickbaitAnalysis["detectedPatterns"] = [];

    for (const { pattern, severity } of CLICKBAIT_PATTERNS) {
      const regex = new RegExp(pattern, "gi");
      const matches = text.match(regex);
      if (matches) {
        detectedPatterns.push({
          pattern,
          matchedText: matches[0],
          severity,
        });
      }
    }

    const score = Math.min(detectedPatterns.length * 0.15, 1);
    const isClickbait = score > 0.3 || detectedPatterns.some(p => p.severity === "high");

    return {
      isClickbait,
      score,
      detectedPatterns,
      totalPatternsChecked: CLICKBAIT_PATTERNS.length,
    };
  }, []);

  /**
   * Analyze misinformation risk (client-side fallback)
   */
  const analyzeMisinformation = useCallback((title?: string, content?: string): MisinformationAnalysis => {
    const text = `${title || ""} ${content || ""}`;
    const detectedPatterns: MisinformationAnalysis["detectedPatterns"] = [];

    // Check misinformation patterns
    for (const { pattern, type, severity } of MISINFO_PATTERNS) {
      const regex = new RegExp(pattern, "gi");
      const matches = text.match(regex);
      if (matches) {
        detectedPatterns.push({
          type,
          pattern,
          matchedText: matches[0],
          severity,
        });
      }
    }

    // Check unverifiable patterns
    for (const { pattern, type, severity } of UNVERIFIABLE_PATTERNS) {
      const regex = new RegExp(pattern, "gi");
      const matches = text.match(regex);
      if (matches) {
        detectedPatterns.push({
          type,
          pattern,
          matchedText: matches[0],
          severity,
        });
      }
    }

    const misinfoCount = detectedPatterns.filter(p => p.type === "misinformation").length;
    const unverifiableCount = detectedPatterns.filter(p => p.type === "unverifiable").length;

    const riskScore = Math.min(
      (misinfoCount * 0.25) + (unverifiableCount * 0.1),
      1
    );

    const riskLevel: MisinformationAnalysis["riskLevel"] = 
      riskScore > 0.5 ? "high" : riskScore > 0.2 ? "medium" : "low";

    return {
      riskScore,
      riskLevel,
      detectedPatterns,
      unverifiableClaimCount: unverifiableCount,
    };
  }, []);

  /**
   * Analyze individual claims from verification results (client-side fallback)
   */
  const analyzeClaims = useCallback((
    verificationResults: VerificationResult[]
  ): ClaimAnalysis[] => {
    return verificationResults.map(result => {
      // Find which claim indicator was used
      const claimIndicator = CLAIM_INDICATORS.find(indicator =>
        result.originalClaim.includes(indicator)
      ) || "직접 주장";

      // Determine verdict from status
      type VerdictType = "verified" | "false" | "unverified" | "misleading" | "partially_true";
      const verdictMap: Record<string, VerdictType> = {
        VERIFIED: "verified",
        PARTIALLY_VERIFIED: "partially_true",
        UNVERIFIED: "unverified",
        DISPUTED: "misleading",
        FALSE: "false",
      };

      const verdict: VerdictType = verdictMap[result.status] || "unverified";

      // Generate analysis method description
      const analysisMethod = `${result.supportingEvidence.length}개 지지 근거, ` +
        `${result.contradictingEvidence.length}개 반박 근거를 기반으로 분석`;

      // Generate supporting/contradicting factors
      const supportingFactors = result.supportingEvidence.length > 0
        ? [`${result.supportingEvidence.length}개의 신뢰할 수 있는 출처에서 지지`]
        : [];

      const contradictingFactors = result.contradictingEvidence.length > 0
        ? [`${result.contradictingEvidence.length}개의 출처에서 반박`]
        : [];

      if (result.confidenceScore >= 0.8) {
        supportingFactors.push("높은 신뢰도 (80% 이상)");
      }

      if (result.relatedConcepts.length > 0) {
        supportingFactors.push(`관련 개념 ${result.relatedConcepts.length}개 확인됨`);
      }

      return {
        claimId: result.claimId,
        claimText: result.originalClaim,
        verdict,
        confidence: result.confidenceScore,
        claimIndicator,
        analysisMethod,
        supportingFactors,
        contradictingFactors,
      };
    });
  }, []);

  /**
   * Calculate score breakdown (client-side fallback)
   */
  const calculateScoreBreakdown = useCallback((
    sourceAnalysis: SourceCredibilityAnalysis,
    clickbaitAnalysis: ClickbaitAnalysis,
    misinfoAnalysis: MisinformationAnalysis,
    claimAnalyses: ClaimAnalysis[]
  ): ScoreBreakdown => {
    const sourceWeight = 30;
    const clickbaitWeight = 20;
    const misinfoWeight = 20;
    const verificationWeight = 30;

    // Calculate contributions
    const sourceContribution = sourceAnalysis.trustScore * sourceWeight;
    
    const clickbaitScore = clickbaitAnalysis.isClickbait ? 0.7 : 1;
    const clickbaitContribution = clickbaitScore * clickbaitWeight;
    
    const misinfoScore = 1 - misinfoAnalysis.riskScore;
    const misinfoContribution = misinfoScore * misinfoWeight;
    
    const verifiedCount = claimAnalyses.filter(c => c.verdict === "verified").length;
    const verificationRatio = claimAnalyses.length > 0 
      ? verifiedCount / claimAnalyses.length 
      : 0.5;
    const verificationContribution = verificationRatio * verificationWeight;

    const totalScore = Math.round(
      sourceContribution + clickbaitContribution + misinfoContribution + verificationContribution
    );

    type GradeType = "A" | "B" | "C" | "D" | "F";
    const grade: GradeType = 
      totalScore >= 80 ? "A" :
      totalScore >= 60 ? "B" :
      totalScore >= 40 ? "C" :
      totalScore >= 20 ? "D" : "F";

    return {
      sourceWeight,
      clickbaitWeight,
      misinfoWeight,
      verificationWeight,
      sourceContribution,
      clickbaitContribution,
      misinfoContribution,
      verificationContribution,
      totalScore,
      grade,
    };
  }, []);

  /**
   * Generate complete analytics from verification results (client-side fallback)
   */
  const generateAnalytics = useCallback((
    options: UseFactCheckAnalyticsOptions,
    verificationResults: VerificationResult[]
  ): FactCheckAnalytics => {
    const startTime = performance.now();

    const sourceAnalysis = analyzeSource(options.sourceName);
    const clickbaitAnalysis = analyzeClickbait(options.title, options.content);
    const misinfoAnalysis = analyzeMisinformation(options.title, options.content);
    const claimAnalyses = analyzeClaims(verificationResults);
    const scoreBreakdown = calculateScoreBreakdown(
      sourceAnalysis,
      clickbaitAnalysis,
      misinfoAnalysis,
      claimAnalyses
    );

    const processingTimeMs = Math.round(performance.now() - startTime);

    return {
      sourceAnalysis,
      clickbaitAnalysis,
      misinfoAnalysis,
      claimAnalyses,
      scoreBreakdown,
      analysisVersion: "factcheck-ko-heuristic-v1",
      processingTimeMs,
      analyzedAt: new Date().toISOString(),
    };
  }, [analyzeSource, analyzeClickbait, analyzeMisinformation, analyzeClaims, calculateScoreBreakdown]);

  /**
   * Process backend response and extract analytics
   * Use backend analytics if available, otherwise fall back to client-side generation
   */
  const processBackendResponse = useCallback((
    response: FactcheckAddonResponse | null,
    options: UseFactCheckAnalyticsOptions,
    verificationResults: VerificationResult[]
  ): FactCheckAnalytics => {
    // If backend provides detailed analytics, use them
    if (response?.results?.factcheck?.detailed_analytics) {
      return convertBackendAnalytics(response.results.factcheck.detailed_analytics);
    }

    // Fall back to client-side generation
    return generateAnalytics(options, verificationResults);
  }, [generateAnalytics]);

  /**
   * Analyze using backend response if available
   */
  const analyzeFromBackend = useCallback(async (
    backendResponse: FactcheckAddonResponse
  ) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      if (backendResponse.results?.factcheck?.detailed_analytics) {
        const result = convertBackendAnalytics(backendResponse.results.factcheck.detailed_analytics);
        setAnalytics(result);
        return result;
      } else {
        setError("Backend response does not contain detailed analytics");
        return null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "분석 처리 중 오류가 발생했습니다";
      setError(message);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  /**
   * Analyze and update state (client-side fallback)
   */
  const analyze = useCallback(async (
    options: UseFactCheckAnalyticsOptions,
    verificationResults: VerificationResult[],
    backendResponse?: FactcheckAddonResponse | null
  ) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      // Simulate async processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const result = processBackendResponse(backendResponse || null, options, verificationResults);
      setAnalytics(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "분석 중 오류가 발생했습니다";
      setError(message);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, [processBackendResponse]);

  /**
   * Reset analytics state
   */
  const reset = useCallback(() => {
    setAnalytics(null);
    setError(null);
    setIsAnalyzing(false);
  }, []);

  return {
    analytics,
    isAnalyzing,
    error,
    analyze,
    analyzeFromBackend,
    reset,
    generateAnalytics,
    processBackendResponse,
    // Expose individual analyzers for granular use
    analyzeSource,
    analyzeClickbait,
    analyzeMisinformation,
    analyzeClaims,
  };
}

/**
 * Generate mock analytics for demo/testing purposes
 * WARNING: This function should only be used in development/testing environments.
 * In production, always use real backend data.
 */
export function generateMockAnalytics(overrides?: Partial<FactCheckAnalytics>): FactCheckAnalytics {
  // Log warning in production environment
  if (import.meta.env.PROD) {
    console.warn('[generateMockAnalytics] Using mock data in production environment. This should be avoided.');
  }
  
  return {
    sourceAnalysis: {
      sourceName: "연합뉴스",
      isTrusted: true,
      trustScore: 0.9,
      trustLevel: "trusted",
      reason: "연합뉴스은(는) 신뢰할 수 있는 주요 언론사로 분류됩니다.",
      matchedTrustedSource: "연합뉴스",
    },
    clickbaitAnalysis: {
      isClickbait: false,
      score: 0.1,
      detectedPatterns: [
        { pattern: "속보", matchedText: "속보", severity: "low" }
      ],
      totalPatternsChecked: 13,
    },
    misinfoAnalysis: {
      riskScore: 0.15,
      riskLevel: "low",
      detectedPatterns: [
        { type: "unverifiable", pattern: "최초", matchedText: "최초", severity: "low" }
      ],
      unverifiableClaimCount: 1,
    },
    claimAnalyses: [
      {
        claimId: "claim-1",
        claimText: "정부는 내년 예산을 10% 증액할 예정이라고 밝혔다",
        verdict: "verified",
        confidence: 0.85,
        claimIndicator: "라고 밝혔다",
        analysisMethod: "3개 지지 근거, 0개 반박 근거를 기반으로 분석",
        supportingFactors: ["3개의 신뢰할 수 있는 출처에서 지지", "높은 신뢰도 (80% 이상)"],
        contradictingFactors: [],
      },
      {
        claimId: "claim-2",
        claimText: "전문가는 경기 회복이 예상보다 빠를 것으로 전망했다",
        verdict: "partially_true",
        confidence: 0.65,
        claimIndicator: "전문가는",
        analysisMethod: "2개 지지 근거, 1개 반박 근거를 기반으로 분석",
        supportingFactors: ["2개의 신뢰할 수 있는 출처에서 지지"],
        contradictingFactors: ["1개의 출처에서 반박"],
      },
    ],
    scoreBreakdown: {
      sourceWeight: 30,
      clickbaitWeight: 20,
      misinfoWeight: 20,
      verificationWeight: 30,
      sourceContribution: 27,
      clickbaitContribution: 18,
      misinfoContribution: 17,
      verificationContribution: 22.5,
      totalScore: 85,
      grade: "A",
    },
    analysisVersion: "factcheck-ko-heuristic-v1",
    processingTimeMs: 42,
    analyzedAt: new Date().toISOString(),
    ...overrides,
  };
}

export default useFactCheckAnalytics;
