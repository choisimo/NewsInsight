# ML Add-on: 감정 분석 (Sentiment Analysis)

이 디렉토리는 NewsInsight의 ML Add-on 시스템에서 사용할 감정 분석 Add-on 예제입니다.

## 파일 구조

```
sentiment-addon/
├── addon_server.py      # FastAPI 기반 HTTP Add-on 서버
├── sentiment_model.py   # 실제 감정 분석 로직
├── requirements.txt     # Python 의존성
├── Dockerfile          # 프로덕션 배포용
└── colab_notebook.ipynb # Colab에서 테스트용
```

## 사용법

### 1. 로컬 개발

```bash
# 가상환경 생성
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# 서버 실행
uvicorn addon_server:app --host 0.0.0.0 --port 8100 --reload
```

### 2. Colab에서 실행

`colab_notebook.ipynb`를 Google Colab에서 열어서 실행하세요.
ngrok을 사용해 외부에서 접근 가능한 URL을 얻을 수 있습니다.

### 3. Docker 배포

```bash
docker build -t sentiment-addon .
docker run -p 8100:8100 sentiment-addon
```

## NewsInsight에 등록

Add-on 서버가 실행되면, NewsInsight Admin API를 통해 등록:

```bash
curl -X POST http://localhost:8080/api/v1/ml/addons \
  -H "Content-Type: application/json" \
  -d '{
    "addonKey": "sentiment-korean-v1",
    "name": "Korean Sentiment Analyzer",
    "description": "한국어 뉴스 기사 감정 분석",
    "category": "SENTIMENT",
    "invokeType": "HTTP_SYNC",
    "endpointUrl": "http://localhost:8100/analyze",
    "authType": "NONE",
    "timeoutMs": 30000,
    "enabled": true,
    "priority": 10
  }'
```

## API 스펙

### POST /analyze

**Request:**
```json
{
  "request_id": "uuid",
  "addon_id": "sentiment-korean-v1",
  "task": "article_analysis",
  "article": {
    "id": 123,
    "title": "기사 제목",
    "content": "기사 본문..."
  },
  "context": {
    "language": "ko"
  }
}
```

**Response:**
```json
{
  "request_id": "uuid",
  "addon_id": "sentiment-korean-v1",
  "status": "success",
  "results": {
    "sentiment": {
      "score": -0.35,
      "label": "negative",
      "distribution": {
        "positive": 0.2,
        "negative": 0.65,
        "neutral": 0.15
      },
      "explanations": ["부정적 키워드 다수 발견"]
    }
  },
  "meta": {
    "model_version": "sentiment-ko-2025-01",
    "latency_ms": 150
  }
}
```
