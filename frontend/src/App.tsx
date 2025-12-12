import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { BackgroundTaskProvider } from "@/contexts/BackgroundTaskContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { CommandPalette } from "@/components/CommandPalette";
import NotFound from "./pages/NotFound";
import AdminSources from "./pages/AdminSources";
import BrowserAgent from "./pages/BrowserAgent";
import UrlCollections from "./pages/UrlCollections";
import SearchHistory from "./pages/SearchHistory";
import SmartSearch from "./pages/SmartSearch";
import Settings from "./pages/Settings";
import MLAddons from "./pages/MLAddons";
import Projects from "./pages/Projects";
import LiveDashboard from "./pages/LiveDashboard";
import Operations from "./pages/Operations";
import AiJobs from "./pages/AiJobs";
import CollectedDataPage from "./pages/CollectedDataPage";

// New Pages
import NewHome from "./pages/NewHome";
import ToolsHub from "./pages/ToolsHub";
import WorkspaceHub from "./pages/WorkspaceHub";

// Admin Pages
import AdminEnvironments from "./pages/admin/AdminEnvironments";
import AdminScripts from "./pages/admin/AdminScripts";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs";
import AdminLogin from "./pages/admin/AdminLogin";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <NotificationProvider>
          <BackgroundTaskProvider>
            <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <CommandPalette />
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
                <Route path="/ai-agent" element={<BrowserAgent />} />
                <Route path="/ai-jobs" element={<AiJobs />} />
                
                {/* Workspace Section */}
                <Route path="/workspace" element={<WorkspaceHub />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/history" element={<SearchHistory />} />
                <Route path="/url-collections" element={<UrlCollections />} />

                {/* Backward compatibility redirects */}
                <Route path="/smart-search" element={<Navigate to="/search" replace />} />
                <Route path="/deep-search" element={<Navigate to="/search?mode=deep" replace />} />
                <Route path="/fact-check" element={<Navigate to="/search?mode=factcheck" replace />} />
                
                {/* Admin Routes */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/sources" element={<ProtectedRoute><AdminSources /></ProtectedRoute>} />
                <Route path="/admin/operations" element={<ProtectedRoute><Operations /></ProtectedRoute>} />
                <Route path="/admin/environments" element={<ProtectedRoute requiredRole="operator"><AdminEnvironments /></ProtectedRoute>} />
                <Route path="/admin/scripts" element={<ProtectedRoute requiredRole="operator"><AdminScripts /></ProtectedRoute>} />
                <Route path="/admin/audit-logs" element={<ProtectedRoute requiredRole="admin"><AdminAuditLogs /></ProtectedRoute>} />
                
                {/* Settings */}
                <Route path="/settings" element={<Settings />} />
                
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </BrowserRouter>
          </TooltipProvider>
        </BackgroundTaskProvider>
      </NotificationProvider>
    </AuthProvider>
  </ThemeProvider>
  </QueryClientProvider>
);

export default App;
