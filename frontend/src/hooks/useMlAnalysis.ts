/**
 * useMlAnalysis - ML 분석 작업 관리 Hook
 * 
 * 기능:
 * - 분석 요청 및 상태 추적
 * - 백그라운드 작업 관리
 * - 알림 시스템 연동
 * - 분석 완료 시 결과 처리
 */

import { useCallback, useRef, useEffect } from 'react';
import { useBackgroundTasks } from '@/contexts/BackgroundTaskContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useToast } from '@/hooks/use-toast';
import {
  analyzeArticle,
  analyzeArticlesBatch,
  analyzeByCategory,
  listMlExecutions,
  getCategoryLabel,
} from '@/lib/api/ml';
import type { AddonCategory, ExecutionStatus } from '@/types/api';

interface AnalysisTask {
  taskId: string;
  batchId: string;
  executionIds: string[];
  articleId?: number;
  articleIds?: number[];
  category?: AddonCategory;
  startTime: number;
}

interface UseMlAnalysisReturn {
  startAnalysis: (articleId: number, importance?: 'realtime' | 'batch') => Promise<string | null>;
  startBatchAnalysis: (articleIds: number[], importance?: 'realtime' | 'batch') => Promise<string | null>;
  startCategoryAnalysis: (articleId: number, category: AddonCategory) => Promise<string | null>;
  isAnalyzing: (articleId: number) => boolean;
  getAnalysisStatus: (taskId: string) => 'pending' | 'running' | 'completed' | 'failed' | null;
}

const POLL_INTERVAL = 3000; // 3초
const MAX_POLL_DURATION = 5 * 60 * 1000; // 5분

export function useMlAnalysis(): UseMlAnalysisReturn {
  const { addTask, updateTask, getTask } = useBackgroundTasks();
  const { addNotification } = useNotifications();
  const { toast } = useToast();
  
  // 활성 분석 작업 추적
  const activeTasksRef = useRef<Map<string, AnalysisTask>>(new Map());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 폴링으로 분석 상태 확인
  const pollAnalysisStatus = useCallback(async () => {
    const activeTasks = activeTasksRef.current;
    
    if (activeTasks.size === 0) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    try {
      // 최근 실행 목록 조회
      const executions = await listMlExecutions(0, 100);
      
      for (const [taskId, task] of activeTasks.entries()) {
        const now = Date.now();
        
        // 최대 폴링 시간 초과
        if (now - task.startTime > MAX_POLL_DURATION) {
          updateTask(taskId, {
            status: 'failed',
            error: '분석 시간 초과',
            completedAt: new Date().toISOString(),
          });
          
          addNotification({
            type: 'error',
            title: 'ML 분석 시간 초과',
            message: '분석 작업이 너무 오래 걸려 중단되었습니다.',
            persistent: true,
          });
          
          activeTasks.delete(taskId);
          continue;
        }

        // 해당 배치의 실행 상태 확인
        const relevantExecutions = executions.content.filter(
          e => e.batchId === task.batchId || task.executionIds.includes(e.requestId)
        );

        if (relevantExecutions.length === 0) continue;

        const allCompleted = relevantExecutions.every(
          e => e.status === 'SUCCESS' || e.status === 'FAILED' || e.status === 'CANCELLED' || e.status === 'SKIPPED'
        );
        
        const anyRunning = relevantExecutions.some(e => e.status === 'RUNNING');
        const successCount = relevantExecutions.filter(e => e.status === 'SUCCESS').length;
        const failedCount = relevantExecutions.filter(e => e.status === 'FAILED').length;
        const totalCount = relevantExecutions.length;

        // 진행률 업데이트
        if (anyRunning || (successCount + failedCount) > 0) {
          const progress = Math.round(((successCount + failedCount) / totalCount) * 100);
          updateTask(taskId, {
            status: 'running',
            progress,
            progressMessage: `${successCount + failedCount}/${totalCount} 완료`,
          });
        }

        // 모두 완료되면 결과 처리
        if (allCompleted) {
          const allSuccess = failedCount === 0;
          
          updateTask(taskId, {
            status: allSuccess ? 'completed' : 'failed',
            progress: 100,
            completedAt: new Date().toISOString(),
            progressMessage: allSuccess 
              ? `${successCount}개 분석 완료` 
              : `${successCount}개 성공, ${failedCount}개 실패`,
            error: failedCount > 0 ? `${failedCount}개 분석 실패` : undefined,
          });

          // 알림 추가 - 기사 ID가 있으면 해당 기사 결과 페이지로, 없으면 전체 결과 페이지로
          const articleId = task.articleId;
          addNotification({
            type: allSuccess ? 'success' : 'warning',
            title: allSuccess ? 'ML 분석 완료' : 'ML 분석 일부 실패',
            message: allSuccess 
              ? `${successCount}개의 분석이 성공적으로 완료되었습니다.`
              : `${successCount}개 성공, ${failedCount}개 실패`,
            actionUrl: articleId ? `/ml-results?articleId=${articleId}` : '/ml-results',
            actionLabel: '결과 보기',
            persistent: true,
          });

          activeTasks.delete(taskId);
        }
      }
    } catch (error) {
      console.error('Failed to poll analysis status:', error);
    }
  }, [updateTask, addNotification]);

  // 폴링 시작/관리
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    
    pollIntervalRef.current = setInterval(pollAnalysisStatus, POLL_INTERVAL);
  }, [pollAnalysisStatus]);

  // 컴포넌트 언마운트 시 폴링 정리
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // 단일 기사 분석
  const startAnalysis = useCallback(async (
    articleId: number,
    importance: 'realtime' | 'batch' = 'batch'
  ): Promise<string | null> => {
    const taskId = `ml-${articleId}-${Date.now()}`;
    
    try {
      // 백그라운드 작업 등록
      addTask({
        id: taskId,
        type: 'ml-analysis',
        title: `기사 #${articleId} ML 분석`,
        status: 'pending',
        progress: 0,
        progressMessage: '분석 준비 중...',
        articleId,
      });

      // Toast로 즉각 피드백
      toast({
        title: '🔬 ML 분석 시작',
        description: `기사 #${articleId}의 분석이 백그라운드에서 진행됩니다.`,
      });

      // 분석 요청
      const result = await analyzeArticle(articleId, importance);
      
      // executionIds가 없을 경우 안전 처리
      const executionIds = result.executionIds ?? [];
      const executionCount = executionIds.length || 1; // 최소 1개로 표시
      
      // 작업 상태 업데이트
      updateTask(taskId, {
        status: 'running',
        progress: 10,
        progressMessage: executionIds.length > 0 
          ? `${executionCount}개 애드온 분석 중...`
          : '분석 진행 중...',
        batchId: result.batchId,
      });

      // 알림 추가 (백그라운드 작업 알림)
      addNotification({
        type: 'info',
        title: 'ML 분석 진행 중',
        message: executionIds.length > 0
          ? `기사 #${articleId}의 ${executionCount}개 분석이 진행 중입니다.`
          : `기사 #${articleId}의 분석이 진행 중입니다.`,
        actionUrl: `/ml-results?articleId=${articleId}`,
        actionLabel: '결과 확인',
      });

      // 활성 작업에 추가
      activeTasksRef.current.set(taskId, {
        taskId,
        batchId: result.batchId,
        executionIds,
        articleId,
        startTime: Date.now(),
      });

      // 폴링 시작
      startPolling();

      return taskId;
    } catch (error) {
      console.error('Failed to start analysis:', error);
      
      updateTask(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : '분석 시작 실패',
        completedAt: new Date().toISOString(),
      });

      toast({
        title: '분석 실패',
        description: error instanceof Error ? error.message : 'ML 분석을 시작할 수 없습니다.',
        variant: 'destructive',
      });

      addNotification({
        type: 'error',
        title: 'ML 분석 실패',
        message: error instanceof Error ? error.message : '분석을 시작할 수 없습니다.',
        persistent: true,
      });

      return null;
    }
  }, [addTask, updateTask, toast, addNotification, startPolling]);

  // 일괄 분석
  const startBatchAnalysis = useCallback(async (
    articleIds: number[],
    importance: 'realtime' | 'batch' = 'batch'
  ): Promise<string | null> => {
    if (articleIds.length === 0) {
      toast({
        title: '분석할 기사가 없습니다',
        variant: 'destructive',
      });
      return null;
    }

    const taskId = `ml-batch-${Date.now()}`;
    const limitedIds = articleIds.slice(0, 50); // 최대 50개
    
    try {
      addTask({
        id: taskId,
        type: 'ml-analysis',
        title: `${limitedIds.length}개 기사 일괄 분석`,
        status: 'pending',
        progress: 0,
        progressMessage: '일괄 분석 준비 중...',
      });

      toast({
        title: '🔬 일괄 분석 시작',
        description: `${limitedIds.length}개 기사의 분석이 백그라운드에서 진행됩니다.`,
      });

      const result = await analyzeArticlesBatch(limitedIds, importance);
      
      // executionIds가 없을 경우 안전 처리
      const executionIds = result.executionIds ?? [];
      
      updateTask(taskId, {
        status: 'running',
        progress: 5,
        progressMessage: `${result.articleCount}개 기사 분석 중...`,
        batchId: result.batchId,
      });

      addNotification({
        type: 'info',
        title: '일괄 분석 진행 중',
        message: `${result.articleCount}개 기사의 ML 분석이 진행 중입니다.`,
        actionUrl: '/ml-results',
        actionLabel: '결과 확인',
      });

      activeTasksRef.current.set(taskId, {
        taskId,
        batchId: result.batchId,
        executionIds,
        articleIds: limitedIds,
        startTime: Date.now(),
      });

      startPolling();

      return taskId;
    } catch (error) {
      console.error('Failed to start batch analysis:', error);
      
      updateTask(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : '일괄 분석 시작 실패',
        completedAt: new Date().toISOString(),
      });

      toast({
        title: '일괄 분석 실패',
        description: error instanceof Error ? error.message : '일괄 분석을 시작할 수 없습니다.',
        variant: 'destructive',
      });

      addNotification({
        type: 'error',
        title: '일괄 분석 실패',
        message: error instanceof Error ? error.message : '분석을 시작할 수 없습니다.',
        persistent: true,
      });

      return null;
    }
  }, [addTask, updateTask, toast, addNotification, startPolling]);

  // 카테고리별 분석
  const startCategoryAnalysis = useCallback(async (
    articleId: number,
    category: AddonCategory
  ): Promise<string | null> => {
    const taskId = `ml-${articleId}-${category}-${Date.now()}`;
    const categoryLabel = getCategoryLabel(category);
    
    try {
      addTask({
        id: taskId,
        type: 'ml-analysis',
        title: `기사 #${articleId} ${categoryLabel}`,
        status: 'pending',
        progress: 0,
        progressMessage: `${categoryLabel} 준비 중...`,
        articleId,
        addonCategory: category,
      });

      toast({
        title: `🔬 ${categoryLabel} 시작`,
        description: `기사 #${articleId}의 ${categoryLabel}이 백그라운드에서 진행됩니다.`,
      });

      const result = await analyzeByCategory(articleId, category);
      
      // 카테고리 분석은 동기적으로 결과가 오므로 바로 완료 처리
      const isSuccess = result.status === 'success';
      
      updateTask(taskId, {
        status: isSuccess ? 'completed' : 'failed',
        progress: 100,
        completedAt: new Date().toISOString(),
        progressMessage: isSuccess ? '분석 완료' : '분석 실패',
        result: result.results,
        error: result.error?.message,
      });

      addNotification({
        type: isSuccess ? 'success' : 'error',
        title: isSuccess ? `${categoryLabel} 완료` : `${categoryLabel} 실패`,
        message: isSuccess 
          ? `기사 #${articleId}의 ${categoryLabel}이 완료되었습니다.`
          : result.error?.message || '분석 중 오류가 발생했습니다.',
        actionUrl: `/ml-results?articleId=${articleId}`,
        actionLabel: '결과 보기',
        persistent: true,
      });

      return taskId;
    } catch (error) {
      console.error('Failed to start category analysis:', error);
      
      updateTask(taskId, {
        status: 'failed',
        error: error instanceof Error ? error.message : '분석 시작 실패',
        completedAt: new Date().toISOString(),
      });

      toast({
        title: `${categoryLabel} 실패`,
        description: error instanceof Error ? error.message : '분석을 시작할 수 없습니다.',
        variant: 'destructive',
      });

      addNotification({
        type: 'error',
        title: `${categoryLabel} 실패`,
        message: error instanceof Error ? error.message : '분석을 시작할 수 없습니다.',
        persistent: true,
      });

      return null;
    }
  }, [addTask, updateTask, toast, addNotification]);

  // 특정 기사가 분석 중인지 확인
  const isAnalyzing = useCallback((articleId: number): boolean => {
    for (const task of activeTasksRef.current.values()) {
      if (task.articleId === articleId) return true;
      if (task.articleIds?.includes(articleId)) return true;
    }
    return false;
  }, []);

  // 작업 상태 조회
  const getAnalysisStatus = useCallback((taskId: string): 'pending' | 'running' | 'completed' | 'failed' | null => {
    const task = getTask(taskId);
    if (!task) return null;
    return task.status as 'pending' | 'running' | 'completed' | 'failed';
  }, [getTask]);

  return {
    startAnalysis,
    startBatchAnalysis,
    startCategoryAnalysis,
    isAnalyzing,
    getAnalysisStatus,
  };
}

export default useMlAnalysis;
