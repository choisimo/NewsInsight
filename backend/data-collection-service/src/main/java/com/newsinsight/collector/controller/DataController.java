package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.CollectedDataDTO;
import com.newsinsight.collector.entity.CollectedData;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.CollectedDataService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/data")
@RequiredArgsConstructor
public class DataController {

    private final CollectedDataService collectedDataService;
    private final EntityMapper entityMapper;

    /**
     * GET /api/v1/data - 수집된 데이터 목록 조회 (소스/처리상태/검색 필터링 지원)
     */
    @GetMapping
    public ResponseEntity<Page<CollectedDataDTO>> listData(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) Long sourceId,
            @RequestParam(required = false) Boolean processed,
            @RequestParam(required = false) String query) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "collectedAt"));
        
        Page<CollectedData> data;
        
        // 검색어가 있는 경우
        if (query != null && !query.isBlank()) {
            data = collectedDataService.searchWithFilter(query, processed, pageable);
        } else if (sourceId != null && processed != null) {
            // 소스 + 처리상태 동시 필터링은 별도의 커스텀 쿼리 필요 (현재는 소스 기준 필터만 수행)
            data = collectedDataService.findBySourceId(sourceId, pageable);
        } else if (sourceId != null) {
            data = collectedDataService.findBySourceId(sourceId, pageable);
        } else if (Boolean.FALSE.equals(processed)) {
            data = collectedDataService.findUnprocessed(pageable);
        } else {
            data = collectedDataService.findAll(pageable);
        }
        
        Page<CollectedDataDTO> dataDTOs = data.map(entityMapper::toCollectedDataDTO);
        
        return ResponseEntity.ok(dataDTOs);
    }

    /**
     * GET /api/v1/data/unprocessed - 미처리 데이터 목록 조회
     */
    @GetMapping("/unprocessed")
    public ResponseEntity<Page<CollectedDataDTO>> listUnprocessedData(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "collectedAt"));
        Page<CollectedData> data = collectedDataService.findUnprocessed(pageable);
        Page<CollectedDataDTO> dataDTOs = data.map(entityMapper::toCollectedDataDTO);
        
        return ResponseEntity.ok(dataDTOs);
    }

    /**
     * GET /api/v1/data/{id} - 수집된 데이터 단건 조회 (ID)
     */
    @GetMapping("/{id}")
    public ResponseEntity<CollectedDataDTO> getData(@PathVariable Long id) {
        return collectedDataService.findById(id)
                .map(entityMapper::toCollectedDataDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/data/{id}/processed - 데이터 처리 완료 마킹
     */
    @PostMapping("/{id}/processed")
    public ResponseEntity<Void> markAsProcessed(@PathVariable Long id) {
        boolean marked = collectedDataService.markAsProcessed(id);
        return marked ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * GET /api/v1/data/stats - 데이터 통계 조회 (전체/미처리/처리완료)
     */
    @GetMapping("/stats")
    public ResponseEntity<DataStatsResponse> getDataStats() {
        long total = collectedDataService.countTotal();
        long unprocessed = collectedDataService.countUnprocessed();
        
        DataStatsResponse stats = new DataStatsResponse(total, unprocessed, total - unprocessed);
        return ResponseEntity.ok(stats);
    }

    /**
     * 간단한 통계 응답 구조체
     */
    public record DataStatsResponse(long total, long unprocessed, long processed) {}
}
