/**
 * ML Add-on Controller API
 * Backend: /api/v1/ml
 *
 * ML 애드온 관리 및 분석 실행 API
 */

import { getApiClient } from '../api';
import type {
  MlAddon,
  MlAddonExecution,
  MlAddonRequest,
  MlAddonResponse,
  AddonCategory,
  ExecutionStatus,
  PageResponse,
} from '@/types/api';

// ============================================
// Add-on Registry Management
// ============================================

/**
 * 모든 ML Add-on 목록 조회
 * GET /api/v1/ml/addons
 */
export const listMlAddons = async (): Promise<MlAddon[]> => {
  const client = await getApiClient();
  const response = await client.get<MlAddon[]>('/api/v1/ml/addons');
  return response.data;
};

/**
 * 특정 ML Add-on 조회
 * GET /api/v1/ml/addons/{addonKey}
 */
export const getMlAddon = async (addonKey: string): Promise<MlAddon> => {
  const client = await getApiClient();
  const response = await client.get<MlAddon>(`/api/v1/ml/addons/${addonKey}`);
  return response.data;
};

/**
 * ML Add-on 등록
 * POST /api/v1/ml/addons
 */
export interface CreateMlAddonRequest {
  addonKey: string;
  name: string;
  description?: string;
  category: AddonCategory;
  invokeType: 'HTTP_SYNC' | 'HTTP_ASYNC' | 'QUEUE' | 'FILE_POLL';
  endpointUrl?: string;
  queueTopic?: string;
  storagePath?: string;
  authType?: 'NONE' | 'API_KEY' | 'BEARER_TOKEN' | 'BASIC' | 'OAUTH2';
  authCredentials?: string;
  timeoutMs?: number;
  maxQps?: number;
  maxRetries?: number;
  dependsOn?: string[];
  enabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
  healthCheckUrl?: string;
}

export const createMlAddon = async (request: CreateMlAddonRequest): Promise<MlAddon> => {
  const client = await getApiClient();
  const response = await client.post<MlAddon>('/api/v1/ml/addons', request);
  return response.data;
};

/**
 * ML Add-on 수정
 * PUT /api/v1/ml/addons/{addonKey}
 */
export const updateMlAddon = async (
  addonKey: string,
  request: Partial<CreateMlAddonRequest>
): Promise<MlAddon> => {
  const client = await getApiClient();
  const response = await client.put<MlAddon>(`/api/v1/ml/addons/${addonKey}`, request);
  return response.data;
};

/**
 * ML Add-on 활성화/비활성화 토글
 * POST /api/v1/ml/addons/{addonKey}/toggle
 */
export const toggleMlAddon = async (addonKey: string): Promise<{
  addonKey: string;
  enabled: boolean;
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post(`/api/v1/ml/addons/${addonKey}/toggle`);
  return response.data;
};

/**
 * ML Add-on 삭제
 * DELETE /api/v1/ml/addons/{addonKey}
 */
export const deleteMlAddon = async (addonKey: string): Promise<{
  message: string;
  deletedKey: string;
}> => {
  const client = await getApiClient();
  const response = await client.delete(`/api/v1/ml/addons/${addonKey}`);
  return response.data;
};

// ============================================
// Analysis Execution
// ============================================

/**
 * 단일 기사 분석 실행
 * POST /api/v1/ml/analyze/{articleId}
 */
export const analyzeArticle = async (
  articleId: number,
  importance: 'realtime' | 'batch' = 'batch'
): Promise<{
  articleId: number;
  batchId: string;
  executionIds: string[];
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post(`/api/v1/ml/analyze/${articleId}`, null, {
    params: { importance },
  });
  return response.data;
};

/**
 * 여러 기사 일괄 분석
 * POST /api/v1/ml/analyze/batch
 */
export const analyzeArticlesBatch = async (
  articleIds: number[],
  importance: 'realtime' | 'batch' = 'batch'
): Promise<{
  batchId: string;
  articleCount: number;
  executionIds: string[];
  message: string;
}> => {
  const client = await getApiClient();
  const response = await client.post('/api/v1/ml/analyze/batch', articleIds, {
    params: { importance },
  });
  return response.data;
};

/**
 * 특정 카테고리 Add-on만 실행
 * POST /api/v1/ml/analyze/{articleId}/category/{category}
 */
export const analyzeByCategory = async (
  articleId: number,
  category: AddonCategory
): Promise<MlAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MlAddonResponse>(
    `/api/v1/ml/analyze/${articleId}/category/${category}`
  );
  return response.data;
};

/**
 * 직접 분석 요청 (커스텀 입력)
 * POST /api/v1/ml/addons/{addonKey}/analyze
 */
export const analyzeWithAddon = async (
  addonKey: string,
  request: MlAddonRequest
): Promise<MlAddonResponse> => {
  const client = await getApiClient();
  const response = await client.post<MlAddonResponse>(
    `/api/v1/ml/addons/${addonKey}/analyze`,
    request
  );
  return response.data;
};

// ============================================
// Execution History
// ============================================

/**
 * 실행 이력 조회
 * GET /api/v1/ml/executions
 */
export const listMlExecutions = async (
  page: number = 0,
  size: number = 20,
  status?: ExecutionStatus,
  addonKey?: string
): Promise<PageResponse<MlAddonExecution>> => {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, size };
  if (status) params.status = status;
  if (addonKey) params.addonKey = addonKey;

  const response = await client.get<PageResponse<MlAddonExecution>>('/api/v1/ml/executions', {
    params,
  });
  return response.data;
};

/**
 * 특정 기사의 실행 이력
 * GET /api/v1/ml/executions/article/{articleId}
 */
export const getArticleExecutions = async (articleId: number): Promise<MlAddonExecution[]> => {
  const client = await getApiClient();
  const response = await client.get<MlAddonExecution[]>(
    `/api/v1/ml/executions/article/${articleId}`
  );
  return response.data;
};

// ============================================
// Monitoring & Health
// ============================================

/**
 * Add-on 상태 요약
 * GET /api/v1/ml/status
 */
export interface MlAddonStatusSummary {
  totalAddons: number;
  enabledAddons: number;
  healthyAddons: number;
  unhealthyAddons: number;
  totalExecutionsToday: number;
  successRate: number;
  avgLatencyMs: number;
  byCategory: Record<AddonCategory, number>;
}

export const getMlAddonStatus = async (): Promise<MlAddonStatusSummary> => {
  const client = await getApiClient();
  const response = await client.get<MlAddonStatusSummary>('/api/v1/ml/status');
  return response.data;
};

/**
 * 헬스체크 수동 실행
 * POST /api/v1/ml/health-check
 */
export const runMlHealthCheck = async (): Promise<{
  checkedAt: string;
  results: Array<{
    addonKey: string;
    status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
    latencyMs: number;
    error?: string;
  }>;
}> => {
  const client = await getApiClient();
  const response = await client.post('/api/v1/ml/health-check');
  return response.data;
};

// ============================================
// Utility Functions
// ============================================

/**
 * 카테고리 한글명 반환
 */
export const getCategoryLabel = (category: AddonCategory): string => {
  const labels: Record<AddonCategory, string> = {
    SENTIMENT: '감정 분석',
    CONTEXT: '문맥/의도 분석',
    FACTCHECK: '팩트체크',
    COMMUNITY: '커뮤니티 분석',
    SOURCE_QUALITY: '출처 신뢰도',
    ENTITY_EXTRACTION: '개체명 인식',
    SUMMARIZATION: '요약 생성',
    TOPIC_CLASSIFICATION: '주제 분류',
    TOXICITY: '독성/혐오 탐지',
    MISINFORMATION: '허위정보 탐지',
    CUSTOM: '커스텀',
  };
  return labels[category];
};

/**
 * 실행 상태 색상 반환
 */
export const getExecutionStatusColor = (status: ExecutionStatus): string => {
  const colors: Record<ExecutionStatus, string> = {
    PENDING: 'yellow',
    RUNNING: 'blue',
    SUCCESS: 'green',
    FAILED: 'red',
    TIMEOUT: 'orange',
    CANCELLED: 'gray',
    SKIPPED: 'slate',
  };
  return colors[status];
};

/**
 * 실행 상태 한글명 반환
 */
export const getExecutionStatusLabel = (status: ExecutionStatus): string => {
  const labels: Record<ExecutionStatus, string> = {
    PENDING: '대기 중',
    RUNNING: '실행 중',
    SUCCESS: '성공',
    FAILED: '실패',
    TIMEOUT: '타임아웃',
    CANCELLED: '취소됨',
    SKIPPED: '건너뜀',
  };
  return labels[status];
};

/**
 * 활성화된 Add-on만 필터링
 */
export const filterEnabledAddons = (addons: MlAddon[]): MlAddon[] => {
  return addons.filter((addon) => addon.enabled);
};

/**
 * 카테고리별 Add-on 그룹화
 */
export const groupAddonsByCategory = (addons: MlAddon[]): Record<AddonCategory, MlAddon[]> => {
  return addons.reduce(
    (groups, addon) => {
      const category = addon.category;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(addon);
      return groups;
    },
    {} as Record<AddonCategory, MlAddon[]>
  );
};
