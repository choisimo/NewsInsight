import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Environments from './pages/Environments';
import Scripts from './pages/Scripts';
import Documents from './pages/Documents';
import LlmSettings from './pages/LlmSettings';
import HealthMonitor from './pages/HealthMonitor';
import DataSources from './pages/DataSources';
import Databases from './pages/Databases';
import Kafka from './pages/Kafka';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/environments"
        element={
          <ProtectedRoute>
            <Environments />
          </ProtectedRoute>
        }
      />
      <Route
        path="/scripts"
        element={
          <ProtectedRoute>
            <Scripts />
          </ProtectedRoute>
        }
      />
      <Route
        path="/documents"
        element={
          <ProtectedRoute>
            <Documents />
          </ProtectedRoute>
        }
      />
      <Route
        path="/llm-settings"
        element={
          <ProtectedRoute>
            <LlmSettings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/health-monitor"
        element={
          <ProtectedRoute>
            <HealthMonitor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-sources"
        element={
          <ProtectedRoute>
            <DataSources />
          </ProtectedRoute>
        }
      />
      <Route
        path="/databases"
        element={
          <ProtectedRoute>
            <Databases />
          </ProtectedRoute>
        }
      />
      <Route
        path="/kafka"
        element={
          <ProtectedRoute>
            <Kafka />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
