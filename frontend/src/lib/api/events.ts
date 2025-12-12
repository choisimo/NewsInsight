/**
 * Dashboard Events Controller API
 * Backend: /api/v1/events
 *
 * 대시보드 실시간 이벤트 스트리밍 API
 */

import type { DashboardEvent, DashboardStats } from '@/types/api';

// ============================================
// SSE Stream URLs
// ============================================

/**
 * 대시보드 이벤트 스트림 URL 생성
 */
export const getDashboardEventsStreamUrl = (): string => {
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/api/v1/events/stream`;
};

/**
 * 대시보드 통계 스트림 URL 생성
 */
export const getDashboardStatsStreamUrl = (): string => {
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/api/v1/events/stats/stream`;
};

// ============================================
// SSE Event Source Functions
// ============================================

/**
 * 대시보드 이벤트 SSE 스트림 열기
 *
 * 이벤트 타입:
 * - HEARTBEAT: 연결 유지용 (30초마다)
 * - NEW_DATA: 새로운 데이터 수집됨
 * - SOURCE_UPDATED: 소스 상태 변경
 * - STATS_UPDATED: 통계 갱신
 * - COLLECTION_STARTED: 수집 시작
 * - COLLECTION_COMPLETED: 수집 완료
 * - ERROR: 에러 발생
 */
export const openDashboardEventsStream = (): EventSource => {
  const url = getDashboardEventsStreamUrl();
  return new EventSource(url);
};

/**
 * 대시보드 통계 SSE 스트림 열기
 * 5초마다 최신 통계를 전송
 */
export const openDashboardStatsStream = (): EventSource => {
  const url = getDashboardStatsStreamUrl();
  return new EventSource(url);
};

// ============================================
// Event Parsing Utilities
// ============================================

/**
 * SSE 이벤트 데이터를 DashboardEvent로 파싱
 */
export const parseDashboardEvent = (data: string): DashboardEvent | null => {
  try {
    return JSON.parse(data) as DashboardEvent;
  } catch {
    console.error('Failed to parse dashboard event:', data);
    return null;
  }
};

/**
 * SSE 이벤트에서 통계 데이터 추출
 */
export const parseStatsFromEvent = (event: DashboardEvent): DashboardStats | null => {
  if (event.eventType !== 'STATS_UPDATED' || !event.data) {
    return null;
  }

  return {
    totalCollected: (event.data.totalCollected as number) || 0,
    todayCollected: (event.data.todayCollected as number) || 0,
    activeSourceCount: (event.data.activeSourceCount as number) || 0,
    timestamp: (event.data.timestamp as number) || Date.now(),
  };
};

// ============================================
// Event Type Guards
// ============================================

export const isHeartbeat = (event: DashboardEvent): boolean => {
  return event.eventType === 'HEARTBEAT';
};

export const isNewData = (event: DashboardEvent): boolean => {
  return event.eventType === 'NEW_DATA';
};

export const isSourceUpdated = (event: DashboardEvent): boolean => {
  return event.eventType === 'SOURCE_UPDATED';
};

export const isStatsUpdated = (event: DashboardEvent): boolean => {
  return event.eventType === 'STATS_UPDATED';
};

export const isCollectionStarted = (event: DashboardEvent): boolean => {
  return event.eventType === 'COLLECTION_STARTED';
};

export const isCollectionCompleted = (event: DashboardEvent): boolean => {
  return event.eventType === 'COLLECTION_COMPLETED';
};

export const isError = (event: DashboardEvent): boolean => {
  return event.eventType === 'ERROR';
};

// ============================================
// Event Type Labels
// ============================================

export const getEventTypeLabel = (eventType: DashboardEvent['eventType']): string => {
  const labels: Record<DashboardEvent['eventType'], string> = {
    HEARTBEAT: '연결 유지',
    NEW_DATA: '새 데이터 수집',
    SOURCE_UPDATED: '소스 상태 변경',
    STATS_UPDATED: '통계 갱신',
    COLLECTION_STARTED: '수집 시작',
    COLLECTION_COMPLETED: '수집 완료',
    ERROR: '오류',
  };
  return labels[eventType];
};

export const getEventTypeColor = (eventType: DashboardEvent['eventType']): string => {
  const colors: Record<DashboardEvent['eventType'], string> = {
    HEARTBEAT: 'gray',
    NEW_DATA: 'green',
    SOURCE_UPDATED: 'blue',
    STATS_UPDATED: 'cyan',
    COLLECTION_STARTED: 'yellow',
    COLLECTION_COMPLETED: 'green',
    ERROR: 'red',
  };
  return colors[eventType];
};
