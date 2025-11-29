import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
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
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/search" element={<ParallelSearch />} />
          <Route path="/fact-check" element={<FactCheck />} />
          <Route path="/deep-search" element={<DeepSearch />} />
          <Route path="/browser-agent" element={<BrowserAgent />} />
          <Route path="/url-collections" element={<UrlCollections />} />
          <Route path="/admin/sources" element={<AdminSources />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
