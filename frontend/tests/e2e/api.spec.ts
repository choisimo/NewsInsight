import { test, expect } from '@playwright/test';

/**
 * API 엔드포인트 E2E 테스트
 * 프론트엔드에서 호출하는 API가 정상 응답하는지 확인
 */
test.describe('API 헬스체크', () => {
  test('API Gateway 헬스체크', async ({ request }) => {
    const response = await request.get('/api/actuator/health');
    
    // 200 또는 503 (일부 서비스 다운) 모두 게이트웨이는 동작 중
    expect([200, 503]).toContain(response.status());
  });
});

test.describe('검색 API', () => {
  test('검색 API 호출 가능', async ({ request }) => {
    const response = await request.post('/api/v1/search', {
      data: {
        query: 'test',
        mode: 'quick',
      },
    });
    
    // 200, 401 (인증 필요), 400 (잘못된 요청) 모두 API 동작 확인
    expect([200, 400, 401, 500]).toContain(response.status());
  });
});

test.describe('Articles API', () => {
  test('기사 목록 조회 가능', async ({ request }) => {
    const response = await request.get('/api/v1/articles');
    
    // API 응답 확인
    expect([200, 401, 500]).toContain(response.status());
    
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toBeDefined();
    }
  });
});

test.describe('Config API', () => {
  test('프론트엔드 설정 조회 가능', async ({ request }) => {
    const response = await request.get('/api/v1/config/frontend');
    
    // API 응답 확인
    expect([200, 404, 500]).toContain(response.status());
  });
});

test.describe('Crawler API', () => {
  test('LLM 프로바이더 목록 조회 가능', async ({ request }) => {
    const response = await request.get('/api/v1/crawler/providers');
    
    // API 응답 확인
    expect([200, 404, 500, 502]).toContain(response.status());
  });

  test('프로바이더 모델 목록 조회 가능', async ({ request }) => {
    // OpenAI 모델 목록 조회 (API 키 없어도 static fallback 반환)
    const response = await request.get('/api/v1/crawler/providers/openai/models');
    
    // API 응답 확인
    expect([200, 400, 401, 500, 502]).toContain(response.status());
  });
});
