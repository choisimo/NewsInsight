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
import DeepSearch from "./pages/DeepSearch";
import BrowserAgent from "./pages/BrowserAgent";
import ParallelSearch from "./pages/ParallelSearch";
import FactCheck from "./pages/FactCheck";
import UrlCollections from "./pages/UrlCollections";
import SearchHistory from "./pages/SearchHistory";
import SmartSearch from "./pages/SmartSearch";

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
                {/* Smart Search - 통합 검색 허브 */}
                <Route path="/smart-search" element={<SmartSearch />} />
                {/* Home page is now the unified search */}
                <Route path="/" element={<ParallelSearch />} />
                {/* Redirect /search to home for backward compatibility */}
                <Route path="/search" element={<Navigate to="/" replace />} />
                <Route path="/fact-check" element={<FactCheck />} />
                <Route path="/deep-search" element={<DeepSearch />} />
                <Route path="/ai-agent" element={<BrowserAgent />} />
                <Route path="/url-collections" element={<UrlCollections />} />
                <Route path="/history" element={<SearchHistory />} />
                <Route path="/admin/sources" element={<AdminSources />} />
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
