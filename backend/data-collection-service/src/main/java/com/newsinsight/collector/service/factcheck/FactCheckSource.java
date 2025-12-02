package com.newsinsight.collector.service.factcheck;

import com.newsinsight.collector.service.FactVerificationService.SourceEvidence;
import reactor.core.publisher.Flux;

import java.util.List;

/**
 * 팩트체크를 위한 데이터 소스 인터페이스
 * 
 * 각 구현체는 특정 데이터 소스(Wikipedia, CrossRef, Google Fact Check 등)에서
 * 주제 또는 주장에 대한 근거를 수집합니다.
 */
public interface FactCheckSource {
    
    /**
     * 소스 식별자
     */
    String getSourceId();
    
    /**
     * 소스 표시 이름
     */
    String getSourceName();
    
    /**
     * 신뢰도 점수 (0.0 ~ 1.0)
     * 학술 자료 > 공식 통계 > 백과사전 > 뉴스 팩트체크 순
     */
    double getTrustScore();
    
    /**
     * 주어진 주제/키워드에 대한 근거 수집
     * 
     * @param topic 검색할 주제 또는 키워드
     * @param language 언어 코드 (ko, en 등)
     * @return 수집된 근거 목록
     */
    Flux<SourceEvidence> fetchEvidence(String topic, String language);
    
    /**
     * 특정 주장에 대한 팩트체크 결과 조회
     * 
     * @param claim 검증할 주장
     * @param language 언어 코드
     * @return 팩트체크 근거 목록
     */
    Flux<SourceEvidence> verifyClaimAgainstSource(String claim, String language);
    
    /**
     * 이 소스가 사용 가능한지 확인 (API 키 설정 등)
     */
    boolean isAvailable();
    
    /**
     * 소스 유형 (참고용)
     */
    default SourceType getSourceType() {
        return SourceType.REFERENCE;
    }
    
    enum SourceType {
        ENCYCLOPEDIA,     // 백과사전 (Wikipedia, Britannica)
        ACADEMIC,         // 학술 자료 (CrossRef, OpenAlex)
        FACT_CHECK,       // 팩트체크 사이트 (Google Fact Check, Snopes)
        OFFICIAL_STATS,   // 공식 통계 (KOSIS, World Bank)
        REFERENCE         // 기타 참고 자료
    }
}
