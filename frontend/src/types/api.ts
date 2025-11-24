export interface SentimentData {
  pos: number;
  neg: number;
  neu: number;
}

export interface KeywordData {
  word: string;
  score: number;
}

export interface AnalysisResponse {
  query: string;
  window: string;
  article_count: number;
  sentiments: SentimentData;
  top_keywords: KeywordData[];
  analyzed_at: string;
}

export interface Article {
  id: string;
  title: string;
  source: string;
  published_at: string;
  url: string;
  snippet?: string;
}

export interface ArticlesResponse {
  query: string;
  articles: Article[];
  total: number;
}

export type SourceType = "RSS" | "WEB" | "API" | "WEBHOOK";

export interface DataSource {
  id: number;
  name: string;
  url: string;
  sourceType: SourceType;
  isActive: boolean;
  lastCollected: string | null;
  collectionFrequency: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}
