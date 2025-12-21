/**
 * MCP (Model Context Protocol) API Client
 * Backend: autonomous-crawler-service /mcp/*
 *
 * MCP 서버들의 분석 기능을 프론트엔드에서 사용하기 위한 API
 * - 편향도 분석 (Bias)
 * - 팩트체크 (Factcheck)
 * - 토픽 분석 (Topic)
 * - 감성 분석 (Sentiment)
 * - NLP 기능 (요약, 개체명 추출)
 */

import { getApiClient } from '../api';

// ============================================
// Types
// ============================================

export interface MCPAddonInfo {
  name: string;
  description: string;
  available: boolean;
  tools: string[];
  port: number;
}

export interface MCPAddonResponse {
  success: boolean;
  addon_name: string;
  data: Record<string, unknown>;
  report?: string;
  error?: string;
  duration_ms: number;
}

export interface MCPHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  healthy: number;
  total: number;
  servers: Record<
    string,
    {
      status: string;
      latency_ms?: number;
      error?: string;
    }
  >;
}

export interface KeywordAnalysisRequest {
  keyword: string;
  days?: number;
  include_report?: boolean;
}

export interface TextAnalysisRequest {
  text: string;
  max_length?: number;
  min_length?: number;
}

export interface TrendingTopic {
  topic: string;
  count: number;
  trend: 'up' | 'down' | 'stable';
  category?: string;
}

export interface BiasAnalysisData {
  overall_bias: number; // -1 (좌) ~ 1 (우)
  bias_label: string;
  confidence: number;
  source_distribution: Record<string, number>;
  objectivity_score: number;
}

export interface FactcheckAnalysisData {
  reliability_score: number; // 0 ~ 1
  verified_claims: number;
  unverified_claims: number;
  source_reliability: Record<string, number>;
  citation_quality: number;
}

export interface TopicAnalysisData {
  main_topics: Array<{
    topic: string;
    relevance: number;
  }>;
  category_distribution: Record<string, number>;
  related_entities: string[];
  timeline?: Array<{
    date: string;
    count: number;
  }>;
}

export interface SentimentAnalysisData {
  overall_sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number; // -1 ~ 1
  confidence: number;
  distribution: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

export interface ComprehensiveAnalysisResult {
  success: boolean;
  success_rate: number;
  results: {
    keyword: string;
    days: number;
    bias: MCPAddonResponse | { error: string };
    factcheck: MCPAddonResponse | { error: string };
    topic: MCPAddonResponse | { error: string };
    sentiment: MCPAddonResponse | { error: string };
  };
}

// ============================================
// MCP Add-on Management
// ============================================

/**
 * 등록된 MCP Add-on 목록 조회
 * GET /mcp/addons
 */
export const listMcpAddons = async (): Promise<MCPAddonInfo[]> => {
  const client = await getApiClient();
  // autonomous-crawler API endpoint
  const response = await client.get<MCPAddonInfo[]>('/api/v1/crawler/mcp/addons');
  return response.data;
};

/**
 * MCP 서버 헬스체크
 * GET /mcp/health
 */
export const checkMcpHealth = async (): Promise<MCPHealthResponse> => {
  const client = await getApiClient();
  const response = await client.get<MCPHealthResponse>('/api/v1/crawler/mcp/health');
  return response.data;
};

// ============================================
// Bias Analysis
// ============================================

/**
 * 키워드 관련 뉴스 편향도 분석
 * POST /mcp/bias/analyze
 */
export const analyzeBias = async (
  request: KeywordAnalysisRequest
): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MCPAddonResponse>('/api/v1/crawler/mcp/bias/analyze', request);
  return response.data;
};

/**
 * 언론사별 편향 참조 데이터 조회
 * GET /mcp/bias/sources
 */
export const getSourceBiasList = async (): Promise<Record<string, unknown>[]> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/crawler/mcp/bias/sources');
  return response.data;
};

// ============================================
// Factcheck Analysis
// ============================================

/**
 * 키워드 관련 뉴스 신뢰도 분석
 * POST /mcp/factcheck/analyze
 */
export const analyzeFactcheck = async (
  request: KeywordAnalysisRequest
): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MCPAddonResponse>(
    '/api/v1/crawler/mcp/factcheck/analyze',
    request
  );
  return response.data;
};

/**
 * 언론사별 신뢰도 참조 데이터 조회
 * GET /mcp/factcheck/sources
 */
export const getSourceReliabilityList = async (): Promise<Record<string, unknown>[]> => {
  const client = await getApiClient();
  const response = await client.get('/api/v1/crawler/mcp/factcheck/sources');
  return response.data;
};

// ============================================
// Topic Analysis
// ============================================

/**
 * 키워드 관련 토픽 분석
 * POST /mcp/topics/analyze
 */
export const analyzeTopic = async (
  request: KeywordAnalysisRequest
): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MCPAddonResponse>(
    '/api/v1/crawler/mcp/topics/analyze',
    request
  );
  return response.data;
};

/**
 * 트렌딩 토픽 조회 (대시보드용)
 * GET /mcp/topics/trending
 */
export const getTrendingTopics = async (
  days: number = 1,
  limit: number = 10
): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.get<MCPAddonResponse>('/api/v1/crawler/mcp/topics/trending', {
    params: { days, limit },
  });
  return response.data;
};

/**
 * 뉴스 카테고리 목록 조회
 * GET /mcp/topics/categories
 */
export const getCategoryList = async (): Promise<string[]> => {
  const client = await getApiClient();
  const response = await client.get<string[]>('/api/v1/crawler/mcp/topics/categories');
  return response.data;
};

// ============================================
// Sentiment Analysis
// ============================================

/**
 * 키워드 관련 감성 분석
 * POST /mcp/sentiment/analyze
 */
export const analyzeSentiment = async (
  request: KeywordAnalysisRequest
): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MCPAddonResponse>(
    '/api/v1/crawler/mcp/sentiment/analyze',
    request
  );
  return response.data;
};

// ============================================
// NLP Functions
// ============================================

/**
 * 텍스트 요약
 * POST /mcp/nlp/summarize
 */
export const summarizeText = async (request: TextAnalysisRequest): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MCPAddonResponse>('/api/v1/crawler/mcp/nlp/summarize', request);
  return response.data;
};

/**
 * 개체명 추출
 * POST /mcp/nlp/entities
 */
export const extractEntities = async (text: string): Promise<MCPAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MCPAddonResponse>('/api/v1/crawler/mcp/nlp/entities', null, {
    params: { text },
  });
  return response.data;
};

// ============================================
// Comprehensive Analysis
// ============================================

/**
 * 종합 분석 (편향도 + 신뢰도 + 토픽 + 감성)
 * POST /mcp/analyze/comprehensive
 */
export const analyzeComprehensive = async (
  request: KeywordAnalysisRequest
): Promise<ComprehensiveAnalysisResult> => {
  const client = await getApiClient();
  const response = await client.post<ComprehensiveAnalysisResult>(
    '/api/v1/crawler/mcp/analyze/comprehensive',
    request
  );
  return response.data;
};

// ============================================
// Utility Functions
// ============================================

/**
 * 편향도 점수를 한글 라벨로 변환
 */
export const getBiasLabel = (score: number): string => {
  if (score < -0.6) return '매우 진보';
  if (score < -0.2) return '진보 성향';
  if (score < 0.2) return '중도';
  if (score < 0.6) return '보수 성향';
  return '매우 보수';
};

/**
 * 편향도 점수에 따른 색상 반환
 */
export const getBiasColor = (score: number): string => {
  if (score < -0.6) return 'blue';
  if (score < -0.2) return 'sky';
  if (score < 0.2) return 'gray';
  if (score < 0.6) return 'orange';
  return 'red';
};

/**
 * 신뢰도 점수를 한글 라벨로 변환
 */
export const getReliabilityLabel = (score: number): string => {
  if (score >= 0.8) return '매우 높음';
  if (score >= 0.6) return '높음';
  if (score >= 0.4) return '보통';
  if (score >= 0.2) return '낮음';
  return '매우 낮음';
};

/**
 * 신뢰도 점수에 따른 색상 반환
 */
export const getReliabilityColor = (score: number): string => {
  if (score >= 0.8) return 'green';
  if (score >= 0.6) return 'lime';
  if (score >= 0.4) return 'yellow';
  if (score >= 0.2) return 'orange';
  return 'red';
};

/**
 * 감성 점수를 한글 라벨로 변환
 */
export const getSentimentLabel = (
  sentiment: 'positive' | 'negative' | 'neutral' | string
): string => {
  const labels: Record<string, string> = {
    positive: '긍정',
    negative: '부정',
    neutral: '중립',
  };
  return labels[sentiment] || sentiment;
};

/**
 * 감성에 따른 색상 반환
 */
export const getSentimentColor = (
  sentiment: 'positive' | 'negative' | 'neutral' | string
): string => {
  const colors: Record<string, string> = {
    positive: 'green',
    negative: 'red',
    neutral: 'gray',
  };
  return colors[sentiment] || 'gray';
};

/**
 * MCP 서버 상태 아이콘/색상 반환
 */
export const getMcpServerStatus = (
  status: string
): { color: string; icon: string; label: string } => {
  switch (status) {
    case 'healthy':
      return { color: 'green', icon: 'check-circle', label: '정상' };
    case 'degraded':
      return { color: 'yellow', icon: 'exclamation-circle', label: '성능 저하' };
    case 'unhealthy':
      return { color: 'red', icon: 'x-circle', label: '오류' };
    default:
      return { color: 'gray', icon: 'question-mark-circle', label: '알 수 없음' };
  }
};
