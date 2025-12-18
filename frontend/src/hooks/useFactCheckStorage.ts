import { useState, useCallback, useEffect } from "react";
import {
  saveSearchHistorySync,
  listSearchHistory,
  deleteSearchHistory,
  type SearchHistoryRecord,
} from "@/lib/api";

/**
 * 팩트체크 결과 저장 데이터 구조
 */
export interface SavedFactCheckResult {
  id: string;
  topic: string;
  claims: string[];
  priorityUrls: string[];
  savedAt: string;
  
  // 검증 결과
  verificationResults: Array<{
    claimId: string;
    originalClaim: string;
    status: string;
    confidenceScore: number;
    verificationSummary: string;
    supportingCount: number;
    contradictingCount: number;
  }>;
  
  // 수집된 근거 요약
  evidenceSummary: {
    total: number;
    bySource: Record<string, number>;
  };
  
  // 신뢰도 평가
  credibility?: {
    overallScore: number;
    verifiedCount: number;
    totalClaims: number;
    riskLevel: "low" | "medium" | "high";
    warnings: string[];
  };
  
  // AI 결론
  aiConclusion?: string;
}

/**
 * SearchHistoryRecord를 SavedFactCheckResult로 변환
 */
const recordToFactCheck = (record: SearchHistoryRecord): SavedFactCheckResult => {
  const factCheckResults = record.factCheckResults as Array<{
    claimId: string;
    originalClaim: string;
    status: string;
    confidenceScore: number;
    verificationSummary: string;
    supportingCount: number;
    contradictingCount: number;
  }> | undefined;
  
  const metadata = record.metadata as {
    claims?: string[];
    priorityUrls?: string[];
    evidenceSummary?: { total: number; bySource: Record<string, number> };
    credibility?: {
      overallScore: number;
      verifiedCount: number;
      totalClaims: number;
      riskLevel: "low" | "medium" | "high";
      warnings: string[];
    };
    aiConclusion?: string;
  } | undefined;

  return {
    id: record.externalId || String(record.id),
    topic: record.query,
    claims: metadata?.claims || [],
    priorityUrls: metadata?.priorityUrls || record.discoveredUrls || [],
    savedAt: record.createdAt,
    verificationResults: factCheckResults || [],
    evidenceSummary: metadata?.evidenceSummary || { total: 0, bySource: {} },
    credibility: metadata?.credibility,
    aiConclusion: metadata?.aiConclusion,
  };
};

/**
 * 팩트체크 결과 저장 및 관리를 위한 훅
 * 백엔드 API를 통해 데이터를 저장하고 조회합니다.
 */
export function useFactCheckStorage() {
  const [savedResults, setSavedResults] = useState<SavedFactCheckResult[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 백엔드에서 저장된 결과 로드
  const loadResults = useCallback(async () => {
    try {
      setError(null);
      const response = await listSearchHistory(0, 50, 'createdAt', 'DESC', 'FACT_CHECK');
      const results = response.content.map(recordToFactCheck);
      setSavedResults(results);
    } catch (err) {
      console.error("Failed to load saved fact-check results:", err);
      setError(err instanceof Error ? err.message : "결과를 불러오는데 실패했습니다.");
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // 결과 저장
  const saveResult = useCallback(async (result: Omit<SavedFactCheckResult, "id" | "savedAt">) => {
    const externalId = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    try {
      setError(null);
      const savedRecord = await saveSearchHistorySync({
        externalId,
        searchType: 'FACT_CHECK',
        query: result.topic,
        resultCount: result.verificationResults.length,
        discoveredUrls: result.priorityUrls,
        factCheckResults: result.verificationResults as unknown as Array<Record<string, unknown>>,
        credibilityScore: result.credibility?.overallScore,
        metadata: {
          claims: result.claims,
          priorityUrls: result.priorityUrls,
          evidenceSummary: result.evidenceSummary,
          credibility: result.credibility,
          aiConclusion: result.aiConclusion,
        },
        success: true,
      });
      
      // 로컬 상태 업데이트
      const newResult = recordToFactCheck(savedRecord);
      setSavedResults((prev) => [newResult, ...prev].slice(0, 50));
      
      return newResult.id;
    } catch (err) {
      console.error("Failed to save fact-check result:", err);
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
      throw err;
    }
  }, []);

  // 결과 삭제
  const deleteResult = useCallback(async (id: string) => {
    try {
      setError(null);
      // ID에서 숫자 ID 추출 (externalId가 아닌 실제 DB ID가 필요)
      const resultToDelete = savedResults.find((r) => r.id === id);
      if (resultToDelete) {
        // externalId로 삭제 시도
        await deleteSearchHistory(parseInt(id) || 0);
      }
      setSavedResults((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete fact-check result:", err);
      // 로컬에서는 삭제 (백엔드 실패해도 UI 반영)
      setSavedResults((prev) => prev.filter((r) => r.id !== id));
    }
  }, [savedResults]);

  // 모든 결과 삭제 (주의: 실제로는 개별 삭제 필요)
  const clearAllResults = useCallback(async () => {
    try {
      setError(null);
      // 모든 결과를 개별적으로 삭제
      for (const result of savedResults) {
        try {
          await deleteSearchHistory(parseInt(result.id) || 0);
        } catch {
          // 개별 삭제 실패는 무시
        }
      }
      setSavedResults([]);
    } catch (err) {
      console.error("Failed to clear all results:", err);
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }, [savedResults]);

  // 특정 결과 조회
  const getResult = useCallback(
    (id: string) => savedResults.find((r) => r.id === id),
    [savedResults]
  );

  // 결과 새로고침
  const refresh = useCallback(() => {
    setIsLoaded(false);
    return loadResults();
  }, [loadResults]);

  // JSON으로 내보내기 (로컬 기능 유지)
  const exportToJson = useCallback((id?: string) => {
    const dataToExport = id 
      ? savedResults.filter((r) => r.id === id)
      : savedResults;
    
    if (dataToExport.length === 0) return null;

    const blob = new Blob(
      [JSON.stringify(dataToExport, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const filename = id 
      ? `factcheck_${id}.json`
      : `factcheck_all_${new Date().toISOString().split("T")[0]}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  }, [savedResults]);

  // Markdown으로 내보내기
  const exportToMarkdown = useCallback((id: string) => {
    const result = savedResults.find((r) => r.id === id);
    if (!result) return null;

    const lines: string[] = [
      `# 팩트체크 보고서`,
      ``,
      `**주제:** ${result.topic}`,
      `**분석 일시:** ${new Date(result.savedAt).toLocaleString("ko-KR")}`,
      ``,
      `---`,
      ``,
      `## 검증한 주장`,
      ``,
    ];

    result.claims.forEach((claim, i) => {
      lines.push(`${i + 1}. ${claim}`);
    });

    lines.push(``, `---`, ``, `## 검증 결과`);

    result.verificationResults.forEach((v, i) => {
      const statusEmoji = {
        VERIFIED: "✅",
        PARTIALLY_VERIFIED: "⚠️",
        UNVERIFIED: "❓",
        DISPUTED: "⚖️",
        FALSE: "❌",
      }[v.status] || "•";

      lines.push(
        ``,
        `### ${i + 1}. ${v.originalClaim}`,
        ``,
        `- **판정:** ${statusEmoji} ${v.status}`,
        `- **신뢰도:** ${Math.round(v.confidenceScore * 100)}%`,
        `- **지지 근거:** ${v.supportingCount}개`,
        `- **반박 근거:** ${v.contradictingCount}개`,
        ``,
        `> ${v.verificationSummary}`
      );
    });

    if (result.credibility) {
      lines.push(
        ``,
        `---`,
        ``,
        `## 전체 신뢰도 평가`,
        ``,
        `- **종합 점수:** ${Math.round(result.credibility.overallScore * 100)}%`,
        `- **검증된 주장:** ${result.credibility.verifiedCount}/${result.credibility.totalClaims}`,
        `- **위험 수준:** ${result.credibility.riskLevel}`
      );

      if (result.credibility.warnings.length > 0) {
        lines.push(``, `**주의사항:**`);
        result.credibility.warnings.forEach((w) => {
          lines.push(`- ${w}`);
        });
      }
    }

    lines.push(
      ``,
      `---`,
      ``,
      `## 수집된 근거`,
      ``,
      `**총 ${result.evidenceSummary.total}개의 근거 수집**`,
      ``
    );

    Object.entries(result.evidenceSummary.bySource).forEach(([source, count]) => {
      lines.push(`- ${source}: ${count}개`);
    });

    if (result.aiConclusion) {
      lines.push(
        ``,
        `---`,
        ``,
        `## AI 종합 분석`,
        ``,
        result.aiConclusion
      );
    }

    if (result.priorityUrls.length > 0) {
      lines.push(
        ``,
        `---`,
        ``,
        `## 참고 URL`,
        ``
      );
      result.priorityUrls.forEach((url) => {
        lines.push(`- ${url}`);
      });
    }

    lines.push(
      ``,
      `---`,
      ``,
      `*이 보고서는 NewsInsight 팩트체크 시스템에서 생성되었습니다.*`
    );

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const filename = `factcheck_${result.topic.replace(/[^a-zA-Z0-9가-힣]/g, "_")}_${new Date(result.savedAt).toISOString().split("T")[0]}.md`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  }, [savedResults]);

  // 텍스트로 내보내기
  const exportToText = useCallback((id: string) => {
    const result = savedResults.find((r) => r.id === id);
    if (!result) return null;

    const lines: string[] = [
      `팩트체크 보고서`,
      `${"=".repeat(40)}`,
      ``,
      `주제: ${result.topic}`,
      `분석 일시: ${new Date(result.savedAt).toLocaleString("ko-KR")}`,
      ``,
      `${"─".repeat(40)}`,
      ``,
      `[ 검증한 주장 ]`,
      ``,
    ];

    result.claims.forEach((claim, i) => {
      lines.push(`${i + 1}. ${claim}`);
    });

    lines.push(``, `${"─".repeat(40)}`, ``, `[ 검증 결과 ]`);

    result.verificationResults.forEach((v, i) => {
      const statusLabel = {
        VERIFIED: "[검증됨]",
        PARTIALLY_VERIFIED: "[부분 검증]",
        UNVERIFIED: "[검증 불가]",
        DISPUTED: "[논쟁 중]",
        FALSE: "[거짓]",
      }[v.status] || v.status;

      lines.push(
        ``,
        `${i + 1}. ${v.originalClaim}`,
        `   판정: ${statusLabel}`,
        `   신뢰도: ${Math.round(v.confidenceScore * 100)}%`,
        `   지지 근거: ${v.supportingCount}개 / 반박 근거: ${v.contradictingCount}개`,
        ``,
        `   요약: ${v.verificationSummary}`
      );
    });

    if (result.credibility) {
      const riskLabel = {
        low: "낮음",
        medium: "주의",
        high: "높음",
      }[result.credibility.riskLevel] || result.credibility.riskLevel;

      lines.push(
        ``,
        `${"─".repeat(40)}`,
        ``,
        `[ 전체 신뢰도 평가 ]`,
        ``,
        `종합 점수: ${Math.round(result.credibility.overallScore * 100)}%`,
        `검증된 주장: ${result.credibility.verifiedCount}/${result.credibility.totalClaims}`,
        `위험 수준: ${riskLabel}`
      );

      if (result.credibility.warnings.length > 0) {
        lines.push(``, `주의사항:`);
        result.credibility.warnings.forEach((w) => {
          lines.push(`  - ${w}`);
        });
      }
    }

    lines.push(
      ``,
      `${"─".repeat(40)}`,
      ``,
      `[ 수집된 근거 ]`,
      ``,
      `총 ${result.evidenceSummary.total}개의 근거 수집`,
      ``
    );

    Object.entries(result.evidenceSummary.bySource).forEach(([source, count]) => {
      lines.push(`  ${source}: ${count}개`);
    });

    if (result.aiConclusion) {
      lines.push(
        ``,
        `${"─".repeat(40)}`,
        ``,
        `[ AI 종합 분석 ]`,
        ``,
        result.aiConclusion
      );
    }

    if (result.priorityUrls.length > 0) {
      lines.push(
        ``,
        `${"─".repeat(40)}`,
        ``,
        `[ 참고 URL ]`,
        ``
      );
      result.priorityUrls.forEach((url) => {
        lines.push(`  ${url}`);
      });
    }

    lines.push(
      ``,
      `${"─".repeat(40)}`,
      ``,
      `이 보고서는 NewsInsight 팩트체크 시스템에서 생성되었습니다.`
    );

    const text = lines.join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const filename = `factcheck_${result.topic.replace(/[^a-zA-Z0-9가-힣]/g, "_")}_${new Date(result.savedAt).toISOString().split("T")[0]}.txt`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  }, [savedResults]);

  return {
    savedResults,
    isLoaded,
    error,
    saveResult,
    deleteResult,
    clearAllResults,
    getResult,
    refresh,
    exportToJson,
    exportToMarkdown,
    exportToText,
  };
}
