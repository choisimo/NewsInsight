import { test, expect } from '@playwright/test';

test.describe('홈 페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('홈 페이지가 정상적으로 로드됨', async ({ page }) => {
    // 페이지 제목 확인
    await expect(page).toHaveTitle(/NewsInsight/i);
    
    // 로고 또는 브랜드 텍스트 확인
    await expect(page.getByText('NewsInsight')).toBeVisible();
  });

  test('네비게이션 메뉴가 표시됨', async ({ page }) => {
    // 데스크톱에서 네비게이션 메뉴 확인
    const nav = page.locator('nav, [role="navigation"], header');
    await expect(nav.first()).toBeVisible();
  });

  test('검색 바로가기 버튼이 동작함', async ({ page }) => {
    // Ctrl+K 명령 팔레트 트리거 확인
    const commandButton = page.getByRole('button', { name: /검색/i });
    if (await commandButton.isVisible()) {
      await commandButton.click();
      // 명령 팔레트 또는 검색 다이얼로그가 열리는지 확인
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    }
  });

  test('알림 벨 아이콘이 표시됨', async ({ page }) => {
    const notificationBell = page.getByRole('button', { name: /알림/i });
    await expect(notificationBell).toBeVisible();
  });

  test('테마 토글이 동작함', async ({ page }) => {
    // 테마 토글 버튼 찾기
    const themeButton = page.getByRole('button', { name: /테마|theme/i });
    if (await themeButton.isVisible()) {
      await themeButton.click();
      // 드롭다운 메뉴가 열리는지 확인
      await expect(page.getByRole('menu')).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('검색 페이지', () => {
  test('검색 페이지로 이동 가능', async ({ page }) => {
    await page.goto('/search');
    
    // 검색 입력 필드 확인
    const searchInput = page.getByRole('textbox', { name: /검색|search/i })
      .or(page.getByPlaceholder(/검색|search/i));
    
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('대시보드', () => {
  test('대시보드 페이지로 이동 가능', async ({ page }) => {
    await page.goto('/dashboard');
    
    // 대시보드 컨텐츠 영역 확인
    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('설정 페이지', () => {
  test('설정 페이지로 이동 가능', async ({ page }) => {
    await page.goto('/settings');
    
    // 설정 페이지 컨텐츠 확인
    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('반응형 디자인', () => {
  test('모바일 뷰에서 하단 네비게이션이 표시됨', async ({ page }) => {
    // 모바일 뷰포트 설정
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // 모바일 하단 네비게이션 확인 (data-testid 또는 클래스로 찾기)
    const bottomNav = page.locator('[role="navigation"]').last();
    await expect(bottomNav).toBeVisible({ timeout: 5000 });
  });

  test('데스크톱 뷰에서 사이드 네비게이션이 표시됨', async ({ page }) => {
    // 데스크톱 뷰포트 설정
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    
    // 네비게이션 영역 확인
    await expect(page.locator('header')).toBeVisible();
  });
});
