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
     * GET /api/v1/data - List collected data
     */
    @GetMapping
    public ResponseEntity<Page<CollectedDataDTO>> listData(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) Long sourceId,
            @RequestParam(required = false) Boolean processed) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "collectedAt"));
        
        Page<CollectedData> data;
        if (sourceId != null && processed != null) {
            // Filter by both source and processed status - would need custom query
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
     * GET /api/v1/data/unprocessed - List unprocessed data
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
     * GET /api/v1/data/{id} - Get collected data by ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<CollectedDataDTO> getData(@PathVariable Long id) {
        return collectedDataService.findById(id)
                .map(entityMapper::toCollectedDataDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/data/{id}/processed - Mark data as processed
     */
    @PostMapping("/{id}/processed")
    public ResponseEntity<Void> markAsProcessed(@PathVariable Long id) {
        boolean marked = collectedDataService.markAsProcessed(id);
        return marked ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * GET /api/v1/data/stats - Get data statistics
     */
    @GetMapping("/stats")
    public ResponseEntity<DataStatsResponse> getDataStats() {
        long total = collectedDataService.countTotal();
        long unprocessed = collectedDataService.countUnprocessed();
        
        DataStatsResponse stats = new DataStatsResponse(total, unprocessed, total - unprocessed);
        return ResponseEntity.ok(stats);
    }

    /**
     * Simple stats response class
     */
    public record DataStatsResponse(long total, long unprocessed, long processed) {}
}
