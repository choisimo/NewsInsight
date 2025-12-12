import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Token, User } from '@/types/admin';
import { authApi } from '@/lib/adminApi';

// Storage keys
const ACCESS_TOKEN_KEY = 'access_token';
const TOKEN_TYPE_KEY = 'token_type';
const USER_KEY = 'admin_user';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state from storage
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);

        if (storedToken) {
          setToken(storedToken);
          
          // Also set as cookie for SSE/EventSource requests
          document.cookie = `access_token=${storedToken}; path=/; SameSite=Lax`;

          if (storedUser) {
            try {
              setUser(JSON.parse(storedUser));
            } catch {
              // Invalid stored user, will refresh
            }
          }

          // Verify token is still valid by fetching current user
          try {
            const currentUser = await authApi.me();
            setUser(currentUser);
            localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
          } catch (error) {
            // Token is invalid, clear storage
            console.warn('Token validation failed, clearing auth state:', error);
            clearAuthStorage();
            setToken(null);
            setUser(null);
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const clearAuthStorage = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(TOKEN_TYPE_KEY);
    localStorage.removeItem(USER_KEY);
    // Clear cookie
    document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const tokenResponse: Token = await authApi.login(username, password);
      
      // Store token
      localStorage.setItem(ACCESS_TOKEN_KEY, tokenResponse.access_token);
      localStorage.setItem(TOKEN_TYPE_KEY, tokenResponse.token_type);
      setToken(tokenResponse.access_token);

      // Also set as cookie for SSE/EventSource requests
      document.cookie = `access_token=${tokenResponse.access_token}; path=/; SameSite=Lax`;

      // Fetch user info
      const currentUser = await authApi.me();
      setUser(currentUser);
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      if (token) {
        try {
          await authApi.logout();
        } catch (error) {
          // Ignore logout errors (token might already be invalid)
          console.warn('Logout API call failed:', error);
        }
      }
    } finally {
      clearAuthStorage();
      setToken(null);
      setUser(null);
      setIsLoading(false);
    }
  }, [token, clearAuthStorage]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    
    try {
      const currentUser = await authApi.me();
      setUser(currentUser);
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    } catch (error) {
      console.error('Failed to refresh user:', error);
      // If refresh fails, might need to re-login
      clearAuthStorage();
      setToken(null);
      setUser(null);
    }
  }, [token, clearAuthStorage]);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Export storage key for use in API client
export { ACCESS_TOKEN_KEY };
