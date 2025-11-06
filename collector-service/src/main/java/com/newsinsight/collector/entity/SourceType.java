package com.newsinsight.collector.entity;

public enum SourceType {
    RSS("rss"),
    WEB("web"),
    API("api"),
    WEBHOOK("webhook");

    private final String value;

    SourceType(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static SourceType fromValue(String value) {
        for (SourceType type : SourceType.values()) {
            if (type.value.equalsIgnoreCase(value)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unknown source type: " + value);
    }
}
