package com.newsinsight.collector.entity.settings;

/**
 * LLM Provider 종류
 */
public enum LlmProviderType {
    OPENAI("OpenAI", "https://api.openai.com/v1"),
    ANTHROPIC("Anthropic", "https://api.anthropic.com"),
    GOOGLE("Google AI", "https://generativelanguage.googleapis.com/v1beta"),
    OPENROUTER("OpenRouter", "https://openrouter.ai/api/v1"),
    OLLAMA("Ollama", "http://localhost:11434"),
    AZURE_OPENAI("Azure OpenAI", null),
    TOGETHER_AI("Together AI", "https://api.together.xyz/v1"),
    // Search API Providers (실시간 검색용)
    PERPLEXITY("Perplexity", "https://api.perplexity.ai"),
    BRAVE_SEARCH("Brave Search", "https://api.search.brave.com/res/v1"),
    TAVILY("Tavily", "https://api.tavily.com"),
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
