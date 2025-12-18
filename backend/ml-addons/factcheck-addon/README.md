# Fact-Check Analysis Add-on

NewsInsight ML Add-on 시스템의 **팩트체크 분석** 구현입니다.

## 기능

- **출처 신뢰도 분석**: 기사 출처의 신뢰도 평가
- **낚시성 제목 탐지**: 클릭베이트 패턴 감지
- **허위정보 위험도**: 잠재적 허위정보 패턴 탐지
- **주장 추출 및 검증**: 기사 내 주장 문장 분석
- **종합 신뢰도 점수**: A~F 등급 산정

## 빠른 시작

```bash
# 의존성 설치
pip install -r requirements.txt

# 서버 실행 (포트 8101)
python addon_server.py

# 또는 uvicorn으로 실행
uvicorn addon_server:app --host 0.0.0.0 --port 8101 --reload
```

## API 엔드포인트

### GET /health

헬스체크

```bash
curl http://localhost:8101/health
```

### POST /analyze

단일 기사 팩트체크

```bash
curl -X POST http://localhost:8101/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "test-001",
    "addon_id": "factcheck",
    "article": {
      "id": 1,
      "title": "충격! 정부가 숨기는 진실",
      "content": "관계자는 ~라고 밝혔다. 이는 최초의 사례다.",
      "source": "연합뉴스"
    }
  }'
```

### POST /batch

여러 기사 일괄 분석

```bash
curl -X POST http://localhost:8101/batch \
  -H "Content-Type: application/json" \
  -d '[
    {"request_id": "1", "addon_id": "factcheck", "article": {...}},
    {"request_id": "2", "addon_id": "factcheck", "article": {...}}
  ]'
```

## 응답 형식

```json
{
  "request_id": "test-001",
  "addon_id": "factcheck",
  "status": "success",
  "results": {
    "factcheck": {
      "overall_credibility": 65.5,
      "credibility_grade": "B",
      "verdict": "suspicious",
      "claims_analyzed": 3,
      "verified_claims": 1,
      "false_claims": 1,
      "unverified_claims": 1,
      "claims": [...],
      "risk_flags": ["낚시성 제목 의심"],
      "explanations": ["출처 신뢰도: 90%", "분석된 주장: 3개"]
    }
  },
  "meta": {
    "model_version": "factcheck-ko-heuristic-v1",
    "latency_ms": 15,
    "processed_at": "2024-01-01T12:00:00Z"
  }
}
```

## 신뢰도 등급

| 등급 | 점수 범위 | 의미                |
| ---- | --------- | ------------------- |
| A    | 80-100    | 매우 신뢰할 수 있음 |
| B    | 60-79     | 신뢰할 수 있음      |
| C    | 40-59     | 주의 필요           |
| D    | 20-39     | 신뢰하기 어려움     |
| F    | 0-19      | 신뢰할 수 없음      |

## 분석 기준

### 출처 신뢰도 (30%)

- 신뢰할 수 있는 언론사 목록 기반
- 연합뉴스, KBS, MBC, SBS 등 주요 언론사

### 낚시성 제목 (20%)

- "충격!", "경악!", "알고 보니" 등 패턴 탐지

### 허위정보 위험 (20%)

- "정부가 숨기는", "언론이 보도하지 않는" 등

### 주장 검증 비율 (30%)

- 기사 내 주장 문장 추출 및 검증 상태

## 향후 개선 계획

- [ ] SNU 팩트체크 DB 연동
- [ ] LLM 기반 사실 검증
- [ ] 검색 엔진 API 교차 검증
- [ ] 실시간 뉴스 비교 분석

## 환경 변수

```bash
# 외부 API 연동시 필요
OPENAI_API_KEY=sk-...
FACTCHECK_DB_URL=http://...
```

## Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY addon_server.py .
EXPOSE 8101
CMD ["uvicorn", "addon_server:app", "--host", "0.0.0.0", "--port", "8101"]
```
