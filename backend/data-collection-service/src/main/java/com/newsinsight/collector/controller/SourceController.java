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
     * GET /api/v1/sources - List all data sources
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
     * GET /api/v1/sources/active - List active data sources
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
     * GET /api/v1/sources/{id} - Get data source by ID
     */
    @GetMapping("/{id}")
    public ResponseEntity<DataSourceDTO> getSource(@PathVariable Long id) {
        return dataSourceService.findById(id)
                .map(entityMapper::toDataSourceDTO)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * POST /api/v1/sources - Create new data source
     */
    @PostMapping
    public ResponseEntity<DataSourceDTO> createSource(@Valid @RequestBody DataSourceCreateRequest request) {
        DataSource source = entityMapper.toDataSource(request);
        DataSource savedSource = dataSourceService.create(source);
        DataSourceDTO dto = entityMapper.toDataSourceDTO(savedSource);
        
        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
    }

    /**
     * PUT /api/v1/sources/{id} - Update data source
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
     * DELETE /api/v1/sources/{id} - Delete data source
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteSource(@PathVariable Long id) {
        boolean deleted = dataSourceService.delete(id);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }

    /**
     * POST /api/v1/sources/{id}/activate - Activate data source
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
     * POST /api/v1/sources/{id}/deactivate - Deactivate data source
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
