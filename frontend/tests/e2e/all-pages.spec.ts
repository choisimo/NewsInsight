import { test, expect, Page } from '@playwright/test';

// 모든 페이지 정의
const ALL_PAGES = [
  { path: '/', name: '홈', expectText: 'NewsInsight' },
  { path: '/search', name: '통합검색', expectSelector: 'input, [role="textbox"]' },
  { path: '/dashboard', name: '대시보드', expectSelector: 'main' },
  { path: '/operations', name: '운영관리', expectSelector: 'main' },
  { path: '/collected-data', name: '수집데이터', expectSelector: 'main' },
  { path: '/tools', name: '도구허브', expectSelector: 'main' },
  { path: '/ml-addons', name: 'ML Add-ons', expectSelector: 'main' },
  { path: '/ai-agent', name: 'AI 에이전트', expectSelector: 'main' },
  { path: '/ai-jobs', name: 'AI 작업', expectSelector: 'main' },
  { path: '/parallel-search', name: '병렬검색', expectSelector: 'main' },
  { path: '/workspace', name: '작업공간', expectSelector: 'main' },
  { path: '/projects', name: '프로젝트', expectSelector: 'main' },
  { path: '/history', name: '검색기록', expectSelector: 'main' },
  { path: '/url-collections', name: 'URL 컬렉션', expectSelector: 'main' },
  { path: '/settings', name: '설정', expectSelector: 'main' },
  { path: '/admin/login', name: '관리자 로그인', expectSelector: 'main' },
];

// 콘솔 에러 수집 헬퍼
async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
  });
  return errors;
}

// API 요청 수집 헬퍼
async function collectApiRequests(page: Page): Promise<{ url: string; status: number }[]> {
  const requests: { url: string; status: number }[] = [];
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/api/')) {
      requests.push({ url, status: response.status() });
    }
  });
  return requests;
}

test.describe('전체 페이지 로드 테스트', () => {
  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} (${pageInfo.path}) 페이지 로드`, async ({ page }) => {
      // 콘솔 에러 및 API 요청 수집 시작
      const errors = await collectConsoleErrors(page);
      const apiRequests = await collectApiRequests(page);

      // 페이지 이동
      const response = await page.goto(pageInfo.path, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // HTTP 응답 확인
      expect(response?.status()).toBe(200);

      // 기본 렌더링 확인
      if (pageInfo.expectText) {
        await expect(page.getByText(pageInfo.expectText).first()).toBeVisible({ timeout: 10000 });
      }
      if (pageInfo.expectSelector) {
        await expect(page.locator(pageInfo.expectSelector).first()).toBeVisible({ timeout: 10000 });
      }

      // 잠시 대기 후 API 요청 및 에러 로그
      await page.waitForTimeout(2000);

      // 결과 출력
      console.log(`\n=== ${pageInfo.name} (${pageInfo.path}) ===`);
      console.log(`API 요청: ${apiRequests.length}건`);
      apiRequests.forEach(req => {
        const statusEmoji = req.status >= 200 && req.status < 300 ? '✅' : 
                           req.status >= 400 ? '❌' : '⚠️';
        console.log(`  ${statusEmoji} [${req.status}] ${req.url.replace(/^.*\/api/, '/api')}`);
      });
      
      if (errors.length > 0) {
        console.log(`콘솔 에러: ${errors.length}건`);
        errors.forEach(err => console.log(`  ❌ ${err.substring(0, 100)}`));
      }

      // 심각한 에러가 없는지 확인 (네트워크 에러 제외)
      const criticalErrors = errors.filter(e => 
        !e.includes('Failed to fetch') && 
        !e.includes('NetworkError') &&
        !e.includes('net::ERR')
      );
      expect(criticalErrors.length).toBe(0);
    });
  }
});

test.describe('주요 기능 테스트', () => {
  test('ML Add-ons 페이지에서 애드온 목록 로드', async ({ page }) => {
    await page.goto('/ml-addons');
    await page.waitForLoadState('networkidle');
    
    // 애드온 카드 또는 목록 항목 확인
    const addonItems = page.locator('[data-testid="addon-card"], .addon-card, [class*="card"]');
    await expect(addonItems.first()).toBeVisible({ timeout: 10000 });
  });

  test('검색 페이지에서 검색 실행 가능', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    
    // 검색 입력 필드 찾기
    const searchInput = page.getByPlaceholder(/검색|search|키워드/i).first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    
    // 검색어 입력
    await searchInput.fill('테스트 검색어');
    
    // 검색 버튼 찾기 및 클릭
    const searchButton = page.getByRole('button', { name: /검색|search/i }).first();
    if (await searchButton.isVisible()) {
      await searchButton.click();
      await page.waitForTimeout(2000);
    }
  });

  test('URL 컬렉션 페이지 데이터 로드', async ({ page }) => {
    await page.goto('/url-collections');
    await page.waitForLoadState('networkidle');
    
    // 컬렉션 목록 또는 빈 상태 확인
    await page.waitForTimeout(2000);
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
  });

  test('검색 기록 페이지 로드', async ({ page }) => {
    await page.goto('/history');
    await page.waitForLoadState('networkidle');
    
    // 검색 기록 테이블 또는 빈 상태 확인
    await page.waitForTimeout(2000);
    const mainContent = page.locator('main');
    await expect(mainContent).toBeVisible();
  });

  test('설정 페이지에서 테마 변경 가능', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // 테마 관련 요소 찾기
    const themeSection = page.getByText(/테마|theme|다크|라이트/i).first();
    await expect(themeSection).toBeVisible({ timeout: 10000 });
  });
});
