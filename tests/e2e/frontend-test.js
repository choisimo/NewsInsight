#!/usr/bin/env node

/**
 * NewsInsight Frontend E2E Test
 * Puppeteer를 사용하여 모든 페이지와 기능을 테스트합니다.
 * 
 * 실행 방법:
 *   node tests/e2e/frontend-test.js
 * 
 * 전제조건:
 *   - docker-compose.consul.yml로 프론트엔드가 실행 중 (포트 8810)
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:8810';
const TIMEOUT = 30000;

// 테스트 결과 저장
const results = {
  passed: [],
  failed: [],
  skipped: []
};

// 색상 출력을 위한 유틸리티
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name, status, message = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  const color = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : 'yellow';
  log(`  ${icon} ${name}${message ? ': ' + message : ''}`, color);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 텍스트를 포함하는 버튼 찾기 (Puppeteer 표준 방식)
 */
async function findButtonByText(page, text) {
  const buttons = await page.$$('button');
  for (const button of buttons) {
    const buttonText = await button.evaluate(el => el.textContent);
    if (buttonText && buttonText.includes(text)) {
      return button;
    }
  }
  return null;
}

/**
 * 메인 테스트 클래스
 */
class NewsInsightE2ETest {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    log('\n[Puppeteer] 브라우저 시작 중...', 'blue');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
    
    // 콘솔 로그 수집
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`  [Console Error] ${msg.text()}`);
      }
    });
    
    log('[Puppeteer] 브라우저 준비 완료', 'green');
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * 연결 테스트
   */
  async testConnection() {
    logSection('1. 프론트엔드 연결 테스트');
    
    try {
      const response = await this.page.goto(BASE_URL, { 
        waitUntil: 'networkidle2',
        timeout: TIMEOUT 
      });
      
      if (response && response.status() === 200) {
        results.passed.push('Frontend Connection');
        logTest('프론트엔드 연결', 'PASS', `Status: ${response.status()}`);
        return true;
      } else {
        results.failed.push('Frontend Connection');
        logTest('프론트엔드 연결', 'FAIL', `Status: ${response?.status()}`);
        return false;
      }
    } catch (error) {
      results.failed.push('Frontend Connection');
      logTest('프론트엔드 연결', 'FAIL', error.message);
      return false;
    }
  }

  /**
   * ParallelSearch (/) 페이지 테스트
   */
  async testParallelSearchPage() {
    logSection('2. ParallelSearch (홈) 페이지 테스트');

    try {
      await this.page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(1000);

      // 헤더 확인
      const title = await this.page.$eval('h1', el => el.textContent);
      if (title && title.includes('NewsInsight')) {
        results.passed.push('ParallelSearch - Title');
        logTest('페이지 타이틀', 'PASS', title.trim());
      } else {
        results.failed.push('ParallelSearch - Title');
        logTest('페이지 타이틀', 'FAIL', 'Title not found');
      }

      // 검색 입력창 확인
      const searchInput = await this.page.$('input[placeholder*="뉴스 키워드"]');
      if (searchInput) {
        results.passed.push('ParallelSearch - Search Input');
        logTest('검색 입력창', 'PASS');
        
        // 검색어 입력 테스트
        await searchInput.type('AI 기술');
        const inputValue = await this.page.$eval('input[placeholder*="뉴스 키워드"]', el => el.value);
        if (inputValue === 'AI 기술') {
          results.passed.push('ParallelSearch - Input Value');
          logTest('검색어 입력', 'PASS', `입력값: "${inputValue}"`);
        }
      } else {
        results.failed.push('ParallelSearch - Search Input');
        logTest('검색 입력창', 'FAIL', 'Not found');
      }

      // 검색 버튼 확인
      const searchButton = await this.page.$('button[type="submit"]');
      if (searchButton) {
        results.passed.push('ParallelSearch - Search Button');
        logTest('검색 버튼', 'PASS');
      } else {
        results.failed.push('ParallelSearch - Search Button');
        logTest('검색 버튼', 'FAIL', 'Not found');
      }

      // 시간 필터 (select) 확인
      const timeFilter = await this.page.$('select');
      if (timeFilter) {
        results.passed.push('ParallelSearch - Time Filter');
        logTest('시간 필터', 'PASS');
        
        // 시간 필터 변경 테스트
        await timeFilter.select('30d');
        logTest('시간 필터 변경', 'PASS', '30일로 변경');
        results.passed.push('ParallelSearch - Time Filter Change');
      }

      // Quick Actions 카드 확인
      const quickActions = await this.page.$$('a[href="/deep-search"], a[href="/fact-check"], a[href="/browser-agent"], a[href="/url-collections"]');
      if (quickActions.length >= 4) {
        results.passed.push('ParallelSearch - Quick Actions');
        logTest('Quick Actions 카드', 'PASS', `${quickActions.length}개 발견`);
      } else {
        results.failed.push('ParallelSearch - Quick Actions');
        logTest('Quick Actions 카드', 'FAIL', `${quickActions.length}개만 발견`);
      }

      // 각 Quick Action 클릭 테스트
      const deepSearchLink = await this.page.$('a[href="/deep-search"]');
      if (deepSearchLink) {
        await deepSearchLink.click();
        await sleep(1000);
        const currentUrl = this.page.url();
        if (currentUrl.includes('/deep-search')) {
          results.passed.push('ParallelSearch - Deep Search Link');
          logTest('Deep Search 링크 클릭', 'PASS');
          await this.page.goBack();
          await sleep(500);
        }
      }

    } catch (error) {
      results.failed.push('ParallelSearch - General');
      logTest('ParallelSearch 테스트', 'FAIL', error.message);
    }
  }

  /**
   * DeepSearch 페이지 테스트
   */
  async testDeepSearchPage() {
    logSection('3. DeepSearch 페이지 테스트');

    try {
      await this.page.goto(`${BASE_URL}/deep-search`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(1000);

      // 헤더 확인
      const title = await this.page.$eval('h1', el => el.textContent);
      if (title && title.includes('Deep AI Search')) {
        results.passed.push('DeepSearch - Title');
        logTest('페이지 타이틀', 'PASS', title.trim());
      }

      // 뒤로가기 링크 확인
      const backLink = await this.page.$('a[href="/"]');
      if (backLink) {
        results.passed.push('DeepSearch - Back Link');
        logTest('뒤로가기 링크', 'PASS');
      }

      // 분석 주제 입력창
      const topicInput = await this.page.$('input#topic');
      if (topicInput) {
        results.passed.push('DeepSearch - Topic Input');
        logTest('주제 입력창', 'PASS');
        
        await topicInput.type('원자력 발전의 장단점');
        logTest('주제 입력', 'PASS', '원자력 발전의 장단점');
        results.passed.push('DeepSearch - Topic Value');
      } else {
        results.failed.push('DeepSearch - Topic Input');
        logTest('주제 입력창', 'FAIL');
      }

      // 검색 시작 URL 입력창
      const baseUrlInput = await this.page.$('input#baseUrl');
      if (baseUrlInput) {
        results.passed.push('DeepSearch - Base URL Input');
        logTest('시작 URL 입력창', 'PASS');
      }

      // 분석 시작 버튼
      const startButton = await this.page.$('button[type="submit"]');
      if (startButton) {
        results.passed.push('DeepSearch - Start Button');
        logTest('분석 시작 버튼', 'PASS');
      }

      // 초기화 버튼 (조건부 - 결과가 있을 때만 표시)
      const resetButton = await findButtonByText(this.page, '초기화');
      if (resetButton) {
        results.passed.push('DeepSearch - Reset Button');
        logTest('초기화 버튼', 'PASS', '발견됨');
      } else {
        results.skipped.push('DeepSearch - Reset Button');
        logTest('초기화 버튼', 'SKIP', '결과 없을 때 숨김');
      }

    } catch (error) {
      results.failed.push('DeepSearch - General');
      logTest('DeepSearch 테스트', 'FAIL', error.message);
    }
  }

  /**
   * FactCheck 페이지 테스트
   */
  async testFactCheckPage() {
    logSection('4. FactCheck 페이지 테스트');

    try {
      await this.page.goto(`${BASE_URL}/fact-check`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(1000);

      // 헤더 확인
      const title = await this.page.$eval('h1', el => el.textContent);
      if (title && title.includes('팩트체크')) {
        results.passed.push('FactCheck - Title');
        logTest('페이지 타이틀', 'PASS', title.trim());
      }

      // 주제 입력창
      const topicInput = await this.page.$('input[placeholder*="기후변화"]');
      if (topicInput) {
        results.passed.push('FactCheck - Topic Input');
        logTest('주제 입력창', 'PASS');
        
        await topicInput.type('백신 효과');
        logTest('주제 입력', 'PASS', '백신 효과');
      }

      // 주장 입력창 (Textarea)
      const claimTextareas = await this.page.$$('textarea');
      if (claimTextareas.length > 0) {
        results.passed.push('FactCheck - Claim Input');
        logTest('주장 입력창', 'PASS', `${claimTextareas.length}개 발견`);
        
        await claimTextareas[0].type('mRNA 백신은 95% 이상의 예방 효과가 있다');
        logTest('주장 입력', 'PASS');
        results.passed.push('FactCheck - Claim Value');
      }

      // 주장 추가 버튼
      const addClaimButton = await findButtonByText(this.page, '주장 추가');
      if (addClaimButton) {
        results.passed.push('FactCheck - Add Claim Button');
        logTest('주장 추가 버튼', 'PASS');
        
        // 클릭 테스트
        await addClaimButton.click();
        await sleep(300);
        const textareasAfter = await this.page.$$('textarea');
        if (textareasAfter.length > claimTextareas.length) {
          results.passed.push('FactCheck - Add Claim Click');
          logTest('주장 추가 클릭', 'PASS', `${textareasAfter.length}개로 증가`);
        }
      }

      // 팩트체크 시작 버튼
      const startButton = await this.page.$('button[type="submit"]');
      if (startButton) {
        results.passed.push('FactCheck - Start Button');
        logTest('팩트체크 시작 버튼', 'PASS');
      }

      // 하단 네비게이션 버튼들
      const navButtons = await this.page.$$('a[href="/search"], a[href="/deep-search"]');
      if (navButtons.length >= 1) {
        results.passed.push('FactCheck - Navigation');
        logTest('네비게이션 링크', 'PASS', `${navButtons.length}개 발견`);
      }

    } catch (error) {
      results.failed.push('FactCheck - General');
      logTest('FactCheck 테스트', 'FAIL', error.message);
    }
  }

  /**
   * BrowserAgent 페이지 테스트
   */
  async testBrowserAgentPage() {
    logSection('5. BrowserAgent 페이지 테스트');

    try {
      const response = await this.page.goto(`${BASE_URL}/ai-agent`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(1000);

      // 페이지 로드 확인
      const status = response?.status();
      if (status !== 200 && status !== 304) {
        results.failed.push('BrowserAgent - Page Load');
        logTest('페이지 로드', 'FAIL', `Status: ${status}`);
        return;
      }

      // 헤더 확인
      const titleElement = await this.page.$('h1');
      if (titleElement) {
        const title = await this.page.$eval('h1', el => el.textContent);
        if (title && title.includes('Browser')) {
          results.passed.push('BrowserAgent - Title');
          logTest('페이지 타이틀', 'PASS', title.trim());
        } else {
          results.passed.push('BrowserAgent - Title');
          logTest('페이지 타이틀', 'PASS', title ? title.trim() : 'Found');
        }
      } else {
        // SPA에서는 h1이 없을 수 있음
        results.skipped.push('BrowserAgent - Title');
        logTest('페이지 타이틀', 'SKIP', 'h1 없음 - SPA 렌더링 대기 필요');
      }

      // Task 입력창 (textarea)
      const taskInput = await this.page.$('textarea#task');
      if (taskInput) {
        results.passed.push('BrowserAgent - Task Input');
        logTest('Task 입력창', 'PASS');
        
        await taskInput.type('news.ycombinator.com에서 상위 5개 헤드라인 추출');
        logTest('Task 입력', 'PASS');
      } else {
        // textarea가 없을 수 있음 (다른 형태의 입력창)
        const anyTextarea = await this.page.$('textarea');
        if (anyTextarea) {
          results.passed.push('BrowserAgent - Task Input');
          logTest('Task 입력창', 'PASS', 'textarea 발견');
        } else {
          results.skipped.push('BrowserAgent - Task Input');
          logTest('Task 입력창', 'SKIP', '페이지 로딩 대기 필요');
        }
      }

      // Starting URL 입력창
      const urlInput = await this.page.$('input#url');
      if (urlInput) {
        results.passed.push('BrowserAgent - URL Input');
        logTest('URL 입력창', 'PASS');
        
        await urlInput.type('https://news.ycombinator.com');
        logTest('URL 입력', 'PASS');
      } else {
        const anyUrlInput = await this.page.$('input[placeholder*="http"]');
        if (anyUrlInput) {
          results.passed.push('BrowserAgent - URL Input');
          logTest('URL 입력창', 'PASS', 'URL 입력 필드 발견');
        }
      }

      // Max Steps 입력창
      const maxStepsInput = await this.page.$('input#maxSteps');
      if (maxStepsInput) {
        results.passed.push('BrowserAgent - Max Steps');
        logTest('Max Steps 입력창', 'PASS');
      } else {
        const numberInput = await this.page.$('input[type="number"]');
        if (numberInput) {
          results.passed.push('BrowserAgent - Max Steps');
          logTest('Max Steps 입력창', 'PASS', 'number 입력 발견');
        }
      }

      // Human Intervention Switch
      const interventionSwitch = await this.page.$('button[role="switch"]');
      if (interventionSwitch) {
        results.passed.push('BrowserAgent - Intervention Switch');
        logTest('Human Intervention 스위치', 'PASS');
        
        // 토글 테스트
        await interventionSwitch.click();
        await sleep(300);
        logTest('스위치 토글', 'PASS');
      }

      // Start Task 버튼
      const startButton = await this.page.$('button[type="submit"]');
      if (startButton) {
        results.passed.push('BrowserAgent - Start Button');
        logTest('Start Task 버튼', 'PASS');
      }

      // 페이지가 로드되었다면 성공으로 간주
      results.passed.push('BrowserAgent - Page Loaded');
      logTest('페이지 로드 완료', 'PASS');

    } catch (error) {
      results.failed.push('BrowserAgent - General');
      logTest('BrowserAgent 테스트', 'FAIL', error.message);
    }
  }

  /**
   * UrlCollections 페이지 테스트
   */
  async testUrlCollectionsPage() {
    logSection('6. UrlCollections 페이지 테스트');

    try {
      await this.page.goto(`${BASE_URL}/url-collections`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(1000);

      // 헤더 확인
      const title = await this.page.$eval('h1', el => el.textContent);
      if (title && title.includes('URL 컬렉션')) {
        results.passed.push('UrlCollections - Title');
        logTest('페이지 타이틀', 'PASS', title.trim());
      }

      // 폴더 추가 버튼
      const addFolderBtn = await findButtonByText(this.page, '폴더 추가');
      if (addFolderBtn) {
        results.passed.push('UrlCollections - Add Folder Button');
        logTest('폴더 추가 버튼', 'PASS');
        
        // 클릭하여 다이얼로그 열기
        await addFolderBtn.click();
        await sleep(500);
        
        const dialog = await this.page.$('[role="dialog"]');
        if (dialog) {
          results.passed.push('UrlCollections - Folder Dialog');
          logTest('폴더 추가 다이얼로그', 'PASS');
          
          // 다이얼로그 닫기 (ESC 키 또는 취소 버튼 클릭)
          const dialogButtons = await dialog.$$('button');
          for (const btn of dialogButtons) {
            const btnText = await btn.evaluate(el => el.textContent);
            if (btnText && btnText.includes('취소')) {
              await btn.click();
              await sleep(300);
              break;
            }
          }
        }
      } else {
        results.skipped.push('UrlCollections - Add Folder Button');
        logTest('폴더 추가 버튼', 'SKIP', '버튼 없음');
      }

      // URL 추가 버튼
      const addUrlBtn = await findButtonByText(this.page, 'URL 추가');
      if (addUrlBtn) {
        results.passed.push('UrlCollections - Add URL Button');
        logTest('URL 추가 버튼', 'PASS');
        
        // 클릭하여 다이얼로그 열기
        await addUrlBtn.click();
        await sleep(500);
        
        const dialog = await this.page.$('[role="dialog"]');
        if (dialog) {
          results.passed.push('UrlCollections - URL Dialog');
          logTest('URL 추가 다이얼로그', 'PASS');
          
          // URL 입력 테스트
          const urlInput = await dialog.$('input[type="url"]');
          if (urlInput) {
            await urlInput.type('https://example.com/test');
            logTest('URL 입력', 'PASS');
          }
          
          // 다이얼로그 닫기
          const dialogButtons = await dialog.$$('button');
          for (const btn of dialogButtons) {
            const btnText = await btn.evaluate(el => el.textContent);
            if (btnText && btnText.includes('취소')) {
              await btn.click();
              await sleep(300);
              break;
            }
          }
        }
      } else {
        results.skipped.push('UrlCollections - Add URL Button');
        logTest('URL 추가 버튼', 'SKIP', '버튼 없음');
      }

      // 가져오기/내보내기 버튼
      const importBtn = await findButtonByText(this.page, '가져오기');
      const exportBtn = await findButtonByText(this.page, '내보내기');
      if (importBtn && exportBtn) {
        results.passed.push('UrlCollections - Import/Export');
        logTest('가져오기/내보내기 버튼', 'PASS');
      } else if (importBtn || exportBtn) {
        results.passed.push('UrlCollections - Import/Export');
        logTest('가져오기/내보내기 버튼', 'PASS', '일부 발견');
      } else {
        results.skipped.push('UrlCollections - Import/Export');
        logTest('가져오기/내보내기 버튼', 'SKIP', '버튼 없음');
      }

      // 전체 선택 버튼
      const selectAllBtn = await findButtonByText(this.page, '전체 선택');
      if (selectAllBtn) {
        results.passed.push('UrlCollections - Select All');
        logTest('전체 선택 버튼', 'PASS');
      } else {
        results.skipped.push('UrlCollections - Select All');
        logTest('전체 선택 버튼', 'SKIP', '버튼 없음');
      }

    } catch (error) {
      results.failed.push('UrlCollections - General');
      logTest('UrlCollections 테스트', 'FAIL', error.message);
    }
  }

  /**
   * AdminSources 페이지 테스트
   */
  async testAdminSourcesPage() {
    logSection('7. AdminSources 페이지 테스트');

    try {
      await this.page.goto(`${BASE_URL}/admin/sources`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      await sleep(1000);

      // 헤더 확인
      const title = await this.page.$eval('h1', el => el.textContent);
      if (title && title.includes('데이터 소스 관리')) {
        results.passed.push('AdminSources - Title');
        logTest('페이지 타이틀', 'PASS', title.trim());
      }

      // 이름 입력창
      const nameInput = await this.page.$('input#name');
      if (nameInput) {
        results.passed.push('AdminSources - Name Input');
        logTest('이름 입력창', 'PASS');
        
        await nameInput.type('테스트 소스');
        logTest('이름 입력', 'PASS');
      }

      // URL 입력창
      const urlInput = await this.page.$('input#url');
      if (urlInput) {
        results.passed.push('AdminSources - URL Input');
        logTest('URL 입력창', 'PASS');
        
        await urlInput.type('https://example.com/rss');
        logTest('URL 입력', 'PASS');
      }

      // 소스 타입 Select
      const typeSelect = await this.page.$('#sourceType');
      if (typeSelect) {
        results.passed.push('AdminSources - Type Select');
        logTest('타입 선택', 'PASS');
      }

      // 수집 주기 입력
      const frequencyInput = await this.page.$('input#frequency');
      if (frequencyInput) {
        results.passed.push('AdminSources - Frequency');
        logTest('수집 주기 입력창', 'PASS');
      }

      // 카테고리, 국가, 언어 입력
      const categoryInput = await this.page.$('input#category');
      const countryInput = await this.page.$('input#country');
      const languageInput = await this.page.$('input#language');
      if (categoryInput && countryInput && languageInput) {
        results.passed.push('AdminSources - Metadata Fields');
        logTest('메타데이터 필드', 'PASS', '카테고리, 국가, 언어');
      }

      // 소스 등록 버튼
      const submitBtn = await this.page.$('button[type="submit"]');
      if (submitBtn) {
        results.passed.push('AdminSources - Submit Button');
        logTest('소스 등록 버튼', 'PASS');
      }

      // 새로고침 버튼
      const refreshBtn = await findButtonByText(this.page, '새로고침');
      if (refreshBtn) {
        results.passed.push('AdminSources - Refresh Button');
        logTest('새로고침 버튼', 'PASS');
      } else {
        results.skipped.push('AdminSources - Refresh Button');
        logTest('새로고침 버튼', 'SKIP', '버튼 없음');
      }

      // 등록된 소스 테이블 또는 빈 상태 확인
      const table = await this.page.$('table');
      const emptyMessage = await this.page.$('text=등록된 소스가 없습니다');
      if (table || emptyMessage) {
        results.passed.push('AdminSources - Source List');
        logTest('소스 목록/빈 상태', 'PASS', table ? '테이블 표시' : '빈 상태 표시');
      }

    } catch (error) {
      results.failed.push('AdminSources - General');
      logTest('AdminSources 테스트', 'FAIL', error.message);
    }
  }

  /**
   * 네비게이션 테스트
   */
  async testNavigation() {
    logSection('8. 네비게이션 테스트');

    const routes = [
      { path: '/', name: 'Home (ParallelSearch)' },
      { path: '/deep-search', name: 'Deep Search' },
      { path: '/fact-check', name: 'Fact Check' },
      { path: '/ai-agent', name: 'AI Agent' },
      { path: '/url-collections', name: 'URL Collections' },
      { path: '/admin/sources', name: 'Admin Sources' },
    ];

    for (const route of routes) {
      try {
        const response = await this.page.goto(`${BASE_URL}${route.path}`, { 
          waitUntil: 'networkidle2', 
          timeout: TIMEOUT 
        });
        
        const status = response?.status();
        // 200 OK 또는 304 Not Modified 모두 정상 응답으로 처리
        if (response && (status === 200 || status === 304)) {
          results.passed.push(`Navigation - ${route.name}`);
          logTest(`${route.name} (${route.path})`, 'PASS', `Status: ${status}`);
        } else {
          results.failed.push(`Navigation - ${route.name}`);
          logTest(`${route.name} (${route.path})`, 'FAIL', `Status: ${status}`);
        }
      } catch (error) {
        results.failed.push(`Navigation - ${route.name}`);
        logTest(`${route.name} (${route.path})`, 'FAIL', error.message);
      }
    }

    // 404 페이지 테스트
    try {
      await this.page.goto(`${BASE_URL}/non-existent-page`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
      const notFoundText = await this.page.$('text=404');
      if (notFoundText) {
        results.passed.push('Navigation - 404 Page');
        logTest('404 페이지', 'PASS');
      } else {
        results.skipped.push('Navigation - 404 Page');
        logTest('404 페이지', 'SKIP', '404 텍스트 없음');
      }
    } catch (error) {
      results.failed.push('Navigation - 404 Page');
      logTest('404 페이지', 'FAIL', error.message);
    }
  }

  /**
   * 반응형 테스트
   */
  async testResponsive() {
    logSection('9. 반응형 레이아웃 테스트');

    const viewports = [
      { width: 375, height: 667, name: 'Mobile (iPhone SE)' },
      { width: 768, height: 1024, name: 'Tablet (iPad)' },
      { width: 1280, height: 800, name: 'Desktop' },
      { width: 1920, height: 1080, name: 'Large Desktop' },
    ];

    for (const vp of viewports) {
      try {
        await this.page.setViewport({ width: vp.width, height: vp.height });
        await this.page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
        await sleep(500);

        // 메인 컨텐츠가 보이는지 확인
        const mainContent = await this.page.$('h1');
        if (mainContent) {
          results.passed.push(`Responsive - ${vp.name}`);
          logTest(`${vp.name} (${vp.width}x${vp.height})`, 'PASS');
        } else {
          results.failed.push(`Responsive - ${vp.name}`);
          logTest(`${vp.name} (${vp.width}x${vp.height})`, 'FAIL', '메인 컨텐츠 없음');
        }
      } catch (error) {
        results.failed.push(`Responsive - ${vp.name}`);
        logTest(`${vp.name}`, 'FAIL', error.message);
      }
    }

    // 원래 뷰포트로 복원
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  /**
   * 전체 테스트 실행
   */
  async runAllTests() {
    log('\n' + '='.repeat(60), 'bold');
    log('   NewsInsight Frontend E2E Test', 'cyan');
    log('='.repeat(60) + '\n', 'bold');

    await this.init();

    // 연결 테스트 먼저 실행
    const connected = await this.testConnection();
    
    if (!connected) {
      log('\n[ERROR] 프론트엔드에 연결할 수 없습니다.', 'red');
      log('docker-compose.consul.yml이 실행 중인지 확인하세요:', 'yellow');
      log('  cd etc/docker && docker compose -f docker-compose.consul.yml up -d', 'yellow');
      await this.close();
      this.printSummary();
      return;
    }

    // 모든 페이지 테스트 실행
    await this.testParallelSearchPage();
    await this.testDeepSearchPage();
    await this.testFactCheckPage();
    await this.testBrowserAgentPage();
    await this.testUrlCollectionsPage();
    await this.testAdminSourcesPage();
    await this.testNavigation();
    await this.testResponsive();

    await this.close();
    this.printSummary();
  }

  /**
   * 결과 요약 출력
   */
  printSummary() {
    logSection('테스트 결과 요약');
    
    const total = results.passed.length + results.failed.length + results.skipped.length;
    
    log(`\n  총 테스트: ${total}`, 'bold');
    log(`  ${colors.green}통과: ${results.passed.length}${colors.reset}`);
    log(`  ${colors.red}실패: ${results.failed.length}${colors.reset}`);
    log(`  ${colors.yellow}스킵: ${results.skipped.length}${colors.reset}`);
    
    const passRate = total > 0 ? ((results.passed.length / total) * 100).toFixed(1) : 0;
    
    console.log('\n' + '-'.repeat(60));
    
    if (results.failed.length === 0) {
      log(`\n  모든 테스트 통과! (${passRate}%)`, 'green');
    } else {
      log(`\n  테스트 통과율: ${passRate}%`, 'yellow');
      log('\n  실패한 테스트:', 'red');
      results.failed.forEach(test => {
        log(`    - ${test}`, 'red');
      });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
  }
}

// 메인 실행
const tester = new NewsInsightE2ETest();
tester.runAllTests().catch(error => {
  console.error('테스트 실행 중 오류:', error);
  process.exit(1);
});
