import axios from 'axios';
import type { AnalysisResponse, ArticlesResponse } from '@/types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const getAnalysis = async (query: string, window: string = '7d'): Promise<AnalysisResponse> => {
  const response = await api.get('/api/v1/analysis', {
    params: { query, window }
  });
  return response.data;
};

export const getArticles = async (query: string, limit: number = 50): Promise<ArticlesResponse> => {
  const response = await api.get('/api/v1/articles', {
    params: { query, limit }
  });
  return response.data;
};
