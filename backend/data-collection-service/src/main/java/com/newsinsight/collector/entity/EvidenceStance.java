package com.newsinsight.collector.entity;

/**
 * Stance classification for evidence items.
 * Represents the position of the evidence relative to the search topic.
 */
public enum EvidenceStance {
    /**
     * Evidence supports or is favorable to the topic
     */
    PRO,

    /**
     * Evidence opposes or is unfavorable to the topic
     */
    CON,

    /**
     * Evidence is neutral or balanced
     */
    NEUTRAL
}
