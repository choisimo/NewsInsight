import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Token, User, SetupStatus } from '@/types/admin';
import { authApi } from '@/lib/adminApi';
import { resetApiClient } from '@/lib/api';

// Storage keys
const ACCESS_TOKEN_KEY = 'access_token';
// Note: Refresh token is now stored in HTTP-Only cookie, not localStorage
const TOKEN_TYPE_KEY = 'token_type';
const USER_KEY = 'admin_user';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  passwordChangeRequired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  checkSetupStatus: () => Promise<SetupStatus | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearAuthStorage = useCallback(() => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(TOKEN_TYPE_KEY);
    localStorage.removeItem(USER_KEY);
    // Clear access token cookie
    document.cookie = 'access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // Note: HTTP-Only refresh token cookie is cleared by the logout endpoint
    // Reset API client to clear any cached state
    resetApiClient();
  }, []);

  // Listen for token refresh events from API interceptor
  useEffect(() => {
    const handleTokenRefreshed = (event: CustomEvent<{ accessToken: string }>) => {
      const { accessToken } = event.detail;
      
      // Update state with new access token
      // Note: Refresh token is handled via HTTP-Only cookie
      setToken(accessToken);
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      document.cookie = `access_token=${accessToken}; path=/; SameSite=Lax`;
      
      console.log('Token refreshed successfully via interceptor');
    };

    const handleUnauthorized = () => {
      console.warn('Received unauthorized event, clearing auth state');
      clearAuthStorage();
      setToken(null);
      setUser(null);
    };

    window.addEventListener('auth:tokenRefreshed', handleTokenRefreshed as EventListener);
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:tokenRefreshed', handleTokenRefreshed as EventListener);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [clearAuthStorage]);

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
          // The API interceptor will automatically refresh if needed
          // (using HTTP-Only cookie for refresh token)
          try {
            const currentUser = await authApi.me();
            setUser(currentUser);
            localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
          } catch (error) {
            // Token refresh also failed (handled by interceptor)
            // Check if we still have a valid token after potential refresh
            const currentToken = localStorage.getItem(ACCESS_TOKEN_KEY);
            if (!currentToken) {
              console.warn('Token validation and refresh failed, clearing auth state:', error);
              clearAuthStorage();
              setToken(null);
              setUser(null);
            } else {
              // Token was refreshed, update state
              setToken(currentToken);
              try {
                const currentUser = await authApi.me();
                setUser(currentUser);
                localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
              } catch {
                // Still failing after refresh, clear everything
                clearAuthStorage();
                setToken(null);
                setUser(null);
              }
            }
          }
        } else {
          // No access token - try to refresh using HTTP-Only cookie
          // The cookie is sent automatically by the browser
          try {
            const tokenResponse = await authApi.refresh();
            
            // Store new access token (refresh token is in HTTP-Only cookie)
            localStorage.setItem(ACCESS_TOKEN_KEY, tokenResponse.access_token);
            localStorage.setItem(TOKEN_TYPE_KEY, tokenResponse.token_type);
            setToken(tokenResponse.access_token);
            document.cookie = `access_token=${tokenResponse.access_token}; path=/; SameSite=Lax`;

            // Fetch user info
            const currentUser = await authApi.me();
            setUser(currentUser);
            localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
          } catch {
            // No valid refresh token cookie, user needs to login
            // This is expected for new sessions
          }
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [clearAuthStorage]);

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const tokenResponse: Token = await authApi.login(username, password);
      
      // Store access token (refresh token is set as HTTP-Only cookie by server)
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
      // The API interceptor will handle token refresh
      // If we get here, token refresh also failed
      const currentToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (!currentToken) {
        clearAuthStorage();
        setToken(null);
        setUser(null);
      }
    }
  }, [token, clearAuthStorage]);

  const checkSetupStatus = useCallback(async (): Promise<SetupStatus | null> => {
    try {
      return await authApi.getSetupStatus();
    } catch (error) {
      console.error('Failed to check setup status:', error);
      return null;
    }
  }, []);

  // Compute password change required status
  const passwordChangeRequired = user?.password_change_required ?? false;

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    isLoading,
    passwordChangeRequired,
    login,
    logout,
    refreshUser,
    checkSetupStatus,
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

// Export storage keys for use in API client
export { ACCESS_TOKEN_KEY };
