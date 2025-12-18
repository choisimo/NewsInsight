import { useEffect, useCallback, useRef } from 'react';
import { useNotifications, NotificationType } from '@/contexts/NotificationContext';
import { DashboardEvent, DashboardEventType } from './useDashboardEvents';

/**
 * SSE 이벤트 타입을 NotificationType으로 매핑
 */
const eventTypeToNotificationType: Record<DashboardEventType, NotificationType | null> = {
  HEARTBEAT: null, // 알림으로 표시하지 않음
  NEW_DATA: 'info',
  SOURCE_UPDATED: 'info',
  STATS_UPDATED: null, // 통계 업데이트는 알림으로 표시하지 않음
  COLLECTION_STARTED: 'info',
  COLLECTION_COMPLETED: 'success',
  ERROR: 'error',
};

/**
 * 이벤트 타입별 기본 제목 (한글)
 */
const eventTypeToTitle: Record<DashboardEventType, string> = {
  HEARTBEAT: '',
  NEW_DATA: '새 데이터',
  SOURCE_UPDATED: '소스 업데이트',
  STATS_UPDATED: '통계 업데이트',
  COLLECTION_STARTED: '수집 시작',
  COLLECTION_COMPLETED: '수집 완료',
  ERROR: '오류 발생',
};

export interface UseNotificationBridgeOptions {
  /** 알림을 생성할 이벤트 타입 목록 (비어있으면 모든 타입) */
  enabledEventTypes?: DashboardEventType[];
  /** 알림을 지속적으로 저장할지 여부 */
  persistent?: boolean;
  /** 중복 알림 방지 시간 (ms), 같은 타입의 알림이 이 시간 내에 오면 무시 */
  dedupeInterval?: number;
}

/**
 * SSE 대시보드 이벤트를 NotificationContext에 연결하는 훅
 * 
 * useDashboardEvents의 onEvent 콜백으로 사용할 수 있습니다.
 * 
 * @example
 * ```tsx
 * const { handleDashboardEvent } = useNotificationBridge();
 * 
 * useDashboardEvents({
 *   onEvent: handleDashboardEvent,
 * });
 * ```
 */
export function useNotificationBridge(options: UseNotificationBridgeOptions = {}) {
  const {
    enabledEventTypes,
    persistent = false,
    dedupeInterval = 5000, // 5초 내 동일 타입 알림 방지
  } = options;

  const { addNotification } = useNotifications();
  
  // 최근 알림 타입 및 시간 추적 (중복 방지용)
  const lastNotificationRef = useRef<Map<DashboardEventType, number>>(new Map());

  /**
   * 대시보드 이벤트를 알림으로 변환하여 추가
   */
  const handleDashboardEvent = useCallback((event: DashboardEvent) => {
    const notificationType = eventTypeToNotificationType[event.eventType];
    
    // 알림으로 표시하지 않는 이벤트 타입
    if (notificationType === null) {
      return;
    }

    // 활성화된 이벤트 타입 필터링
    if (enabledEventTypes && !enabledEventTypes.includes(event.eventType)) {
      return;
    }

    // 중복 알림 방지
    const now = Date.now();
    const lastTime = lastNotificationRef.current.get(event.eventType);
    if (lastTime && now - lastTime < dedupeInterval) {
      return;
    }
    lastNotificationRef.current.set(event.eventType, now);

    // 알림 제목 및 메시지 구성
    const title = eventTypeToTitle[event.eventType];
    const message = event.message || '';

    // actionUrl 구성 (이벤트 데이터에 따라)
    let actionUrl: string | undefined;
    let actionLabel: string | undefined;
    
    if (event.data) {
      // 수집 관련 이벤트면 수집 페이지로 링크
      if (event.eventType === 'COLLECTION_COMPLETED' || event.eventType === 'COLLECTION_STARTED') {
        if (event.data.jobId) {
          actionUrl = `/collections/${event.data.jobId}`;
          actionLabel = '상세 보기';
        }
      }
      // 새 데이터 이벤트면 기사 페이지로 링크
      if (event.eventType === 'NEW_DATA' && event.data.articleId) {
        actionUrl = `/articles/${event.data.articleId}`;
        actionLabel = '기사 보기';
      }
    }

    addNotification({
      type: notificationType,
      title,
      message,
      actionUrl,
      actionLabel,
      persistent,
    });
  }, [addNotification, enabledEventTypes, persistent, dedupeInterval]);

  return {
    handleDashboardEvent,
  };
}

/**
 * 대시보드 이벤트와 알림을 자동으로 연결하는 Provider 역할의 훅
 * 
 * App.tsx나 Layout에서 한 번만 호출하면 됩니다.
 * useDashboardEvents를 내부적으로 사용하며 자동으로 알림을 생성합니다.
 * 
 * @example
 * ```tsx
 * // App.tsx 또는 AppLayout.tsx에서
 * function App() {
 *   useAutoNotifications({ enabled: true });
 *   return <RouterProvider ... />;
 * }
 * ```
 */
export function useAutoNotifications(options: {
  enabled?: boolean;
  enabledEventTypes?: DashboardEventType[];
  persistent?: boolean;
  dedupeInterval?: number;
} = {}) {
  const { enabled = true, ...bridgeOptions } = options;
  const { handleDashboardEvent } = useNotificationBridge(bridgeOptions);

  // useDashboardEvents를 직접 import하지 않고 이벤트 리스너로 구현
  // (순환 의존성 방지)
  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource('/api/v1/events/stream');
    
    const handleMessage = (event: MessageEvent) => {
      try {
        const dashboardEvent: DashboardEvent = JSON.parse(event.data);
        handleDashboardEvent(dashboardEvent);
      } catch (e) {
        console.error('Failed to parse notification event:', e);
      }
    };

    eventSource.addEventListener('message', handleMessage);

    return () => {
      eventSource.removeEventListener('message', handleMessage);
      eventSource.close();
    };
  }, [enabled, handleDashboardEvent]);
}

export default useNotificationBridge;
