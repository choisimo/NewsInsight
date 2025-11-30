import { useState, useEffect, useCallback, useRef } from "react";

export interface AnalysisUpdate {
  articleId: number;
  eventType: "analysis_started" | "analysis_progress" | "analysis_partial" | "analysis_complete" | "discussion_complete" | "analysis_error";
  addonKey?: string;
  progress?: number;
  analysis?: {
    reliabilityScore?: number;
    reliabilityGrade?: string;
    reliabilityColor?: string;
    sentimentLabel?: string;
    sentimentScore?: number;
    biasLabel?: string;
    biasScore?: number;
    factcheckStatus?: string;
    misinfoRisk?: string;
    riskTags?: string[];
    topics?: string[];
    summary?: string;
    fullyAnalyzed?: boolean;
  };
  discussion?: {
    totalCommentCount?: number;
    overallSentiment?: string;
    sentimentDistribution?: Record<string, number>;
    discussionQualityScore?: number;
    stanceDistribution?: Record<string, number>;
    suspiciousPatternDetected?: boolean;
  };
  error?: string;
  timestamp?: number;
}

interface UseAnalysisSSEOptions {
  articleIds: number[];
  enabled?: boolean;
  onUpdate?: (update: AnalysisUpdate) => void;
  onError?: (error: string) => void;
}

interface UseAnalysisSSEReturn {
  isConnected: boolean;
  updates: Map<number, AnalysisUpdate>;
  reconnect: () => void;
  disconnect: () => void;
}

const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL as string;
  }
  if (typeof window !== "undefined") {
    try {
      const url = new URL(window.location.href);
      url.port = "8080";
      return url.origin;
    } catch {
      // ignore
    }
  }
  return "http://localhost:8080";
};

export function useAnalysisSSE({
  articleIds,
  enabled = true,
  onUpdate,
  onError,
}: UseAnalysisSSEOptions): UseAnalysisSSEReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [updates, setUpdates] = useState<Map<number, AnalysisUpdate>>(new Map());
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!enabled || articleIds.length === 0) {
      return;
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const baseUrl = getApiBaseUrl();
    const url = new URL("/api/v1/search/analysis/stream", baseUrl);
    url.searchParams.set("articleIds", articleIds.join(","));

    const es = new EventSource(url.toString());
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Attempt to reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttempts.current += 1;
          connect();
        }, delay);
      } else {
        onError?.("Analysis stream connection failed after multiple attempts");
      }
    };

    // Handle different event types
    const handleEvent = (eventType: AnalysisUpdate["eventType"]) => (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const update: AnalysisUpdate = {
          articleId: data.articleId,
          eventType,
          ...data,
        };

        setUpdates((prev) => {
          const newMap = new Map(prev);
          const existing = newMap.get(update.articleId);
          // Merge with existing data
          newMap.set(update.articleId, { ...existing, ...update });
          return newMap;
        });

        onUpdate?.(update);
      } catch (e) {
        console.error("Failed to parse analysis event:", e);
      }
    };

    es.addEventListener("analysis_started", handleEvent("analysis_started"));
    es.addEventListener("analysis_progress", handleEvent("analysis_progress"));
    es.addEventListener("analysis_partial", handleEvent("analysis_partial"));
    es.addEventListener("analysis_complete", handleEvent("analysis_complete"));
    es.addEventListener("discussion_complete", handleEvent("discussion_complete"));
    es.addEventListener("analysis_error", handleEvent("analysis_error"));

    es.addEventListener("heartbeat", () => {
      // Just keep the connection alive
    });

    es.addEventListener("error", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        onError?.(data.error || "Unknown error");
      } catch {
        // Not a data error, handled by onerror
      }
    });
  }, [enabled, articleIds, onUpdate, onError]);

  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    disconnect();
    connect();
  }, [connect, disconnect]);

  // Connect when enabled and articleIds change
  useEffect(() => {
    if (enabled && articleIds.length > 0) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, articleIds.join(","), connect, disconnect]);

  return {
    isConnected,
    updates,
    reconnect,
    disconnect,
  };
}

export default useAnalysisSSE;
