# Bias Analysis Add-on

NewsInsight ML Add-on 시스템의 **편향도 분석** 구현입니다.

## 기능

- **언론사 성향 분석**: 출처 언론사의 알려진 정치 성향 반영
- **키워드 기반 편향 탐지**: 진보/보수 성향 키워드 분석
- **프레이밍 분석**: 기사의 관점/프레이밍 방식 분석
- **톤 분석**: 객관성 및 감정적 표현 수준 평가
- **종합 편향 점수**: -1(진보) ~ 1(보수) 스펙트럼

## 빠른 시작

```bash
# 의존성 설치
pip install -r requirements.txt

# 서버 실행 (포트 8102)
python addon_server.py

# 또는 uvicorn으로 실행
uvicorn addon_server:app --host 0.0.0.0 --port 8102 --reload
```

## API 엔드포인트

### GET /health
헬스체크

```bash
curl http://localhost:8102/health
```

### POST /analyze
단일 기사 편향도 분석

```bash
curl -X POST http://localhost:8102/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "test-001",
    "addon_id": "bias",
    "article": {
      "id": 1,
      "title": "재벌 특혜 논란 심화...시민단체 반발",
      "content": "노동자 권리를 위한 시민단체들이...",
      "source": "한겨레"
    }
  }'
```

## 응답 형식

```json
{
  "request_id": "test-001",
  "addon_id": "bias",
  "status": "success",
  "results": {
    "bias": {
      "overall_bias_score": -0.45,
      "bias_label": "left",
      "confidence": 0.75,
      "political_lean": "progressive",
      "indicators": [
        {"phrase": "노동자 권리", "bias_type": "political", "direction": "left", "weight": 0.5}
      ],
      "tone_analysis": {
        "objectivity_score": 0.7,
        "emotional_language": 0.3,
        "loaded_words_count": 2
      },
      "source_bias": {
        "source_name": "한겨레",
        "known_lean": "left"
      },
      "framing_notes": ["[진보] 불평등 강조"],
      "explanations": ["언론사 성향: 한겨레 (left)", "종합 편향 점수: -0.45"]
    }
  },
  "meta": {
    "model_version": "bias-ko-heuristic-v1",
    "latency_ms": 12,
    "processed_at": "2024-01-01T12:00:00Z"
  }
}
```

## 편향 레이블

| 점수 범위 | 레이블 | 정치 성향 |
|-----------|--------|----------|
| -1.0 ~ -0.6 | far_left | progressive |
| -0.6 ~ -0.3 | left | progressive |
| -0.3 ~ -0.1 | center_left | moderate |
| -0.1 ~ 0.1 | center | moderate |
| 0.1 ~ 0.3 | center_right | moderate |
| 0.3 ~ 0.6 | right | conservative |
| 0.6 ~ 1.0 | far_right | conservative |

## 분석 기준

### 언론사 성향 (30%)
- 언론사별 알려진 정치 성향 반영
- 연합뉴스, KBS 등 = 중도
- 조선일보, 한국경제 등 = 보수
- 한겨레, 경향신문 등 = 진보

### 키워드 분석 (40%)
- 진보: 복지, 노동자 권리, 평등, 인권 등
- 보수: 안보, 자유시장, 전통, 법질서 등

### 프레이밍 분석 (30%)
- 동일 사안을 어떤 관점에서 다루는지 분석
- "재벌 특혜" vs "기업 투자" 등

## 주의사항

- 이 분석은 휴리스틱 기반이며 참고용입니다
- 단일 기사의 편향을 판단하기보다 패턴 분석에 유용합니다
- 정치적 중립성을 위해 양쪽 성향을 균형있게 분석합니다

## Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY addon_server.py .
EXPOSE 8102
CMD ["uvicorn", "addon_server:app", "--host", "0.0.0.0", "--port", "8102"]
```
