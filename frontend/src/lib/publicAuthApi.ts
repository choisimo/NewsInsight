/**
 * Public Auth API - 일반 사용자용 인증 API
 * 
 * 엔드포인트: /api/v1/auth/...
 * - 회원가입, 로그인, 내 정보 조회 등
 */

import { getApiClient } from './api';
import type { Token, User } from '@/types/admin';

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface UsernameCheckResponse {
  username: string;
  available: boolean;
}

export interface EmailCheckResponse {
  email: string;
  available: boolean;
}

/**
 * 일반 사용자용 공개 인증 API
 */
export const publicAuthApi = {
  /**
   * 회원가입
   * - 성공 시 즉시 토큰 반환 (자동 로그인)
   */
  register: async (data: RegisterRequest): Promise<Token> => {
    const client = await getApiClient();
    const response = await client.post<Token>('/api/v1/auth/register', data);
    return response.data;
  },

  /**
   * 로그인
   */
  login: async (username: string, password: string): Promise<Token> => {
    const client = await getApiClient();
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await client.post<Token>('/api/v1/auth/token', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return response.data;
  },

  /**
   * 로그아웃
   */
  logout: async (): Promise<void> => {
    const client = await getApiClient();
    await client.post('/api/v1/auth/logout');
  },

  /**
   * 현재 사용자 정보 조회
   */
  me: async (): Promise<User> => {
    const client = await getApiClient();
    const response = await client.get<User>('/api/v1/auth/me');
    return response.data;
  },

  /**
   * 비밀번호 변경
   */
  changePassword: async (oldPassword: string, newPassword: string): Promise<void> => {
    const client = await getApiClient();
    await client.post('/api/v1/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    });
  },

  /**
   * 계정 삭제 (회원탈퇴)
   */
  deleteAccount: async (): Promise<void> => {
    const client = await getApiClient();
    await client.delete('/api/v1/auth/me');
  },

  /**
   * 사용자명 중복 확인
   */
  checkUsername: async (username: string): Promise<UsernameCheckResponse> => {
    const client = await getApiClient();
    const response = await client.get<UsernameCheckResponse>(`/api/v1/auth/check-username/${encodeURIComponent(username)}`);
    return response.data;
  },

  /**
   * 이메일 중복 확인
   */
  checkEmail: async (email: string): Promise<EmailCheckResponse> => {
    const client = await getApiClient();
    const response = await client.get<EmailCheckResponse>(`/api/v1/auth/check-email/${encodeURIComponent(email)}`);
    return response.data;
  },

  /**
   * 이메일 인증 코드 발송 (회원가입 1단계)
   */
  sendVerification: async (data: RegisterRequest): Promise<{
    success: boolean;
    message: string;
    email: string;
    expires_in: number;
    code?: string; // 개발 환경에서만 반환
  }> => {
    const client = await getApiClient();
    const response = await client.post('/api/v1/auth/send-verification', data);
    return response.data;
  },

  /**
   * 이메일 인증 코드 검증 및 회원가입 완료 (회원가입 2단계)
   */
  verifyEmail: async (email: string, code: string): Promise<Token> => {
    const client = await getApiClient();
    const response = await client.post<Token>('/api/v1/auth/verify-email', { email, code });
    return response.data;
  },

  /**
   * 인증 코드 재발송
   */
  resendVerification: async (email: string): Promise<{
    success: boolean;
    message: string;
    email: string;
    expires_in: number;
    code?: string;
  }> => {
    const client = await getApiClient();
    const response = await client.post('/api/v1/auth/resend-verification', { email });
    return response.data;
  },
};

export default publicAuthApi;
