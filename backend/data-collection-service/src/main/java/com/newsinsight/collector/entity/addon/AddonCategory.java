package com.newsinsight.collector.entity.addon;

/**
 * Add-on 카테고리 분류.
 * 각 카테고리는 분석 기능의 유형을 나타냄.
 */
public enum AddonCategory {
    
    /**
     * 감정 분석 (긍정/부정/중립)
     */
    SENTIMENT,
    
    /**
     * 문맥/의도 분석 (주제 분류, 스탠스 분석)
     */
    CONTEXT,
    
    /**
     * 팩트체크 (주장 검증, 교차 출처 비교)
     */
    FACTCHECK,
    
    /**
     * 커뮤니티/여론 분석 (댓글, SNS)
     */
    COMMUNITY,
    
    /**
     * 출처 신뢰도/편향도 분석
     */
    SOURCE_QUALITY,
    
    /**
     * 개체명 인식 (NER)
     */
    ENTITY_EXTRACTION,
    
    /**
     * 요약 생성
     */
    SUMMARIZATION,
    
    /**
     * 주제 분류
     */
    TOPIC_CLASSIFICATION,
    
    /**
     * 독성/혐오 탐지
     */
    TOXICITY,
    
    /**
     * 허위정보 탐지
     */
    MISINFORMATION,
    
    /**
     * 기타/커스텀
     */
    CUSTOM
}
