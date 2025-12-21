/**
 * Anonymous Session Management
 * 
 * Generates and manages unique session IDs for anonymous users to prevent
 * data leakage between different browser sessions.
 */

const SESSION_ID_KEY = 'anonymous_session_id';
const DEVICE_ID_KEY = 'anonymous_device_id';

/**
 * Generate a unique session ID
 * Format: sess-{timestamp}-{random}
 */
function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `sess-${timestamp}-${random}`;
}

/**
 * Generate a unique device ID (persistent across sessions)
 * Format: device-{uuid}
 */
function generateDeviceId(): string {
  const uuid = crypto.randomUUID();
  return `device-${uuid}`;
}

/**
 * Get or create session ID for the current browser session
 * Session ID is stored in sessionStorage (cleared when browser tab closes)
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') {
    return generateSessionId();
  }

  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  
  if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    console.log('[AnonymousSession] New session ID generated:', sessionId);
  }
  
  return sessionId;
}

/**
 * Get or create device ID for long-term tracking
 * Device ID is stored in localStorage (persistent across sessions)
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') {
    return generateDeviceId();
  }

  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    deviceId = generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    console.log('[AnonymousSession] New device ID generated:', deviceId);
  }
  
  return deviceId;
}

/**
 * Clear session ID (useful for testing or manual session reset)
 */
export function clearSessionId(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_ID_KEY);
    console.log('[AnonymousSession] Session ID cleared');
  }
}

/**
 * Clear device ID (useful for testing)
 */
export function clearDeviceId(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(DEVICE_ID_KEY);
    console.log('[AnonymousSession] Device ID cleared');
  }
}

/**
 * Get session info for debugging
 */
export function getSessionInfo(): {
  sessionId: string;
  deviceId: string;
  isNewSession: boolean;
} {
  const sessionId = getSessionId();
  const deviceId = getDeviceId();
  
  return {
    sessionId,
    deviceId,
    isNewSession: typeof window !== 'undefined' && !sessionStorage.getItem(SESSION_ID_KEY),
  };
}
