import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { BackgroundTaskProvider } from "@/contexts/BackgroundTaskContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
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

// New Admin Pages
import AdminEnvironments from "./pages/admin/AdminEnvironments";
import AdminScripts from "./pages/admin/AdminScripts";
import AdminAuditLogs from "./pages/admin/AdminAuditLogs";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <NotificationProvider>
        <BackgroundTaskProvider>
          <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <CommandPalette />
            <AppLayout>
              <Routes>
                {/* Home - Unified Search Hub (SmartSearch with mode tabs) */}
                <Route path="/" element={<SmartSearch />} />
                
                {/* Live Dashboard */}
                <Route path="/dashboard" element={<LiveDashboard />} />

                {/* Backward compatibility redirects - old routes to new search modes */}
                <Route path="/smart-search" element={<Navigate to="/" replace />} />
                <Route path="/search" element={<Navigate to="/" replace />} />
                <Route path="/deep-search" element={<Navigate to="/?mode=deep" replace />} />
                <Route path="/fact-check" element={<Navigate to="/?mode=factcheck" replace />} />
                
                {/* ML Add-ons - Bias, Sentiment, etc. */}
                <Route path="/ml-addons" element={<MLAddons />} />
                
                {/* Browser Agent */}
                <Route path="/ai-agent" element={<BrowserAgent />} />
                
                {/* URL Source Management */}
                <Route path="/url-collections" element={<UrlCollections />} />
                
                {/* Projects - Saved search collections */}
                <Route path="/projects" element={<Projects />} />
                
                {/* Search History */}
                <Route path="/history" element={<SearchHistory />} />
                
                {/* Admin Routes */}
                <Route path="/admin/sources" element={<AdminSources />} />
                <Route path="/admin/operations" element={<Operations />} />
                <Route path="/admin/environments" element={<AdminEnvironments />} />
                <Route path="/admin/scripts" element={<AdminScripts />} />
                <Route path="/admin/audit-logs" element={<AdminAuditLogs />} />
                
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
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
