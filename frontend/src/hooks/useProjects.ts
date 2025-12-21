/**
 * useProjects - Hook for managing projects
 * 
 * Provides CRUD operations, member management, and item management for projects.
 */

import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  getProjectsByOwner,
  searchProjects,
  getDefaultProject,
  getProjectStats,
  getProjectMembers,
  inviteProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
  addProjectItem,
  getProjectItems,
  searchProjectItems,
  markProjectItemAsRead,
  toggleProjectItemBookmark,
  deleteProjectItem,
  getProjectActivityLog,
  getRecentProjectActivity,
  type Project,
  type ProjectStatus,
  type ProjectCategory,
  type ProjectVisibility,
  type ProjectMember,
  type ProjectItem,
  type ProjectItemType,
  type ProjectActivityLog,
  type MemberRole,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type AddProjectItemRequest,
  type PageResponse,
} from '@/lib/api';

// Re-export types for convenience
export type {
  Project,
  ProjectStatus,
  ProjectCategory,
  ProjectVisibility,
  ProjectMember,
  ProjectItem,
  ProjectItemType,
  ProjectActivityLog,
  MemberRole,
  CreateProjectRequest,
  UpdateProjectRequest,
  AddProjectItemRequest,
};

// Korean labels
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ACTIVE: '활성',
  PAUSED: '일시중지',
  COMPLETED: '완료',
  ARCHIVED: '보관됨',
};

export const PROJECT_CATEGORY_LABELS: Record<ProjectCategory, string> = {
  RESEARCH: '연구',
  MONITORING: '모니터링',
  FACT_CHECK: '팩트체크',
  TREND_ANALYSIS: '트렌드 분석',
  CUSTOM: '사용자 정의',
};

export const PROJECT_VISIBILITY_LABELS: Record<ProjectVisibility, string> = {
  PRIVATE: '비공개',
  TEAM: '팀 공개',
  PUBLIC: '전체 공개',
};

export const ITEM_TYPE_LABELS: Record<ProjectItemType, string> = {
  ARTICLE: '기사',
  SEARCH_RESULT: '검색 결과',
  NOTE: '메모',
  DOCUMENT: '문서',
  URL: 'URL',
  EVIDENCE: '증거자료',
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: '소유자',
  ADMIN: '관리자',
  EDITOR: '편집자',
  VIEWER: '뷰어',
};

interface UseProjectsOptions {
  userId?: string;
  autoLoad?: boolean;
  pageSize?: number;
}

interface ProjectStats {
  itemCount: number;
  unreadCount: number;
  memberCount: number;
  categories: string[];
}

interface UseProjectsReturn {
  // State
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  totalElements: number;

  // Project CRUD
  loadProjects: (page?: number, status?: ProjectStatus) => Promise<void>;
  searchProjectsAction: (query: string, page?: number) => Promise<void>;
  createProjectAction: (request: CreateProjectRequest) => Promise<Project | null>;
  updateProjectAction: (id: number, request: UpdateProjectRequest) => Promise<Project | null>;
  deleteProjectAction: (id: number) => Promise<boolean>;
  selectProject: (id: number) => Promise<void>;
  getDefaultProjectAction: () => Promise<Project | null>;
  getProjectStatsAction: (id: number) => Promise<ProjectStats | null>;

  // Members
  members: ProjectMember[];
  loadMembers: (projectId: number) => Promise<void>;
  inviteMember: (projectId: number, userId: string, role: MemberRole) => Promise<ProjectMember | null>;
  removeMember: (projectId: number, userId: string) => Promise<boolean>;
  updateMemberRole: (projectId: number, userId: string, role: MemberRole) => Promise<ProjectMember | null>;

  // Items
  items: ProjectItem[];
  itemsPage: number;
  itemsTotalPages: number;
  itemsLoading: boolean;
  loadItems: (projectId: number, type?: ProjectItemType, page?: number) => Promise<void>;
  searchItems: (projectId: number, query: string, page?: number) => Promise<void>;
  addItem: (projectId: number, request: AddProjectItemRequest) => Promise<ProjectItem | null>;
  markItemRead: (projectId: number, itemId: number) => Promise<void>;
  toggleItemBookmark: (projectId: number, itemId: number) => Promise<void>;
  deleteItem: (projectId: number, itemId: number) => Promise<boolean>;

  // Activities
  activities: ProjectActivityLog[];
  loadActivities: (projectId: number, page?: number) => Promise<void>;
  loadRecentActivities: (projectId: number) => Promise<void>;

  // Utilities
  refresh: () => Promise<void>;
}

export function useProjects(options: UseProjectsOptions = {}): UseProjectsReturn {
  const { userId = 'anonymous', autoLoad = true, pageSize = 20 } = options;
  const { toast } = useToast();

  // Projects state
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);

  // Members state
  const [members, setMembers] = useState<ProjectMember[]>([]);

  // Items state
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [itemsPage, setItemsPage] = useState(0);
  const [itemsTotalPages, setItemsTotalPages] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Activities state
  const [activities, setActivities] = useState<ProjectActivityLog[]>([]);

  // Load projects
  const loadProjects = useCallback(async (page: number = 0, status?: ProjectStatus) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getProjectsByOwner(userId, status, page, pageSize);
      setProjects(response.content);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
    } catch (err) {
      const message = err instanceof Error ? err.message : '프로젝트를 불러오는데 실패했습니다.';
      setError(message);
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, pageSize]);

  // Search projects
  const searchProjectsAction = useCallback(async (query: string, page: number = 0) => {
    setLoading(true);
    setError(null);
    try {
      const response = await searchProjects(query, page, pageSize);
      setProjects(response.content);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
    } catch (err) {
      const message = err instanceof Error ? err.message : '프로젝트 검색에 실패했습니다.';
      setError(message);
      console.error('Failed to search projects:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  // Create project
  const createProjectAction = useCallback(async (request: CreateProjectRequest): Promise<Project | null> => {
    try {
      const project = await createProject({ ...request, ownerId: userId });
      setProjects(prev => [project, ...prev]);
      setTotalElements(prev => prev + 1);
      toast({
        title: '프로젝트 생성 완료',
        description: `"${project.name}" 프로젝트가 생성되었습니다.`,
      });
      return project;
    } catch (err) {
      const message = err instanceof Error ? err.message : '프로젝트 생성에 실패했습니다.';
      toast({
        title: '프로젝트 생성 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to create project:', err);
      return null;
    }
  }, [userId, toast]);

  // Update project
  const updateProjectAction = useCallback(async (id: number, request: UpdateProjectRequest): Promise<Project | null> => {
    try {
      const updated = await updateProject(id, request, userId);
      setProjects(prev => prev.map(p => p.id === id ? updated : p));
      if (currentProject?.id === id) {
        setCurrentProject(updated);
      }
      toast({
        title: '프로젝트 업데이트 완료',
        description: `"${updated.name}" 프로젝트가 업데이트되었습니다.`,
      });
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : '프로젝트 업데이트에 실패했습니다.';
      toast({
        title: '프로젝트 업데이트 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to update project:', err);
      return null;
    }
  }, [userId, currentProject, toast]);

  // Delete project
  const deleteProjectAction = useCallback(async (id: number): Promise<boolean> => {
    try {
      await deleteProject(id, userId);
      setProjects(prev => prev.filter(p => p.id !== id));
      setTotalElements(prev => prev - 1);
      if (currentProject?.id === id) {
        setCurrentProject(null);
      }
      toast({
        title: '프로젝트 삭제 완료',
        description: '프로젝트가 삭제되었습니다.',
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '프로젝트 삭제에 실패했습니다.';
      toast({
        title: '프로젝트 삭제 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to delete project:', err);
      return false;
    }
  }, [userId, currentProject, toast]);

  // Select project
  const selectProject = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const project = await getProject(id, userId);
      setCurrentProject(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : '프로젝트를 불러오는데 실패했습니다.';
      setError(message);
      console.error('Failed to select project:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Get default project
  const getDefaultProjectAction = useCallback(async (): Promise<Project | null> => {
    try {
      const project = await getDefaultProject(userId);
      return project;
    } catch (err) {
      console.error('Failed to get default project:', err);
      return null;
    }
  }, [userId]);

  // Get project stats
  const getProjectStatsAction = useCallback(async (id: number): Promise<ProjectStats | null> => {
    try {
      return await getProjectStats(id);
    } catch (err) {
      console.error('Failed to get project stats:', err);
      return null;
    }
  }, []);

  // Load members
  const loadMembers = useCallback(async (projectId: number) => {
    try {
      const membersList = await getProjectMembers(projectId);
      setMembers(membersList);
    } catch (err) {
      console.error('Failed to load members:', err);
    }
  }, []);

  // Invite member
  const inviteMember = useCallback(async (
    projectId: number,
    memberUserId: string,
    role: MemberRole
  ): Promise<ProjectMember | null> => {
    try {
      const member = await inviteProjectMember(projectId, memberUserId, role, userId);
      setMembers(prev => [...prev, member]);
      toast({
        title: '멤버 초대 완료',
        description: '새 멤버가 초대되었습니다.',
      });
      return member;
    } catch (err) {
      const message = err instanceof Error ? err.message : '멤버 초대에 실패했습니다.';
      toast({
        title: '멤버 초대 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to invite member:', err);
      return null;
    }
  }, [userId, toast]);

  // Remove member
  const removeMember = useCallback(async (projectId: number, memberUserId: string): Promise<boolean> => {
    try {
      await removeProjectMember(projectId, memberUserId, userId);
      setMembers(prev => prev.filter(m => m.userId !== memberUserId));
      toast({
        title: '멤버 제거 완료',
        description: '멤버가 프로젝트에서 제거되었습니다.',
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '멤버 제거에 실패했습니다.';
      toast({
        title: '멤버 제거 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to remove member:', err);
      return false;
    }
  }, [userId, toast]);

  // Update member role
  const updateMemberRole = useCallback(async (
    projectId: number,
    memberUserId: string,
    role: MemberRole
  ): Promise<ProjectMember | null> => {
    try {
      const updated = await updateProjectMemberRole(projectId, memberUserId, role, userId);
      setMembers(prev => prev.map(m => m.userId === memberUserId ? updated : m));
      toast({
        title: '역할 변경 완료',
        description: '멤버 역할이 변경되었습니다.',
      });
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : '역할 변경에 실패했습니다.';
      toast({
        title: '역할 변경 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to update member role:', err);
      return null;
    }
  }, [userId, toast]);

  // Load items
  const loadItems = useCallback(async (projectId: number, type?: ProjectItemType, page: number = 0) => {
    setItemsLoading(true);
    try {
      const response = await getProjectItems(projectId, type, page, pageSize);
      setItems(response.content);
      setItemsPage(response.page);
      setItemsTotalPages(response.totalPages);
    } catch (err) {
      console.error('Failed to load items:', err);
    } finally {
      setItemsLoading(false);
    }
  }, [pageSize]);

  // Search items
  const searchItems = useCallback(async (projectId: number, query: string, page: number = 0) => {
    setItemsLoading(true);
    try {
      const response = await searchProjectItems(projectId, query, page, pageSize);
      setItems(response.content);
      setItemsPage(response.page);
      setItemsTotalPages(response.totalPages);
    } catch (err) {
      console.error('Failed to search items:', err);
    } finally {
      setItemsLoading(false);
    }
  }, [pageSize]);

  // Add item
  const addItem = useCallback(async (
    projectId: number,
    request: AddProjectItemRequest
  ): Promise<ProjectItem | null> => {
    try {
      const item = await addProjectItem(projectId, request, userId);
      setItems(prev => [item, ...prev]);
      toast({
        title: '항목 추가 완료',
        description: '새 항목이 프로젝트에 추가되었습니다.',
      });
      return item;
    } catch (err) {
      const message = err instanceof Error ? err.message : '항목 추가에 실패했습니다.';
      toast({
        title: '항목 추가 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to add item:', err);
      return null;
    }
  }, [userId, toast]);

  // Mark item read
  const markItemRead = useCallback(async (projectId: number, itemId: number) => {
    try {
      await markProjectItemAsRead(projectId, itemId, userId);
      setItems(prev => prev.map(item => 
        item.id === itemId ? { ...item, isRead: true, readAt: new Date().toISOString() } : item
      ));
    } catch (err) {
      console.error('Failed to mark item as read:', err);
    }
  }, [userId]);

  // Toggle item bookmark
  const toggleItemBookmark = useCallback(async (projectId: number, itemId: number) => {
    try {
      await toggleProjectItemBookmark(projectId, itemId, userId);
      setItems(prev => prev.map(item =>
        item.id === itemId ? { ...item, isBookmarked: !item.isBookmarked } : item
      ));
    } catch (err) {
      console.error('Failed to toggle bookmark:', err);
    }
  }, [userId]);

  // Delete item
  const deleteItem = useCallback(async (projectId: number, itemId: number): Promise<boolean> => {
    try {
      await deleteProjectItem(projectId, itemId, userId);
      setItems(prev => prev.filter(item => item.id !== itemId));
      toast({
        title: '항목 삭제 완료',
        description: '항목이 삭제되었습니다.',
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '항목 삭제에 실패했습니다.';
      toast({
        title: '항목 삭제 실패',
        description: message,
        variant: 'destructive',
      });
      console.error('Failed to delete item:', err);
      return false;
    }
  }, [userId, toast]);

  // Load activities
  const loadActivities = useCallback(async (projectId: number, page: number = 0) => {
    try {
      const response = await getProjectActivityLog(projectId, page, pageSize);
      setActivities(response.content);
    } catch (err) {
      console.error('Failed to load activities:', err);
    }
  }, [pageSize]);

  // Load recent activities
  const loadRecentActivities = useCallback(async (projectId: number) => {
    try {
      const recentActivities = await getRecentProjectActivity(projectId);
      setActivities(recentActivities);
    } catch (err) {
      console.error('Failed to load recent activities:', err);
    }
  }, []);

  // Refresh
  const refresh = useCallback(async () => {
    await loadProjects(currentPage);
  }, [loadProjects, currentPage]);

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      loadProjects();
    }
  }, [autoLoad, loadProjects]);

  return {
    // State
    projects,
    currentProject,
    loading,
    error,
    currentPage,
    totalPages,
    totalElements,

    // Project CRUD
    loadProjects,
    searchProjectsAction,
    createProjectAction,
    updateProjectAction,
    deleteProjectAction,
    selectProject,
    getDefaultProjectAction,
    getProjectStatsAction,

    // Members
    members,
    loadMembers,
    inviteMember,
    removeMember,
    updateMemberRole,

    // Items
    items,
    itemsPage,
    itemsTotalPages,
    itemsLoading,
    loadItems,
    searchItems,
    addItem,
    markItemRead,
    toggleItemBookmark,
    deleteItem,

    // Activities
    activities,
    loadActivities,
    loadRecentActivities,

    // Utilities
    refresh,
  };
}

export default useProjects;
