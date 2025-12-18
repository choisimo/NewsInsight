import { useState, useCallback, useEffect } from "react";
import {
  saveSearchHistorySync,
  listSearchHistory,
  deleteSearchHistory,
  updateSearchTags,
  updateSearchNotes,
  type SearchHistoryRecord,
} from "@/lib/api";

/**
 * Browser Agent 작업 결과 저장 데이터 구조
 */
export interface SavedAgentResult {
  id: string;
  dbId?: number; // 백엔드 DB ID
  savedAt: string;
  
  // 작업 정보
  task: string;
  startUrl?: string;
  jobId: string;
  
  // 실행 결과
  status: "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  
  // 실행 통계
  executionStats: {
    totalSteps: number;
    maxSteps: number;
    durationMs?: number;
    startedAt?: string;
    completedAt?: string;
  };
  
  // 방문한 URL 목록
  visitedUrls: string[];
  
  // 마지막 스크린샷 (base64, 선택적)
  lastScreenshot?: string;
  
  // 태그 (사용자 분류용)
  tags?: string[];
  
  // 메모
  notes?: string;
}

/**
 * 결과 저장 시 필요한 입력 데이터
 */
export interface SaveAgentResultInput {
  task: string;
  startUrl?: string;
  jobId: string;
  status: "completed" | "failed" | "cancelled";
  result?: string;
  error?: string;
  executionStats: {
    totalSteps: number;
    maxSteps: number;
    durationMs?: number;
    startedAt?: string;
    completedAt?: string;
  };
  visitedUrls: string[];
  lastScreenshot?: string;
  tags?: string[];
  notes?: string;
}

const MAX_SCREENSHOT_SIZE = 500000; // 500KB limit for screenshots

/**
 * SearchHistoryRecord를 SavedAgentResult로 변환
 */
const recordToAgentResult = (record: SearchHistoryRecord): SavedAgentResult => {
  const metadata = record.metadata as {
    task?: string;
    startUrl?: string;
    status?: "completed" | "failed" | "cancelled";
    result?: string;
    error?: string;
    executionStats?: {
      totalSteps: number;
      maxSteps: number;
      durationMs?: number;
      startedAt?: string;
      completedAt?: string;
    };
    visitedUrls?: string[];
    lastScreenshot?: string;
  } | undefined;

  return {
    id: record.externalId || String(record.id),
    dbId: record.id,
    savedAt: record.createdAt,
    task: record.query,
    startUrl: metadata?.startUrl,
    jobId: record.externalId || String(record.id),
    status: metadata?.status || (record.success ? "completed" : "failed"),
    result: metadata?.result,
    error: record.errorMessage || metadata?.error,
    executionStats: metadata?.executionStats || {
      totalSteps: 0,
      maxSteps: 0,
      durationMs: record.durationMs,
    },
    visitedUrls: record.discoveredUrls || metadata?.visitedUrls || [],
    lastScreenshot: metadata?.lastScreenshot,
    tags: record.tags,
    notes: record.notes,
  };
};

/**
 * Browser Agent 결과 저장 및 관리를 위한 훅
 * 백엔드 API를 통해 데이터를 저장하고 조회합니다.
 */
export function useAgentResultsStorage() {
  const [savedResults, setSavedResults] = useState<SavedAgentResult[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 백엔드에서 저장된 결과 로드
  const loadResults = useCallback(async () => {
    try {
      setError(null);
      const response = await listSearchHistory(0, 100, 'createdAt', 'DESC', 'BROWSER_AGENT');
      const results = response.content.map(recordToAgentResult);
      setSavedResults(results);
    } catch (err) {
      console.error("Failed to load saved agent results:", err);
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
  const saveResult = useCallback(async (input: SaveAgentResultInput): Promise<string> => {
    // 스크린샷 크기 제한
    let screenshot = input.lastScreenshot;
    if (screenshot && screenshot.length > MAX_SCREENSHOT_SIZE) {
      screenshot = undefined; // 너무 크면 저장하지 않음
    }

    const externalId = `agent_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      setError(null);
      const savedRecord = await saveSearchHistorySync({
        externalId,
        searchType: 'BROWSER_AGENT',
        query: input.task,
        discoveredUrls: input.visitedUrls,
        durationMs: input.executionStats.durationMs,
        errorMessage: input.error,
        success: input.status === "completed",
        metadata: {
          task: input.task,
          startUrl: input.startUrl,
          status: input.status,
          result: input.result,
          error: input.error,
          executionStats: input.executionStats,
          visitedUrls: input.visitedUrls,
          lastScreenshot: screenshot,
        },
      });

      // 로컬 상태 업데이트
      const newResult = recordToAgentResult(savedRecord);
      setSavedResults((prev) => [newResult, ...prev].slice(0, 100));

      return newResult.id;
    } catch (err) {
      console.error("Failed to save agent result:", err);
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
      throw err;
    }
  }, []);

  // 결과 삭제
  const deleteResult = useCallback(async (id: string) => {
    try {
      setError(null);
      const resultToDelete = savedResults.find((r) => r.id === id);
      if (resultToDelete?.dbId) {
        await deleteSearchHistory(resultToDelete.dbId);
      }
      setSavedResults((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete agent result:", err);
      // 로컬에서는 삭제 (백엔드 실패해도 UI 반영)
      setSavedResults((prev) => prev.filter((r) => r.id !== id));
    }
  }, [savedResults]);

  // 여러 결과 삭제
  const deleteResults = useCallback(async (ids: string[]) => {
    try {
      setError(null);
      for (const id of ids) {
        const resultToDelete = savedResults.find((r) => r.id === id);
        if (resultToDelete?.dbId) {
          try {
            await deleteSearchHistory(resultToDelete.dbId);
          } catch {
            // 개별 삭제 실패는 무시
          }
        }
      }
      setSavedResults((prev) => prev.filter((r) => !ids.includes(r.id)));
    } catch (err) {
      console.error("Failed to delete agent results:", err);
      setSavedResults((prev) => prev.filter((r) => !ids.includes(r.id)));
    }
  }, [savedResults]);

  // 모든 결과 삭제
  const clearAllResults = useCallback(async () => {
    try {
      setError(null);
      for (const result of savedResults) {
        if (result.dbId) {
          try {
            await deleteSearchHistory(result.dbId);
          } catch {
            // 개별 삭제 실패는 무시
          }
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

  // 결과 업데이트 (태그, 메모 등)
  const updateResult = useCallback(async (id: string, updates: Partial<Pick<SavedAgentResult, "tags" | "notes">>) => {
    try {
      setError(null);
      const resultToUpdate = savedResults.find((r) => r.id === id);
      if (resultToUpdate?.dbId) {
        // 태그와 메모를 개별 API로 업데이트
        if (updates.tags !== undefined) {
          await updateSearchTags(resultToUpdate.dbId, updates.tags);
        }
        if (updates.notes !== undefined) {
          await updateSearchNotes(resultToUpdate.dbId, updates.notes);
        }
      }
      setSavedResults((prev) => 
        prev.map((r) => r.id === id ? { ...r, ...updates } : r)
      );
    } catch (err) {
      console.error("Failed to update agent result:", err);
      // 로컬에서는 업데이트 (백엔드 실패해도 UI 반영)
      setSavedResults((prev) => 
        prev.map((r) => r.id === id ? { ...r, ...updates } : r)
      );
    }
  }, [savedResults]);

  // 결과 새로고침
  const refresh = useCallback(() => {
    setIsLoaded(false);
    return loadResults();
  }, [loadResults]);

  // 태그로 필터링
  const getResultsByTag = useCallback(
    (tag: string) => savedResults.filter((r) => r.tags?.includes(tag)),
    [savedResults]
  );

  // 상태로 필터링
  const getResultsByStatus = useCallback(
    (status: SavedAgentResult["status"]) => savedResults.filter((r) => r.status === status),
    [savedResults]
  );

  // 모든 태그 목록
  const getAllTags = useCallback(() => {
    const tags = new Set<string>();
    savedResults.forEach((r) => r.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [savedResults]);

  // JSON으로 내보내기 (로컬 기능 유지)
  const exportToJson = useCallback((id?: string) => {
    const dataToExport = id 
      ? savedResults.filter((r) => r.id === id)
      : savedResults;
    
    if (dataToExport.length === 0) return null;

    // 스크린샷 및 dbId 제외한 데이터로 내보내기
    const exportData = dataToExport.map(({ lastScreenshot, dbId, ...rest }) => rest);

    const blob = new Blob(
      [JSON.stringify(exportData, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const filename = id 
      ? `agent_result_${id}.json`
      : `agent_results_${new Date().toISOString().split("T")[0]}.json`;

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

    const statusEmoji = {
      completed: "✅",
      failed: "❌",
      cancelled: "⚪",
    }[result.status];

    const lines: string[] = [
      `# Browser Agent 작업 보고서`,
      ``,
      `**작업:** ${result.task}`,
      `**상태:** ${statusEmoji} ${result.status}`,
      `**실행 일시:** ${new Date(result.savedAt).toLocaleString("ko-KR")}`,
      ``,
    ];

    if (result.startUrl) {
      lines.push(`**시작 URL:** ${result.startUrl}`, ``);
    }

    lines.push(
      `---`,
      ``,
      `## 실행 통계`,
      ``,
      `- **총 단계:** ${result.executionStats.totalSteps} / ${result.executionStats.maxSteps}`,
    );

    if (result.executionStats.durationMs) {
      const seconds = Math.round(result.executionStats.durationMs / 1000);
      lines.push(`- **소요 시간:** ${seconds}초`);
    }

    if (result.executionStats.startedAt) {
      lines.push(`- **시작 시간:** ${new Date(result.executionStats.startedAt).toLocaleString("ko-KR")}`);
    }

    if (result.executionStats.completedAt) {
      lines.push(`- **완료 시간:** ${new Date(result.executionStats.completedAt).toLocaleString("ko-KR")}`);
    }

    lines.push(``, `---`, ``, `## 방문한 URL`, ``);

    if (result.visitedUrls.length > 0) {
      result.visitedUrls.forEach((url, i) => {
        lines.push(`${i + 1}. ${url}`);
      });
    } else {
      lines.push(`_방문한 URL이 없습니다._`);
    }

    if (result.result) {
      lines.push(
        ``,
        `---`,
        ``,
        `## 추출된 결과`,
        ``,
        "```",
        result.result,
        "```"
      );
    }

    if (result.error) {
      lines.push(
        ``,
        `---`,
        ``,
        `## 오류 정보`,
        ``,
        `> ${result.error}`
      );
    }

    if (result.tags && result.tags.length > 0) {
      lines.push(
        ``,
        `---`,
        ``,
        `## 태그`,
        ``,
        result.tags.map((t) => `\`${t}\``).join(", ")
      );
    }

    if (result.notes) {
      lines.push(
        ``,
        `---`,
        ``,
        `## 메모`,
        ``,
        result.notes
      );
    }

    lines.push(
      ``,
      `---`,
      ``,
      `*이 보고서는 NewsInsight Browser Agent에서 생성되었습니다.*`,
      ``,
      `Job ID: \`${result.jobId}\``
    );

    const markdown = lines.join("\n");
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const taskSlug = result.task.substring(0, 30).replace(/[^a-zA-Z0-9가-힣]/g, "_");
    const filename = `agent_${taskSlug}_${new Date(result.savedAt).toISOString().split("T")[0]}.md`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  }, [savedResults]);

  // CSV로 내보내기 (요약 데이터)
  const exportToCsv = useCallback(() => {
    if (savedResults.length === 0) return null;

    const headers = ["ID", "작업", "상태", "시작URL", "방문URL수", "단계수", "실행일시"];
    const rows = savedResults.map((r) => [
      r.id,
      `"${r.task.replace(/"/g, '""')}"`,
      r.status,
      r.startUrl || "",
      r.visitedUrls.length.toString(),
      `${r.executionStats.totalSteps}/${r.executionStats.maxSteps}`,
      new Date(r.savedAt).toISOString(),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const filename = `agent_results_${new Date().toISOString().split("T")[0]}.csv`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return filename;
  }, [savedResults]);

  // 통계 정보
  const getStats = useCallback(() => {
    const completed = savedResults.filter((r) => r.status === "completed").length;
    const failed = savedResults.filter((r) => r.status === "failed").length;
    const cancelled = savedResults.filter((r) => r.status === "cancelled").length;
    const totalUrls = savedResults.reduce((sum, r) => sum + r.visitedUrls.length, 0);
    
    return {
      total: savedResults.length,
      completed,
      failed,
      cancelled,
      successRate: savedResults.length > 0 ? (completed / savedResults.length) * 100 : 0,
      totalUrlsVisited: totalUrls,
      averageSteps: savedResults.length > 0 
        ? savedResults.reduce((sum, r) => sum + r.executionStats.totalSteps, 0) / savedResults.length 
        : 0,
    };
  }, [savedResults]);

  return {
    savedResults,
    isLoaded,
    error,
    saveResult,
    deleteResult,
    deleteResults,
    clearAllResults,
    getResult,
    updateResult,
    refresh,
    getResultsByTag,
    getResultsByStatus,
    getAllTags,
    exportToJson,
    exportToMarkdown,
    exportToCsv,
    getStats,
  };
}
