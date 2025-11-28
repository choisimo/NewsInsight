package com.newsinsight.collector.entity.ai;

/**
 * AI provider/workflow types for task routing.
 * Each provider represents a different n8n workflow or external AI service.
 */
public enum AiProvider {
    /**
     * Universal agent for general-purpose AI tasks.
     * n8n workflow: /webhook/universal-agent
     */
    UNIVERSAL_AGENT("universal-agent", "General-purpose AI agent"),

    /**
     * Deep reader for in-depth content analysis.
     * n8n workflow: /webhook/deep-reader (crawl-agent)
     */
    DEEP_READER("deep-reader", "Deep content analysis and evidence extraction"),

    /**
     * Scout agent for quick reconnaissance and URL discovery.
     * n8n workflow: /webhook/scout-agent
     */
    SCOUT("scout-agent", "Quick reconnaissance and URL discovery"),

    /**
     * Local quick processing for simple tasks without external calls.
     * Processed internally without n8n.
     */
    LOCAL_QUICK("local-quick", "Local quick processing");

    private final String workflowPath;
    private final String description;

    AiProvider(String workflowPath, String description) {
        this.workflowPath = workflowPath;
        this.description = description;
    }

    public String getWorkflowPath() {
        return workflowPath;
    }

    public String getDescription() {
        return description;
    }

    /**
     * Check if this provider requires external n8n workflow
     */
    public boolean isExternal() {
        return this != LOCAL_QUICK;
    }
}
