import { defineConfig, devices } from '@playwright/test';

/**
 * NewsInsight Frontend E2E 테스트 설정
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  
  /* 테스트 병렬 실행 */
  fullyParallel: true,
  
  /* CI에서 재시도 비활성화 */
  forbidOnly: !!process.env.CI,
  
  /* CI에서 실패 시 2번 재시도 */
  retries: process.env.CI ? 2 : 0,
  
  /* CI에서 병렬 워커 수 제한 */
  workers: process.env.CI ? 1 : undefined,
  
  /* 리포터 설정 */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  
  /* 모든 테스트에 적용되는 설정 */
  use: {
    /* 테스트 실패 시 스크린샷 저장 */
    screenshot: 'only-on-failure',
    
    /* 테스트 실패 시 트레이스 저장 */
    trace: 'on-first-retry',
    
    /* 기본 URL */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8080',
    
    /* 요청 타임아웃 */
    actionTimeout: 15000,
    
    /* 네비게이션 타임아웃 */
    navigationTimeout: 30000,
  },

  /* 프로젝트 설정 - 다양한 브라우저 테스트 */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* 모바일 뷰포트 테스트 */
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  /* 로컬 개발 서버 자동 시작 (CI에서는 별도 실행 필요) */
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  
  /* 테스트 출력 디렉토리 */
  outputDir: 'test-results/',
});
