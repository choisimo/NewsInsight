package com.newsinsight.collector.controller;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.service.DataSourceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/sources")
@RequiredArgsConstructor
public class SourceController {

    private final DataSourceService dataSourceService;
    private final EntityMapper entityMapper;

    /**
     * GET /api/v1/sources - 모든 데이터 소스 목록 조회 (페이징/정렬 지원)
     */
    @GetMapping
    public ResponseEntity<Page<DataSourceDTO>> listSources(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "id") String sortBy,
            @RequestParam(defaultValue = "DESC") String sortDirection) {
        
        Sort.Direction direction = Sort.Direction.fromString(sortDirection);
        Pageable pageable = PageRequest.of(page, size, Sort.by(direction, sortBy));
        
        Page<DataSource> sources = dataSourceService.findAll(pageable);
        Page<DataSourceDTO> sourceDTOs = sources.map(entityMapper::toDataSourceDTO);
        
        return ResponseEntity.ok(sourceDTOs);
    }

    /**
     * GET /api/v1/sources/active - 활성 데이터 소스 목록 조회
     */
    @GetMapping("/active")
    public ResponseEntity<Page<DataSourceDTO>> listActiveSources(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"));
        Page<DataSource> sources = dataSourceService.findAllActive(pageable);
        Page<DataSourceDTO> sourceDTOs = sources.map(entityMapper::toDataSourceDTO);
        
        return ResponseEntity.ok(sourceDTOs);
    }

    /**
     * GET /api/v1/sources/{id} - ID로 데이터 소스 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<DataSourceDTO> getSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(entityMapper::toDataSourceDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources - 새로운 데이터 소스 등록
     */
    @PostMapping
    public ResponseEntity<DataSourceDTO> createSource(@Valid @RequestBody DataSourceCreateRequest request) {
        DataSource source = entityMapper.toDataSource(request);
        DataSource savedSource = dataSourceService.create(source);
        DataSourceDTO dto = entityMapper.toDataSourceDTO(savedSource);
        
        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
    }

    /**
     * PUT /api/v1/sources/{id} - 데이터 소스 수정
     */
    @PutMapping("/{id}")
    public ResponseEntity<DataSourceDTO> updateSource(
            @PathVariable Long id,
            @Valid @RequestBody DataSourceUpdateRequest request) {
        
        return dataSourceService.findById(id)
                .map(existingSource -> {
                    entityMapper.updateDataSourceFromRequest(request, existingSource);
                    DataSource updated = dataSourceService.save(existingSource);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * DELETE /api/v1/sources/{id} - 데이터 소스 삭제
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSource(@PathVariable Long id) {
        boolean deleted = dataSourceService.delete(id);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * POST /api/v1/sources/{id}/activate - 데이터 소스 활성화
     */
    @PostMapping("/{id}/activate")
    public ResponseEntity<DataSourceDTO> activateSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(source -> {
                    source.setIsActive(true);
                    DataSource updated = dataSourceService.save(source);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources/{id}/deactivate - 데이터 소스 비활성화
     */
    @PostMapping("/{id}/deactivate")
    public ResponseEntity<DataSourceDTO> deactivateSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(source -> {
                    source.setIsActive(false);
                    DataSource updated = dataSourceService.save(source);
                    return ResponseEntity.ok(entityMapper.toDataSourceDTO(updated));
                })
                .orElse(ResponseEntity.notFound().build());
    }
}
