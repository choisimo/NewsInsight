# 1. 베이스 이미지는 호환성이 높은 'node:20-slim'을 유지합니다.
FROM node:20-slim

# 2. 환경 변수를 설정합니다.
ENV NODE_ENV=production \
    OPENCODE_HOST=0.0.0.0 \
    OPENCODE_PORT=7012

# 3. (수정) 시스템 그룹과 함께, 홈 디렉토리를 가진 사용자를 생성합니다.
RUN groupadd --system appgroup && useradd --system --gid appgroup --create-home appuser

# 4. 작업 디렉토리를 설정합니다.
WORKDIR /app

# 5. package.json을 먼저 복사하고, 생성된 appuser의 소유로 지정합니다.
COPY --chown=appuser:appgroup package.json .

# 6. opencode-ai 패키지를 설치합니다.
RUN npm install opencode-ai --omit=dev && npm cache clean --force

# 6-1. 기본 모델 접근 제어 구성을 설정합니다.
RUN mkdir -p /home/appuser/.config/opencode \
    && cat <<'EOF' > /home/appuser/.config/opencode/config.json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "github-copilot/gpt-4.1",
  "small_model": "github-copilot/gpt-4.1",
  "agent": {
    "default": {
      "model": "github-copilot/gpt-4.1"
    },
    "build": {
      "model": "github-copilot/gpt-4.1"
    }
  },
  "provider": {
    "github-copilot": {
      "env": [
        "GITHUB_TOKEN",
        "GH_TOKEN"
      ],
      "models": {
        "gpt-4.1": { "id": "gpt-4.1" }
      }
    }
  },
  "disabled_providers": [
    "anthropic",
    "openai",
    "google",
    "meta",
    "perplexity",
    "mistral",
    "groq",
    "cohere",
    "deepseek",
    "bedrock",
    "ollama"
  ]
}
EOF
RUN chown -R appuser:appgroup /home/appuser/.config/opencode

# 7. 데이터 저장을 위한 볼륨을 설정합니다.
VOLUME ["/var/lib/opencode", "/var/log/opencode"]

# 8. 컨테이너 실행 사용자를 appuser로 지정합니다.
USER appuser

# 8-1. opencode CLI가 PATH에 포함되도록 설정합니다.
ENV PATH=/app/node_modules/.bin:$PATH

# 9. (중요) 컨테이너 내에서 HOME 환경 변수를 명시적으로 설정합니다.
ENV HOME=/home/appuser

# 10. 포트를 노출합니다.
EXPOSE 7012

# 11. 패키지 내부의 실제 JS 파일을 node로 직접 실행합니다.
CMD ["/app/node_modules/.bin/opencode", "serve", "--hostname", "0.0.0.0", "--port", "7012"]
