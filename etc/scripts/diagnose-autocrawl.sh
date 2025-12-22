#!/bin/bash
# ============================================================================
# Auto Crawl 시스템 진단 스크립트
# 사용법: ./etc/scripts/diagnose-autocrawl.sh
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/etc/docker/docker-compose.consul.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}                    Auto Crawl 시스템 진단 시작                              ${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# ============================================================================
# Step 1: 서비스 상태 확인
# ============================================================================
echo -e "${YELLOW}[Step 1/6] 서비스 상태 확인${NC}"
echo "----------------------------------------------------------------------------"

docker-compose -f "$COMPOSE_FILE" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | head -20

COLLECTOR_STATUS=$(docker-compose -f "$COMPOSE_FILE" ps collector-service --format "{{.Status}}" 2>/dev/null || echo "NOT_FOUND")
CRAWLER_STATUS=$(docker-compose -f "$COMPOSE_FILE" ps autonomous-crawler --format "{{.Status}}" 2>/dev/null || echo "NOT_FOUND")
KAFKA_STATUS=$(docker-compose -f "$COMPOSE_FILE" ps redpanda-dev --format "{{.Status}}" 2>/dev/null || echo "NOT_FOUND")

echo ""
if [[ "$COLLECTOR_STATUS" == *"Up"* ]]; then
    echo -e "  collector-service: ${GREEN}UP${NC}"
else
    echo -e "  collector-service: ${RED}DOWN - $COLLECTOR_STATUS${NC}"
fi

if [[ "$CRAWLER_STATUS" == *"Up"* ]]; then
    echo -e "  autonomous-crawler: ${GREEN}UP${NC}"
else
    echo -e "  autonomous-crawler: ${RED}DOWN - $CRAWLER_STATUS${NC}"
fi

if [[ "$KAFKA_STATUS" == *"Up"* ]]; then
    echo -e "  redpanda-dev (Kafka): ${GREEN}UP${NC}"
else
    echo -e "  redpanda-dev (Kafka): ${RED}DOWN - $KAFKA_STATUS${NC}"
fi
echo ""

# ============================================================================
# Step 2: AutoCrawl 스케줄러 로그 확인
# ============================================================================
echo -e "${YELLOW}[Step 2/6] AutoCrawl 스케줄러 로그 확인${NC}"
echo "----------------------------------------------------------------------------"

AUTOCRAWL_LOGS=$(docker logs collector-service 2>&1 | grep -E "\[AutoCrawl\]|\[AutoCrawl Init\]" | tail -10 || true)

if [ -z "$AUTOCRAWL_LOGS" ]; then
    echo -e "${RED}[경고] AutoCrawl 관련 로그가 없습니다!${NC}"
    echo "       가능한 원인:"
    echo "       - AUTOCRAWL_ENABLED=false 설정됨"
    echo "       - 서비스가 방금 시작됨 (30초 대기 필요)"
    echo ""
    echo "       확인 명령어:"
    echo "       docker exec collector-service env | grep AUTOCRAWL"
else
    echo "$AUTOCRAWL_LOGS"
fi
echo ""

# ============================================================================
# Step 3: DB CrawlTarget 상태 확인
# ============================================================================
echo -e "${YELLOW}[Step 3/6] DB CrawlTarget 상태 확인${NC}"
echo "----------------------------------------------------------------------------"

POSTGRES_CONTAINER=$(docker ps -qf name=postgres 2>/dev/null | head -1)

if [ -n "$POSTGRES_CONTAINER" ]; then
    echo "crawl_targets 테이블 상태별 개수:"
    docker exec -i "$POSTGRES_CONTAINER" psql -U postgres -d newsinsight -c \
        "SELECT status, COUNT(*) as count FROM crawl_targets GROUP BY status ORDER BY count DESC;" 2>/dev/null || \
        echo -e "${RED}테이블이 존재하지 않거나 쿼리 실패${NC}"
    
    echo ""
    echo "최근 추가된 대상 (상위 5개):"
    docker exec -i "$POSTGRES_CONTAINER" psql -U postgres -d newsinsight -c \
        "SELECT id, status, domain, created_at FROM crawl_targets ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || true
else
    echo -e "${RED}PostgreSQL 컨테이너를 찾을 수 없습니다${NC}"
fi
echo ""

# ============================================================================
# Step 4: Kafka 메시지 확인 (핵심 진단 포인트)
# ============================================================================
echo -e "${YELLOW}[Step 4/6] Kafka 메시지 확인 ⭐ (핵심 진단)${NC}"
echo "----------------------------------------------------------------------------"

KAFKA_CONTAINER=$(docker ps -qf name=redpanda-dev 2>/dev/null | head -1)

if [ -n "$KAFKA_CONTAINER" ]; then
    echo "토픽 목록:"
    docker exec "$KAFKA_CONTAINER" rpk topic list 2>/dev/null || echo -e "${RED}Kafka 브로커 연결 실패${NC}"
    
    echo ""
    echo "browser.tasks 토픽 상태:"
    docker exec "$KAFKA_CONTAINER" rpk topic describe newsinsight.crawl.browser.tasks 2>/dev/null || \
        echo -e "${YELLOW}토픽이 아직 생성되지 않았습니다 (첫 메시지 발행 시 자동 생성)${NC}"
    
    echo ""
    echo "Consumer Group 상태 (autonomous-crawler-group):"
    docker exec "$KAFKA_CONTAINER" rpk group describe autonomous-crawler-group 2>/dev/null || \
        echo -e "${YELLOW}Consumer Group이 아직 등록되지 않았습니다${NC}"
    
    echo ""
    echo "최근 메시지 확인 (최대 2개, 1초 타임아웃):"
    timeout 5 docker exec "$KAFKA_CONTAINER" rpk topic consume newsinsight.crawl.browser.tasks \
        --num 2 --offset end 2>/dev/null || \
        echo -e "${YELLOW}메시지 없음 또는 토픽 없음${NC}"
else
    echo -e "${RED}Redpanda(Kafka) 컨테이너를 찾을 수 없습니다${NC}"
fi
echo ""

# ============================================================================
# Step 5: autonomous-crawler 로그 확인
# ============================================================================
echo -e "${YELLOW}[Step 5/6] autonomous-crawler 로그 확인${NC}"
echo "----------------------------------------------------------------------------"

echo "Kafka Consumer 상태:"
docker logs autonomous-crawler 2>&1 | grep -iE "kafka|consumer|started|connected" | tail -5 || \
    echo -e "${YELLOW}Kafka 관련 로그 없음${NC}"

echo ""
echo "최근 Task 처리 로그:"
docker logs autonomous-crawler 2>&1 | grep -iE "received browser task|task completed|processing|dispatched" | tail -5 || \
    echo -e "${YELLOW}Task 처리 로그 없음${NC}"

echo ""
echo "에러 로그:"
docker logs autonomous-crawler 2>&1 | grep -iE "error|exception|failed|traceback" | tail -10 || \
    echo -e "${GREEN}에러 없음${NC}"
echo ""

# ============================================================================
# Step 6: 환경변수 확인
# ============================================================================
echo -e "${YELLOW}[Step 6/6] 주요 환경변수 확인${NC}"
echo "----------------------------------------------------------------------------"

echo "collector-service 환경변수:"
docker exec collector-service env 2>/dev/null | grep -E "^AUTOCRAWL_|^KAFKA_" | sort || \
    echo -e "${RED}컨테이너 접근 불가${NC}"

echo ""
echo "autonomous-crawler 환경변수:"
docker exec autonomous-crawler env 2>/dev/null | grep -E "^KAFKA_|^LLM_|^SERVICE_MODE" | sort || \
    echo -e "${RED}컨테이너 접근 불가${NC}"
echo ""

# ============================================================================
# 진단 요약
# ============================================================================
echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}                           진단 요약                                        ${NC}"
echo -e "${BLUE}============================================================================${NC}"

echo ""
echo "다음 사항을 확인하세요:"
echo ""
echo "1. [Step 2] AutoCrawl 로그가 보이지 않으면:"
echo "   → AUTOCRAWL_ENABLED=true 환경변수 확인"
echo ""
echo "2. [Step 3] crawl_targets 테이블이 비어있으면:"
echo "   → AUTOCRAWL_SEED_ENABLED=true 설정 후 서비스 재시작"
echo ""
echo "3. [Step 4] Kafka 토픽에 메시지가 쌓여만 있으면:"
echo "   → Python Consumer(autonomous-crawler) 문제"
echo "   → LLM API 키 설정 확인 (LLM_OPENAI_API_KEY 등)"
echo ""
echo "4. [Step 5] 에러 로그에 WebDriver/Playwright 오류가 있으면:"
echo "   → 브라우저 환경 문제 (Docker shm_size, 의존성)"
echo ""

echo -e "${BLUE}============================================================================${NC}"
echo -e "${GREEN}진단 완료${NC}"
echo -e "${BLUE}============================================================================${NC}"
