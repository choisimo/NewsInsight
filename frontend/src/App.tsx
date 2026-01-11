import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { BackgroundTaskProvider } from "@/contexts/BackgroundTaskContext";
import { SearchJobProvider } from "@/contexts/SearchJobContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { QuickAccessProvider } from "@/contexts/QuickAccessContext";
import { useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ActiveJobsIndicator } from "@/components/ActiveJobsIndicator";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickAccessPanel } from "@/components/QuickAccessPanel";
import { useQuickAccess } from "@/contexts/QuickAccessContext";
import NotFound from "./pages/NotFound";
import AdminSources from "./pages/AdminSources";
import BrowserAgent from "./pages/BrowserAgent";
import UrlCollections from "./pages/UrlCollections";
import SearchHistory from "./pages/SearchHistory";
import SmartSearch from "./pages/SmartSearch";
import Settings from "./pages/Settings";
import MLAddons from "./pages/MLAddons";
import MLResults from "./pages/MLResults";
import MLTraining from "./pages/MLTraining";
import Projects from "./pages/Projects";
import ProjectDashboard from "./pages/ProjectDashboard";
import ProjectSettings from "./pages/ProjectSettings";
import LiveDashboard from "./pages/LiveDashboard";
import Operations from "./pages/Operations";
import AiJobs from "./pages/AiJobs";
import CollectedDataPage from "./pages/CollectedDataPage";
import ParallelSearch from "./pages/ParallelSearch";
import FactCheck from "./pages/FactCheck";

// New Pages
import NewHome from "./pages/NewHome";
import ToolsHub from "./pages/ToolsHub";
import WorkspaceHub from "./pages/WorkspaceHub";

// Auth Pages (Public)
import Login from "./pages/Login";
import Register from "./pages/Register";

// Admin Pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminEnvironments from "./pages/admin/AdminEnvironments";
import AdminScripts from "./pages/admin/AdminScripts";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminSetup from "./pages/admin/AdminSetup";
import AdminLlmProviders from "./pages/admin/AdminLlmProviders";
import AdminConfigExport from "./pages/admin/AdminConfigExport";
import ServerMonitoring from "./pages/admin/ServerMonitoring";
import { ProtectedRoute } from "@/components/ProtectedRoute";

/**
 * React Query 클라이언트 설정
 * 
 * - staleTime: 데이터가 "신선"한 것으로 간주되는 시간 (5분)
 *   → 이 시간 동안은 캐시된 데이터를 즉시 반환하고 백그라운드 리패치 안함
 * - gcTime: 사용되지 않는 캐시 데이터 보관 시간 (30분)
 *   → 새로고침 후에도 캐시된 데이터를 즉시 표시 가능
 * - refetchOnWindowFocus: 탭 포커스 시 자동 리패치 (true)
 *   → 사용자가 돌아왔을 때 최신 데이터 확인
 * - retry: 실패 시 재시도 횟수 (1회)
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5분간 데이터를 fresh로 간주
      gcTime: 30 * 60 * 1000, // 30분간 캐시 유지 (구 cacheTime)
      refetchOnWindowFocus: true, // 탭 포커스 시 리패치
      refetchOnMount: true, // 마운트 시 stale 데이터면 리패치
      retry: 1, // 실패 시 1회 재시도
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
    mutations: {
      retry: 1,
    },
  },
});

const RedirectWithState = ({ to }: { to: string }) => {
  const location = useLocation();
  return <Navigate to={to} replace state={location.state} />;
};

// Wrapper to pass authenticated userId to SearchJobProvider
const AuthenticatedSearchJobProvider = ({ children }: { children: React.ReactNode }) => {
  const { user, isAuthenticated } = useAuth();
  
  // Generate a stable anonymous session ID for unauthenticated users
  const anonymousSessionId = useMemo(() => {
    const stored = sessionStorage.getItem('anonymous_session_id');
    if (stored) return stored;
    const newId = `anon-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem('anonymous_session_id', newId);
    return newId;
  }, []);
  
  // Use authenticated user ID or anonymous session ID
  const userId = isAuthenticated && user?.id ? user.id : anonymousSessionId;
  
  return (
    <SearchJobProvider userId={userId}>
      {children}
    </SearchJobProvider>
  );
};

const AppContent = () => {
  const { isOpen, close } = useQuickAccess();
  return (
    <>
      <CommandPalette />
      <QuickAccessPanel isOpen={isOpen} onClose={close} />
      <AppLayout>
                  <Routes>
                {/* NEW: Home - 새 대시보드 스타일 홈 */}
                <Route path="/" element={<NewHome />} />
                
                {/* Search - SmartSearch (기존 홈이 여기로 이동) */}
                <Route path="/search" element={<SmartSearch />} />
                
                {/* Dashboard Section */}
                <Route path="/dashboard" element={<LiveDashboard />} />
                <Route path="/operations" element={<Operations />} />
                <Route path="/collected-data" element={<CollectedDataPage />} />
                
                {/* Tools Section */}
                <Route path="/tools" element={<ToolsHub />} />
                <Route path="/ml-addons" element={<MLAddons />} />
                <Route path="/ml-results" element={<MLResults />} />
                <Route path="/ml-training" element={<MLTraining />} />
                <Route path="/ai-agent" element={<BrowserAgent />} />
                <Route path="/ai-jobs" element={<AiJobs />} />
                <Route path="/parallel-search" element={<ParallelSearch />} />
                <Route path="/factcheck" element={<FactCheck />} />
                
                {/* Workspace Section */}
                <Route path="/workspace" element={<WorkspaceHub />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:id" element={<ProjectDashboard />} />
                <Route path="/projects/:id/settings" element={<ProjectSettings />} />
                <Route path="/history" element={<SearchHistory />} />
                <Route path="/url-collections" element={<UrlCollections />} />

                {/* Backward compatibility redirects */}
                <Route path="/smart-search" element={<RedirectWithState to="/search" />} />
                <Route path="/deep-search" element={<RedirectWithState to="/search?mode=deep" />} />
                <Route path="/fact-check" element={<RedirectWithState to="/factcheck" />} />
                
                {/* Public Auth Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                
                {/* Admin Routes */}
                <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/setup" element={<ProtectedRoute allowSetup><AdminSetup /></ProtectedRoute>} />
                <Route path="/admin/sources" element={<ProtectedRoute><AdminSources /></ProtectedRoute>} />
                <Route path="/admin/operations" element={<ProtectedRoute><Operations /></ProtectedRoute>} />
                <Route path="/admin/environments" element={<ProtectedRoute requiredRole="operator"><AdminEnvironments /></ProtectedRoute>} />
                <Route path="/admin/scripts" element={<ProtectedRoute requiredRole="operator"><AdminScripts /></ProtectedRoute>} />
                <Route path="/admin/audit-logs" element={<ProtectedRoute requiredRole="admin"><AdminAuditLogs /></ProtectedRoute>} />
                <Route path="/admin/users" element={<ProtectedRoute requiredRole="admin"><AdminUsers /></ProtectedRoute>} />
                <Route path="/admin/llm-providers" element={<ProtectedRoute requiredRole="admin"><AdminLlmProviders /></ProtectedRoute>} />
                <Route path="/admin/config-export" element={<ProtectedRoute requiredRole="admin"><AdminConfigExport /></ProtectedRoute>} />
                <Route path="/admin/monitoring" element={<ProtectedRoute requiredRole="operator"><ServerMonitoring /></ProtectedRoute>} />
                
                {/* Settings */}
                <Route path="/settings" element={<Settings />} />
                
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
      </AppLayout>
      {/* Active Jobs Indicator - floating UI */}
      <ActiveJobsIndicator position="bottom-right" />
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
          <BackgroundTaskProvider>
            <AuthenticatedSearchJobProvider>
              <QuickAccessProvider>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <BrowserRouter>
                    <AppContent />
                  </BrowserRouter>
                </TooltipProvider>
              </QuickAccessProvider>
            </AuthenticatedSearchJobProvider>
          </BackgroundTaskProvider>
        </NotificationProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
