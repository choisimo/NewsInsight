import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'viewer' | 'operator' | 'admin';
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page, preserving the intended destination
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  // Check role if required
  if (requiredRole && user) {
    const roleHierarchy = ['viewer', 'operator', 'admin'];
    const userRoleIndex = roleHierarchy.indexOf(user.role);
    const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

    if (userRoleIndex < requiredRoleIndex) {
      // User doesn't have sufficient permissions
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">접근 권한이 없습니다</h1>
            <p className="text-muted-foreground">
              이 페이지에 접근하려면 {requiredRole} 이상의 권한이 필요합니다.
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
