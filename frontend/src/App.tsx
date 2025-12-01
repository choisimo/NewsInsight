import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { BackgroundTaskProvider } from "@/contexts/BackgroundTaskContext";
import { AppLayout } from "@/components/layout/AppLayout";
import NotFound from "./pages/NotFound";
import AdminSources from "./pages/AdminSources";
import DeepSearch from "./pages/DeepSearch";
import BrowserAgent from "./pages/BrowserAgent";
import ParallelSearch from "./pages/ParallelSearch";
import FactCheck from "./pages/FactCheck";
import UrlCollections from "./pages/UrlCollections";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BackgroundTaskProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AppLayout>
            <Routes>
              {/* Home page is now the unified search */}
              <Route path="/" element={<ParallelSearch />} />
              {/* Redirect /search to home for backward compatibility */}
              <Route path="/search" element={<Navigate to="/" replace />} />
              <Route path="/fact-check" element={<FactCheck />} />
              <Route path="/deep-search" element={<DeepSearch />} />
              <Route path="/browser-agent" element={<BrowserAgent />} />
              <Route path="/url-collections" element={<UrlCollections />} />
              <Route path="/admin/sources" element={<AdminSources />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </TooltipProvider>
    </BackgroundTaskProvider>
  </QueryClientProvider>
);

export default App;
