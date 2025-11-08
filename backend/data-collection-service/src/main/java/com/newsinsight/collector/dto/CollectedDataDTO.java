package com.newsinsight.collector.dto;

import java.time.LocalDateTime;
import java.util.Map;

public record CollectedDataDTO(
        Long id,
        Long sourceId,
        String title,
        String content,
        String url,
        LocalDateTime publishedDate,
        LocalDateTime collectedAt,
        String contentHash,
        Map<String, Object> metadata,
        Boolean processed
) {
    public CollectedDataDTO {
        /**
         * Map.copyOf()는 원본 맵의 '읽기 전용 복사본'을 만듭니다.
         * 이로써 이 record는 외부의 어떤 변경에도 영향을 받지 않는
         * 완전한 불변 객체로써 동작합니다.
         */
        metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
}
