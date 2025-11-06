"""
Content Quality Validation Service

수집된 컨텐츠의 품질을 검증하고 점수를 산출합니다.
- 컨텐츠 길이 검증
- 한국어 비율 검증
- 광고/스팸 필터링
- 관련성 점수 계산
- 중복 감지 (해시 기반)
"""

import re
import hashlib
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class QualityScore:
    """품질 점수 데이터 클래스"""
    overall_score: float  # 전체 품질 점수 (0-100)
    length_score: float  # 길이 점수
    korean_ratio_score: float  # 한국어 비율 점수
    spam_score: float  # 스팸 점수 (낮을수록 좋음)
    relevance_score: float  # 관련성 점수
    is_valid: bool  # 최소 기준 통과 여부
    reasons: List[str]  # 감점/가점 사유


class ValidationService:
    """컨텐츠 품질 검증 서비스"""
    
    # 한국어 유니코드 범위
    KOREAN_PATTERN = re.compile(r'[가-힣]+')
    
    # 스팸 키워드 (광고, 홍보성)
    SPAM_KEYWORDS = [
        '할인', '이벤트', '무료', '증정', '쿠폰', '혜택',
        '바로가기', '클릭', '지금', '신청', '가입',
        '추천', '인기', '베스트', '특가', '세일'
    ]
    
    # 연금 관련 키워드 (관련성 판단)
    PENSION_KEYWORDS = [
        '국민연금', '연금', '노후', '은퇴', '퇴직',
        '연금공단', '보험료', '급여', '수급', '가입',
        '보장', '복지', '사회보험', '기금', '적립'
    ]
    
    # 품질 기준 임계값
    MIN_LENGTH = 50  # 최소 글자 수
    MAX_LENGTH = 50000  # 최대 글자 수
    MIN_KOREAN_RATIO = 0.3  # 최소 한국어 비율 (30%)
    MAX_SPAM_SCORE = 30  # 최대 스팸 점수
    MIN_RELEVANCE_SCORE = 20  # 최소 관련성 점수
    MIN_OVERALL_SCORE = 50  # 최소 전체 점수
    
    def __init__(self):
        """
        검증 서비스 초기화.

        중복 검출을 위한 해시 캐시를 준비합니다.
        """
        self.duplicate_cache: Dict[str, datetime] = {}
    
    def validate_content_quality(
        self, 
        content: Dict[str, Any]
    ) -> QualityScore:
        """
        컨텐츠 품질을 종합적으로 검증하고 점수를 산출합니다.

        Args:
            content: 검증할 컨텐츠 (title, text/content, url 등 포함)

        Returns:
            QualityScore: 세부 항목 점수와 전체 점수, 사유 포함
        """
        title = content.get('title', '')
        text = content.get('text', '') or content.get('content', '')
        full_text = f"{title} {text}"
        
        reasons = []
        
        # 1. 길이 검증
        length_score, length_reasons = self._validate_length(full_text)
        reasons.extend(length_reasons)
        
        # 2. 한국어 비율 검증
        korean_ratio_score, korean_reasons = self._validate_korean_ratio(full_text)
        reasons.extend(korean_reasons)
        
        # 3. 스팸 검증
        spam_score, spam_reasons = self._check_spam(full_text)
        reasons.extend(spam_reasons)
        
        # 4. 관련성 검증
        relevance_score, relevance_reasons = self._check_relevance(full_text)
        reasons.extend(relevance_reasons)
        
        # 전체 점수 계산 (가중 평균)
        overall_score = (
            length_score * 0.2 +
            korean_ratio_score * 0.2 +
            (100 - spam_score) * 0.3 +  # 스팸은 낮을수록 좋음
            relevance_score * 0.3
        )
        
        # 최소 기준 검증
        is_valid = (
            length_score >= 50 and
            korean_ratio_score >= 50 and
            spam_score <= self.MAX_SPAM_SCORE and
            relevance_score >= self.MIN_RELEVANCE_SCORE and
            overall_score >= self.MIN_OVERALL_SCORE
        )
        
        return QualityScore(
            overall_score=round(overall_score, 2),
            length_score=round(length_score, 2),
            korean_ratio_score=round(korean_ratio_score, 2),
            spam_score=round(spam_score, 2),
            relevance_score=round(relevance_score, 2),
            is_valid=is_valid,
            reasons=reasons
        )
    
    def _validate_length(self, text: str) -> Tuple[float, List[str]]:
        """
        텍스트 길이에 대한 품질 점수를 계산합니다.

        Returns:
            (점수, 사유 목록)
        """
        length = len(text.strip())
        reasons = []
        
        if length < self.MIN_LENGTH:
            reasons.append(f"텍스트가 너무 짧습니다 ({length}자 < {self.MIN_LENGTH}자)")
            return 0.0, reasons
        
        if length > self.MAX_LENGTH:
            reasons.append(f"텍스트가 너무 깁니다 ({length}자 > {self.MAX_LENGTH}자)")
            return 30.0, reasons
        
        # 최적 길이: 100-5000자 사이
        if 100 <= length <= 5000:
            score = 100.0
            reasons.append(f"적절한 길이입니다 ({length}자)")
        elif length < 100:
            score = 50 + (length - self.MIN_LENGTH) / (100 - self.MIN_LENGTH) * 50
            reasons.append(f"짧지만 허용 가능한 길이입니다 ({length}자)")
        else:  # > 5000
            score = 70.0
            reasons.append(f"긴 컨텐츠입니다 ({length}자)")
        
        return score, reasons
    
    def _validate_korean_ratio(self, text: str) -> Tuple[float, List[str]]:
        """
        한국어 비중을 측정하여 점수를 계산합니다.

        Returns:
            (점수, 사유 목록)
        """
        if not text:
            return 0.0, ["텍스트가 비어있습니다"]
        
        # 한국어 글자 수
        korean_chars = len(''.join(self.KOREAN_PATTERN.findall(text)))
        total_chars = len(text.replace(' ', ''))
        
        if total_chars == 0:
            return 0.0, ["유효한 문자가 없습니다"]
        
        ratio = korean_chars / total_chars
        reasons = []
        
        if ratio < self.MIN_KOREAN_RATIO:
            reasons.append(f"한국어 비율이 낮습니다 ({ratio:.1%} < {self.MIN_KOREAN_RATIO:.0%})")
            score = ratio / self.MIN_KOREAN_RATIO * 50  # 최대 50점
        elif ratio >= 0.7:
            score = 100.0
            reasons.append(f"충분한 한국어 비율입니다 ({ratio:.1%})")
        else:
            score = 50 + (ratio - self.MIN_KOREAN_RATIO) / (0.7 - self.MIN_KOREAN_RATIO) * 50
            reasons.append(f"적절한 한국어 비율입니다 ({ratio:.1%})")
        
        return score, reasons
    
    def _check_spam(self, text: str) -> Tuple[float, List[str]]:
        """
        스팸/광고 패턴을 탐지하여 스팸 점수를 산출합니다.

        Returns:
            (스팸 점수 0-100, 사유 목록) - 높을수록 스팸 가능성 높음
        """
        text_lower = text.lower()
        reasons = []
        spam_count = 0
        
        # 스팸 키워드 카운트
        for keyword in self.SPAM_KEYWORDS:
            count = text_lower.count(keyword)
            if count > 0:
                spam_count += count
                if count >= 3:
                    reasons.append(f"스팸 키워드 '{keyword}' 다수 출현 ({count}회)")
        
        # URL 과다 포함 체크
        url_pattern = re.compile(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+')
        urls = url_pattern.findall(text)
        if len(urls) > 5:
            spam_count += len(urls) - 5
            reasons.append(f"과도한 URL 포함 ({len(urls)}개)")
        
        # 반복 문자열 체크 (예: !!!!, ~~~~)
        repeat_pattern = re.compile(r'(.)\1{4,}')
        if repeat_pattern.search(text):
            spam_count += 5
            reasons.append("반복 문자 패턴 발견")
        
        # 스팸 점수 계산 (최대 100)
        spam_score = min(spam_count * 5, 100)
        
        if spam_score == 0:
            reasons.append("스팸 징후 없음")
        elif spam_score < 30:
            reasons.append(f"낮은 스팸 점수 ({spam_score})")
        
        return spam_score, reasons
    
    def _check_relevance(self, text: str) -> Tuple[float, List[str]]:
        """
        연금 관련 키워드 기반의 관련성 점수를 계산합니다.

        Returns:
            (관련성 점수 0-100, 사유 목록)
        """
        text_lower = text.lower()
        reasons = []
        relevance_count = 0
        found_keywords = []
        
        # 연금 키워드 검색
        for keyword in self.PENSION_KEYWORDS:
            count = text_lower.count(keyword)
            if count > 0:
                relevance_count += count
                found_keywords.append(f"{keyword}({count})")
        
        if relevance_count == 0:
            reasons.append("연금 관련 키워드 없음")
            return 0.0, reasons
        
        # 점수 계산 (로그 스케일)
        if relevance_count >= 10:
            score = 100.0
        elif relevance_count >= 5:
            score = 70 + (relevance_count - 5) / 5 * 30
        elif relevance_count >= 2:
            score = 40 + (relevance_count - 2) / 3 * 30
        else:
            score = relevance_count * 40
        
        reasons.append(f"연금 키워드 {len(found_keywords)}개 발견: {', '.join(found_keywords[:5])}")
        
        return min(score, 100.0), reasons
    
    def detect_duplicate(
        self, 
        content: Dict[str, Any],
        threshold: float = 0.95
    ) -> Tuple[bool, Optional[str]]:
        """
        URL/제목/내용 해시를 이용하여 중복 컨텐츠를 감지합니다.

        Args:
            content: 검증할 컨텐츠
            threshold: 유사도 임계값 (현 구현은 정확 일치만 사용)

        Returns:
            (중복 여부, 중복된 해시)
        """
        # URL + 제목 + 내용으로 해시 생성
        url = content.get('url', '')
        title = content.get('title', '')
        text = content.get('text', '') or content.get('content', '')
        
        # 해시 생성
        content_hash = hashlib.sha256(
            f"{url}{title}{text}".encode('utf-8')
        ).hexdigest()
        
        # 중복 체크
        if content_hash in self.duplicate_cache:
            logger.info(f"중복 컨텐츠 발견: {content_hash[:8]}... (URL: {url})")
            return True, content_hash
        
        # 캐시에 추가
        self.duplicate_cache[content_hash] = datetime.now()
        
        # 캐시 정리 (1000개 초과시)
        if len(self.duplicate_cache) > 1000:
            # 오래된 항목 제거 (단순 구현: 처음 100개 제거)
            keys_to_remove = list(self.duplicate_cache.keys())[:100]
            for key in keys_to_remove:
                del self.duplicate_cache[key]
        
        return False, None
    
    def batch_validate(
        self,
        contents: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        다수의 컨텐츠를 한 번에 검증하고 통계를 반환합니다.

        Args:
            contents: 검증할 컨텐츠 목록

        Returns:
            총계/유효/무효/중복 수와 결과 리스트를 포함한 통계 사전
        """
        results = []
        duplicates = 0
        valid_count = 0
        
        for content in contents:
            # 중복 체크
            is_duplicate, _ = self.detect_duplicate(content)
            if is_duplicate:
                duplicates += 1
                continue
            
            # 품질 검증
            quality = self.validate_content_quality(content)
            results.append({
                'content': content,
                'quality': quality
            })
            
            if quality.is_valid:
                valid_count += 1
        
        return {
            'total': len(contents),
            'duplicates': duplicates,
            'validated': len(results),
            'valid': valid_count,
            'invalid': len(results) - valid_count,
            'valid_rate': round(valid_count / len(results) * 100, 2) if results else 0,
            'results': results
        }
