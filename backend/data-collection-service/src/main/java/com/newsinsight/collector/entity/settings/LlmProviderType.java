package com.newsinsight.collector.entity.settings;

/**
 * LLM Provider 종류
 */
public enum LlmProviderType {
    OPENAI("OpenAI", "https://api.openai.com/v1"),
    ANTHROPIC("Anthropic", "https://api.anthropic.com"),
    GOOGLE("Google AI", "https://generativelanguage.googleapis.com"),
    OPENROUTER("OpenRouter", "https://openrouter.ai/api/v1"),
    OLLAMA("Ollama", "http://localhost:11434"),
    AZURE_OPENAI("Azure OpenAI", null),
    CUSTOM("Custom", null);

    private final String displayName;
    private final String defaultBaseUrl;

    LlmProviderType(String displayName, String defaultBaseUrl) {
        this.displayName = displayName;
        this.defaultBaseUrl = defaultBaseUrl;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getDefaultBaseUrl() {
        return defaultBaseUrl;
    }
}
