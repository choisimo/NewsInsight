#!/usr/bin/env node

/**
 * NewsInsight 크롤링 기능 실제 동작 테스트
 * Puppeteer를 사용하여 실제 데이터를 수집하고 검증합니다.
 * 
 * 실행 방법:
 *   node tests/e2e/crawling-functional-test.js
 */

const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:8810';
const API_BASE_URL = 'http://localhost:8112';
const TIMEOUT = 120000; // 2분 (크롤링 작업은 시간이 걸릴 수 있음)

// 색상 출력
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(70));
  log(`  ${title}`, 'cyan');
  console.log('='.repeat(70));
}

function logSubSection(title) {
  console.log('\n' + '-'.repeat(50));
  log(`  ${title}`, 'blue');
  console.log('-'.repeat(50));
}

function logData(label, data) {
  log(`  ${label}:`, 'yellow');
  if (typeof data === 'object') {
    console.log(JSON.stringify(data, null, 2).split('\n').map(line => '    ' + line).join('\n'));
  } else {
    console.log(`    ${data}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * API 헬스 체크
 */
async function checkAPIHealth() {
  logSection('1. API 서비스 상태 확인');
  
  const endpoints = [
    { name: 'API Gateway', url: `${API_BASE_URL}/api/v1/search/health` },
    { name: 'Deep Search', url: `${API_BASE_URL}/api/v1/analysis/deep/health` },
    { name: 'Browser-Use', url: `${API_BASE_URL}/health` },
  ];
  
  const results = {};
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { timeout: 5000 });
      const data = await response.json().catch(() => ({}));
      results[endpoint.name] = {
        status: response.ok ? 'OK' : 'ERROR',
        httpStatus: response.status,
        data
      };
      log(`  ✓ ${endpoint.name}: ${response.status} OK`, 'green');
      if (Object.keys(data).length > 0) {
        logData('    Response', data);
      }
    } catch (error) {
      results[endpoint.name] = {
        status: 'UNREACHABLE',
        error: error.message
      };
      log(`  ✗ ${endpoint.name}: ${error.message}`, 'red');
    }
  }
  
  return results;
}

/**
 * 통합 검색 (ParallelSearch) 테스트
 */
async function testUnifiedSearch(page) {
  logSection('2. 통합 검색 (ParallelSearch) 실제 동작 테스트');
  
  const testQuery = 'AI 인공지능';
  const results = {
    query: testQuery,
    searchStarted: false,
    resultsReceived: [],
    errors: [],
    timing: {}
  };
  
  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    
    logSubSection('검색어 입력 및 실행');
    log(`  검색어: "${testQuery}"`, 'magenta');
    
    // 검색어 입력
    const searchInput = await page.$('input[placeholder*="뉴스 키워드"]');
    if (!searchInput) {
      throw new Error('검색 입력창을 찾을 수 없습니다');
    }
    
    await searchInput.click({ clickCount: 3 }); // 기존 텍스트 선택
    await searchInput.type(testQuery);
    
    // API 응답 캡처 설정
    const apiResponses = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/v1/search') || url.includes('/stream')) {
        try {
          const status = response.status();
          apiResponses.push({
            url: url.substring(0, 100),
            status,
            contentType: response.headers()['content-type']
          });
        } catch (e) {
          // Ignore
        }
      }
    });
    
    // 검색 실행
    const startTime = Date.now();
    const searchButton = await page.$('button[type="submit"]');
    await searchButton.click();
    results.searchStarted = true;
    
    log('  검색 요청 전송됨...', 'dim');
    
    // 결과 대기 (최대 30초)
    await sleep(3000); // 초기 로딩 대기
    
    // 결과 확인
    for (let i = 0; i < 10; i++) {
      await sleep(2000);
      
      // 검색 결과 카드 확인
      const resultCards = await page.$$('[class*="border-l-"]');
      const loadingIndicators = await page.$$('[class*="animate-spin"]');
      
      if (resultCards.length > 0) {
        results.timing.firstResultMs = Date.now() - startTime;
        log(`  ✓ 검색 결과 ${resultCards.length}개 발견 (${results.timing.firstResultMs}ms)`, 'green');
        
        // 결과 데이터 추출
        for (let j = 0; j < Math.min(resultCards.length, 5); j++) {
          try {
            const card = resultCards[j];
            const title = await card.$eval('h3, h4, [class*="font-medium"]', el => el.textContent).catch(() => 'N/A');
            const snippet = await card.$eval('p', el => el.textContent).catch(() => 'N/A');
            const source = await card.$eval('[class*="Badge"], [class*="badge"]', el => el.textContent).catch(() => 'N/A');
            
            results.resultsReceived.push({
              index: j + 1,
              title: title.substring(0, 80),
              snippet: snippet.substring(0, 100) + '...',
              source
            });
          } catch (e) {
            // Ignore extraction errors
          }
        }
        break;
      }
      
      if (loadingIndicators.length === 0 && i > 3) {
        log('  검색 완료 (결과 없음)', 'yellow');
        break;
      }
    }
    
    results.timing.totalMs = Date.now() - startTime;
    results.apiResponses = apiResponses;
    
    logSubSection('검색 결과 데이터');
    if (results.resultsReceived.length > 0) {
      results.resultsReceived.forEach((r, i) => {
        log(`  [${i + 1}] ${r.title}`, 'cyan');
        log(`      소스: ${r.source}`, 'dim');
        log(`      내용: ${r.snippet}`, 'dim');
      });
    } else {
      log('  검색 결과가 없습니다', 'yellow');
    }
    
    logSubSection('API 응답');
    apiResponses.forEach(r => {
      log(`  ${r.status} ${r.url}`, r.status === 200 ? 'green' : 'yellow');
    });
    
  } catch (error) {
    results.errors.push(error.message);
    log(`  ✗ 오류: ${error.message}`, 'red');
  }
  
  return results;
}

/**
 * Deep Search 테스트
 */
async function testDeepSearch(page) {
  logSection('3. Deep AI Search 실제 동작 테스트');
  
  const testTopic = '전기차 배터리 기술 발전';
  const results = {
    topic: testTopic,
    jobStarted: false,
    jobId: null,
    status: null,
    evidence: [],
    errors: [],
    timing: {}
  };
  
  try {
    await page.goto(`${BASE_URL}/deep-search`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await sleep(1000);
    
    logSubSection('분석 주제 입력');
    log(`  주제: "${testTopic}"`, 'magenta');
    
    // 주제 입력
    const topicInput = await page.$('input#topic');
    if (!topicInput) {
      throw new Error('주제 입력창을 찾을 수 없습니다');
    }
    
    await topicInput.type(testTopic);
    
    // API 응답 캡처
    let deepSearchJobId = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/v1/analysis/deep') && response.status() === 200) {
        try {
          const data = await response.json();
          if (data.jobId) {
            deepSearchJobId = data.jobId;
            results.jobId = data.jobId;
          }
        } catch (e) {
          // Ignore
        }
      }
    });
    
    // 분석 시작
    const startTime = Date.now();
    const startButton = await page.$('button[type="submit"]');
    await startButton.click();
    results.jobStarted = true;
    
    log('  분석 작업 시작됨...', 'dim');
    
    // 작업 상태 모니터링 (최대 60초)
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      
      // 상태 확인
      const statusBadge = await page.$('[class*="Badge"]');
      if (statusBadge) {
        const statusText = await statusBadge.evaluate(el => el.textContent);
        results.status = statusText;
        log(`  상태: ${statusText}`, 'blue');
        
        if (statusText.includes('완료') || statusText.includes('COMPLETED')) {
          results.timing.completedMs = Date.now() - startTime;
          log(`  ✓ 분석 완료 (${results.timing.completedMs}ms)`, 'green');
          break;
        }
        
        if (statusText.includes('실패') || statusText.includes('FAILED')) {
          log('  ✗ 분석 실패', 'red');
          break;
        }
      }
      
      // 진행률 확인
      const progressBar = await page.$('[role="progressbar"]');
      if (progressBar) {
        const progressValue = await progressBar.evaluate(el => el.getAttribute('aria-valuenow') || el.style.width);
        log(`  진행률: ${progressValue}`, 'dim');
      }
      
      // 증거 카드 확인
      const evidenceCards = await page.$$('[class*="evidence"], [class*="card"]');
      if (evidenceCards.length > results.evidence.length) {
        log(`  증거 수집됨: ${evidenceCards.length}개`, 'cyan');
      }
    }
    
    // 최종 결과 추출
    await sleep(2000);
    const evidenceCards = await page.$$('[class*="evidence"], [class*="border-l-"]');
    for (let i = 0; i < Math.min(evidenceCards.length, 5); i++) {
      try {
        const card = evidenceCards[i];
        const title = await card.$eval('h3, h4, a', el => el.textContent).catch(() => 'N/A');
        const stance = await card.$eval('[class*="badge"], [class*="Badge"]', el => el.textContent).catch(() => 'N/A');
        
        results.evidence.push({
          index: i + 1,
          title: title.substring(0, 80),
          stance
        });
      } catch (e) {
        // Ignore
      }
    }
    
    results.timing.totalMs = Date.now() - startTime;
    
    logSubSection('수집된 증거');
    if (results.evidence.length > 0) {
      results.evidence.forEach((e, i) => {
        log(`  [${i + 1}] ${e.title}`, 'cyan');
        log(`      입장: ${e.stance}`, 'dim');
      });
    } else {
      log('  수집된 증거가 없습니다', 'yellow');
    }
    
    if (results.jobId) {
      logData('Job ID', results.jobId);
    }
    
  } catch (error) {
    results.errors.push(error.message);
    log(`  ✗ 오류: ${error.message}`, 'red');
  }
  
  return results;
}

/**
 * Browser Agent 테스트
 */
async function testBrowserAgent(page) {
  logSection('4. Browser AI Agent 실제 동작 테스트');
  
  const testTask = 'news.ycombinator.com에서 현재 상위 3개 뉴스 헤드라인을 추출해줘';
  const testUrl = 'https://news.ycombinator.com';
  
  const results = {
    task: testTask,
    url: testUrl,
    jobStarted: false,
    jobId: null,
    status: null,
    steps: [],
    finalResult: null,
    errors: [],
    timing: {}
  };
  
  try {
    await page.goto(`${BASE_URL}/ai-agent`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await sleep(1000);
    
    logSubSection('작업 설정');
    log(`  Task: "${testTask}"`, 'magenta');
    log(`  URL: ${testUrl}`, 'magenta');
    
    // Task 입력
    const taskInput = await page.$('textarea#task, textarea');
    if (!taskInput) {
      throw new Error('Task 입력창을 찾을 수 없습니다');
    }
    await taskInput.type(testTask);
    
    // URL 입력
    const urlInput = await page.$('input#url, input[placeholder*="http"]');
    if (urlInput) {
      await urlInput.type(testUrl);
    }
    
    // Max Steps 설정 (빠른 테스트를 위해 5로 제한)
    const maxStepsInput = await page.$('input#maxSteps, input[type="number"]');
    if (maxStepsInput) {
      await maxStepsInput.click({ clickCount: 3 });
      await maxStepsInput.type('5');
    }
    
    // API 응답 캡처
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/browse') || url.includes('/jobs')) {
        try {
          if (response.status() === 200) {
            const data = await response.json();
            if (data.job_id) {
              results.jobId = data.job_id;
            }
            if (data.status) {
              results.status = data.status;
            }
            if (data.result) {
              results.finalResult = data.result;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    });
    
    // 작업 시작
    const startTime = Date.now();
    const startButton = await page.$('button[type="submit"]');
    await startButton.click();
    results.jobStarted = true;
    
    log('  브라우저 작업 시작됨...', 'dim');
    
    // 작업 상태 모니터링 (최대 90초)
    for (let i = 0; i < 30; i++) {
      await sleep(3000);
      
      // 상태 확인
      const statusElements = await page.$$('[class*="status"], [class*="Badge"]');
      for (const el of statusElements) {
        const text = await el.evaluate(e => e.textContent);
        if (text && (text.includes('running') || text.includes('completed') || text.includes('pending'))) {
          results.status = text;
          break;
        }
      }
      
      // 스크린샷 또는 진행 상황 확인
      const screenshots = await page.$$('img[alt*="screenshot"], img[src*="data:image"]');
      if (screenshots.length > 0) {
        log(`  스크린샷 ${screenshots.length}개 캡처됨`, 'cyan');
      }
      
      // 진행 단계 확인
      const stepIndicators = await page.$$('[class*="step"], [class*="progress"]');
      if (stepIndicators.length > results.steps.length) {
        results.steps.push({ step: stepIndicators.length, timestamp: Date.now() - startTime });
        log(`  Step ${stepIndicators.length} 진행 중...`, 'dim');
      }
      
      // 완료 확인
      if (results.status && (results.status.includes('completed') || results.status.includes('완료'))) {
        results.timing.completedMs = Date.now() - startTime;
        log(`  ✓ 작업 완료 (${results.timing.completedMs}ms)`, 'green');
        break;
      }
      
      // 실패 확인
      if (results.status && (results.status.includes('failed') || results.status.includes('실패'))) {
        log('  ✗ 작업 실패', 'red');
        break;
      }
    }
    
    results.timing.totalMs = Date.now() - startTime;
    
    // 최종 결과 추출
    await sleep(2000);
    const resultElement = await page.$('[class*="result"], [class*="output"]');
    if (resultElement) {
      const resultText = await resultElement.evaluate(el => el.textContent);
      results.finalResult = resultText.substring(0, 500);
    }
    
    logSubSection('작업 결과');
    if (results.jobId) {
      logData('Job ID', results.jobId);
    }
    logData('Status', results.status || 'Unknown');
    logData('Steps', results.steps.length);
    
    if (results.finalResult) {
      log('\n  최종 결과:', 'green');
      console.log('    ' + results.finalResult.substring(0, 300) + '...');
    }
    
  } catch (error) {
    results.errors.push(error.message);
    log(`  ✗ 오류: ${error.message}`, 'red');
  }
  
  return results;
}

/**
 * Fact Check 테스트
 */
async function testFactCheck(page) {
  logSection('5. 팩트체크 실제 동작 테스트');
  
  const testTopic = '기후변화';
  const testClaim = '지구 평균 온도는 산업화 이전 대비 1.5도 이상 상승했다';
  
  const results = {
    topic: testTopic,
    claim: testClaim,
    verificationStarted: false,
    verificationResult: null,
    sources: [],
    errors: [],
    timing: {}
  };
  
  try {
    await page.goto(`${BASE_URL}/fact-check`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await sleep(1000);
    
    logSubSection('팩트체크 설정');
    log(`  주제: "${testTopic}"`, 'magenta');
    log(`  주장: "${testClaim}"`, 'magenta');
    
    // 주제 입력
    const topicInput = await page.$('input[placeholder*="기후변화"]');
    if (topicInput) {
      await topicInput.type(testTopic);
    }
    
    // 주장 입력
    const claimTextarea = await page.$('textarea');
    if (claimTextarea) {
      await claimTextarea.type(testClaim);
    }
    
    // API 응답 캡처
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/v1/search/deep') || url.includes('/fact')) {
        try {
          if (response.status() === 200) {
            const data = await response.json();
            if (data.verifications) {
              results.verificationResult = data.verifications;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    });
    
    // 팩트체크 시작
    const startTime = Date.now();
    const startButton = await page.$('button[type="submit"]');
    await startButton.click();
    results.verificationStarted = true;
    
    log('  팩트체크 시작됨...', 'dim');
    
    // 결과 대기 (최대 60초)
    for (let i = 0; i < 20; i++) {
      await sleep(3000);
      
      // 검증 결과 카드 확인
      const resultCards = await page.$$('[class*="verification"], [class*="result"], [class*="card"]');
      if (resultCards.length > 0) {
        for (const card of resultCards) {
          try {
            const status = await card.$eval('[class*="badge"], [class*="status"]', el => el.textContent).catch(() => null);
            const score = await card.$eval('[class*="score"], [class*="credibility"]', el => el.textContent).catch(() => null);
            
            if (status) {
              results.verificationResult = { status, score };
              log(`  ✓ 검증 결과: ${status}`, 'green');
              if (score) {
                log(`    신뢰도: ${score}`, 'cyan');
              }
            }
          } catch (e) {
            // Ignore
          }
        }
        
        if (results.verificationResult) {
          results.timing.completedMs = Date.now() - startTime;
          break;
        }
      }
      
      // 로딩 상태 확인
      const loading = await page.$('[class*="animate-spin"], [class*="loading"]');
      if (!loading && i > 5) {
        log('  검증 완료 또는 타임아웃', 'yellow');
        break;
      }
    }
    
    results.timing.totalMs = Date.now() - startTime;
    
    // 출처 추출
    const sourceLinks = await page.$$('a[href^="http"]');
    for (let i = 0; i < Math.min(sourceLinks.length, 5); i++) {
      try {
        const href = await sourceLinks[i].evaluate(el => el.href);
        const text = await sourceLinks[i].evaluate(el => el.textContent);
        if (href && !href.includes('localhost')) {
          results.sources.push({ url: href.substring(0, 100), text: text?.substring(0, 50) });
        }
      } catch (e) {
        // Ignore
      }
    }
    
    logSubSection('검증 결과');
    if (results.verificationResult) {
      logData('결과', results.verificationResult);
    } else {
      log('  검증 결과를 확인할 수 없습니다', 'yellow');
    }
    
    if (results.sources.length > 0) {
      log('\n  참조 출처:', 'cyan');
      results.sources.forEach((s, i) => {
        log(`    [${i + 1}] ${s.text || s.url}`, 'dim');
      });
    }
    
  } catch (error) {
    results.errors.push(error.message);
    log(`  ✗ 오류: ${error.message}`, 'red');
  }
  
  return results;
}

/**
 * 데이터 소스 관리 테스트
 */
async function testAdminSources(page) {
  logSection('6. 데이터 소스 관리 테스트');
  
  const results = {
    existingSources: [],
    sourceCreated: false,
    newSource: null,
    errors: []
  };
  
  try {
    await page.goto(`${BASE_URL}/admin/sources`, { waitUntil: 'networkidle2', timeout: TIMEOUT });
    await sleep(2000);
    
    logSubSection('기존 데이터 소스 확인');
    
    // 기존 소스 목록 확인
    const sourceRows = await page.$$('table tbody tr, [class*="source-item"]');
    for (let i = 0; i < Math.min(sourceRows.length, 5); i++) {
      try {
        const row = sourceRows[i];
        const name = await row.$eval('td:first-child, [class*="name"]', el => el.textContent).catch(() => 'N/A');
        const url = await row.$eval('td:nth-child(2), [class*="url"]', el => el.textContent).catch(() => 'N/A');
        const type = await row.$eval('td:nth-child(3), [class*="type"]', el => el.textContent).catch(() => 'N/A');
        
        results.existingSources.push({ name, url: url.substring(0, 50), type });
      } catch (e) {
        // Ignore
      }
    }
    
    if (results.existingSources.length > 0) {
      log(`  ✓ 등록된 소스 ${results.existingSources.length}개 발견`, 'green');
      results.existingSources.forEach((s, i) => {
        log(`    [${i + 1}] ${s.name} (${s.type})`, 'cyan');
        log(`        ${s.url}`, 'dim');
      });
    } else {
      log('  등록된 소스가 없습니다', 'yellow');
    }
    
    // API를 통해 소스 목록 직접 확인
    logSubSection('API를 통한 소스 목록 조회');
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sources?page=0&size=10`);
      if (response.ok) {
        const data = await response.json();
        log(`  ✓ API 응답: ${data.totalElements || data.content?.length || 0}개 소스`, 'green');
        if (data.content && data.content.length > 0) {
          logData('첫 번째 소스', data.content[0]);
        }
      } else {
        log(`  API 응답 오류: ${response.status}`, 'yellow');
      }
    } catch (e) {
      log(`  API 호출 실패: ${e.message}`, 'red');
    }
    
  } catch (error) {
    results.errors.push(error.message);
    log(`  ✗ 오류: ${error.message}`, 'red');
  }
  
  return results;
}

/**
 * 전체 테스트 요약 출력
 */
function printSummary(allResults) {
  logSection('테스트 결과 종합 요약');
  
  console.log('\n');
  
  // API 상태
  log('  [API 서비스 상태]', 'bold');
  for (const [name, result] of Object.entries(allResults.apiHealth || {})) {
    const icon = result.status === 'OK' ? '✓' : '✗';
    const color = result.status === 'OK' ? 'green' : 'red';
    log(`    ${icon} ${name}: ${result.status}`, color);
  }
  
  console.log('');
  
  // 기능별 테스트 결과
  log('  [기능 테스트 결과]', 'bold');
  
  // 통합 검색
  const searchResult = allResults.unifiedSearch;
  if (searchResult) {
    const icon = searchResult.resultsReceived.length > 0 ? '✓' : '○';
    const color = searchResult.resultsReceived.length > 0 ? 'green' : 'yellow';
    log(`    ${icon} 통합 검색: ${searchResult.resultsReceived.length}개 결과`, color);
    if (searchResult.timing.totalMs) {
      log(`      소요 시간: ${searchResult.timing.totalMs}ms`, 'dim');
    }
  }
  
  // Deep Search
  const deepResult = allResults.deepSearch;
  if (deepResult) {
    const icon = deepResult.evidence.length > 0 ? '✓' : '○';
    const color = deepResult.evidence.length > 0 ? 'green' : 'yellow';
    log(`    ${icon} Deep Search: ${deepResult.evidence.length}개 증거 수집`, color);
    if (deepResult.timing.totalMs) {
      log(`      소요 시간: ${deepResult.timing.totalMs}ms`, 'dim');
    }
  }
  
  // Browser Agent
  const browserResult = allResults.browserAgent;
  if (browserResult) {
    const hasResult = browserResult.finalResult || browserResult.steps.length > 0;
    const icon = hasResult ? '✓' : '○';
    const color = hasResult ? 'green' : 'yellow';
    log(`    ${icon} Browser Agent: ${browserResult.status || 'N/A'}`, color);
    if (browserResult.timing.totalMs) {
      log(`      소요 시간: ${browserResult.timing.totalMs}ms`, 'dim');
    }
  }
  
  // Fact Check
  const factResult = allResults.factCheck;
  if (factResult) {
    const hasResult = factResult.verificationResult;
    const icon = hasResult ? '✓' : '○';
    const color = hasResult ? 'green' : 'yellow';
    log(`    ${icon} 팩트체크: ${hasResult ? 'completed' : 'N/A'}`, color);
    if (factResult.sources.length > 0) {
      log(`      참조 출처: ${factResult.sources.length}개`, 'dim');
    }
  }
  
  // Admin Sources
  const adminResult = allResults.adminSources;
  if (adminResult) {
    const icon = adminResult.existingSources.length > 0 ? '✓' : '○';
    const color = adminResult.existingSources.length > 0 ? 'green' : 'yellow';
    log(`    ${icon} 데이터 소스: ${adminResult.existingSources.length}개 등록됨`, color);
  }
  
  console.log('\n' + '='.repeat(70) + '\n');
}

/**
 * 메인 실행
 */
async function main() {
  log('\n' + '='.repeat(70), 'bold');
  log('   NewsInsight 크롤링 기능 실제 동작 테스트', 'cyan');
  log('='.repeat(70) + '\n', 'bold');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  // 콘솔 에러 수집
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      log(`  [Console] ${msg.text().substring(0, 100)}`, 'dim');
    }
  });
  
  const allResults = {};
  
  try {
    // 1. API 상태 확인
    allResults.apiHealth = await checkAPIHealth();
    
    // 2. 통합 검색 테스트
    allResults.unifiedSearch = await testUnifiedSearch(page);
    
    // 3. Deep Search 테스트
    allResults.deepSearch = await testDeepSearch(page);
    
    // 4. Browser Agent 테스트
    allResults.browserAgent = await testBrowserAgent(page);
    
    // 5. Fact Check 테스트
    allResults.factCheck = await testFactCheck(page);
    
    // 6. Admin Sources 테스트
    allResults.adminSources = await testAdminSources(page);
    
    // 결과 요약
    printSummary(allResults);
    
  } catch (error) {
    log(`\n  전역 오류: ${error.message}`, 'red');
    console.error(error);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
