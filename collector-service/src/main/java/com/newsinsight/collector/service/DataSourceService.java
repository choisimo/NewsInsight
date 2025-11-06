package com.newsinsight.collector.service;

import com.newsinsight.collector.dto.*;
import com.newsinsight.collector.entity.DataSource;
import com.newsinsight.collector.entity.SourceType;
import com.newsinsight.collector.mapper.EntityMapper;
import com.newsinsight.collector.repository.DataSourceRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class DataSourceService {

    private final DataSourceRepository dataSourceRepository;
    private final EntityMapper entityMapper;

    @Transactional(readOnly = true)
    public List<DataSourceDTO> getAllSources() {
        return dataSourceRepository.findAll().stream()
                .map(entityMapper::toDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<DataSourceDTO> getActiveSources() {
        return dataSourceRepository.findByIsActiveTrue().stream()
                .map(entityMapper::toDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<DataSourceDTO> getSourcesByType(SourceType sourceType) {
        return dataSourceRepository.findBySourceType(sourceType).stream()
                .map(entityMapper::toDTO)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public DataSourceDTO getSource(Long id) {
        return dataSourceRepository.findById(id)
                .map(entityMapper::toDTO)
                .orElse(null);
    }

    // Alias method for findById returning Optional<DataSource>
    @Transactional(readOnly = true)
    public Optional<DataSource> findById(Long id) {
        return dataSourceRepository.findById(id);
    }

    @Transactional
    public DataSourceDTO createSource(DataSourceCreateRequest request) {
        DataSource source = entityMapper.toEntity(request);
        DataSource saved = dataSourceRepository.save(source);
        log.info("Created data source: id={}, name={}, type={}", 
                 saved.getId(), saved.getName(), saved.getSourceType());
        return entityMapper.toDTO(saved);
    }

    // Alias method returning DataSource entity
    @Transactional
    public DataSource create(DataSource source) {
        DataSource saved = dataSourceRepository.save(source);
        log.info("Created data source: id={}, name={}, type={}", 
                 saved.getId(), saved.getName(), saved.getSourceType());
        return saved;
    }

    @Transactional
    public DataSourceDTO updateSource(Long id, DataSourceUpdateRequest request) {
        DataSource source = dataSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Data source not found: " + id));
        
        entityMapper.updateEntity(source, request);
        DataSource saved = dataSourceRepository.save(source);
        log.info("Updated data source: id={}, name={}", saved.getId(), saved.getName());
        return entityMapper.toDTO(saved);
    }

    // Alias method for update returning DataSource entity
    @Transactional
    public DataSource update(Long id, DataSourceUpdateRequest request) {
        DataSource source = dataSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Data source not found: " + id));
        
        entityMapper.updateEntity(source, request);
        DataSource saved = dataSourceRepository.save(source);
        log.info("Updated data source: id={}, name={}", saved.getId(), saved.getName());
        return saved;
    }

    @Transactional
    public void deleteSource(Long id) {
        if (!dataSourceRepository.existsById(id)) {
            throw new IllegalArgumentException("Data source not found: " + id);
        }
        dataSourceRepository.deleteById(id);
        log.info("Deleted data source: id={}", id);
    }

    // Alias method returning boolean
    @Transactional
    public boolean delete(Long id) {
        if (!dataSourceRepository.existsById(id)) {
            return false;
        }
        dataSourceRepository.deleteById(id);
        log.info("Deleted data source: id={}", id);
        return true;
    }

    @Transactional
    public void updateLastCollected(Long id, LocalDateTime timestamp) {
        DataSource source = dataSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Data source not found: " + id));
        source.setLastCollected(timestamp);
        dataSourceRepository.save(source);
    }

    @Transactional(readOnly = true)
    public List<DataSource> findDueForCollection() {
        LocalDateTime threshold = LocalDateTime.now().minusSeconds(3600); // Default 1 hour
        return dataSourceRepository.findDueForCollection(threshold);
    }

    @Transactional(readOnly = true)
    public List<DataSource> findActiveSources() {
        return dataSourceRepository.findByIsActiveTrue();
    }

    // Additional paginated methods
    @Transactional(readOnly = true)
    public Page<DataSource> findAll(Pageable pageable) {
        return dataSourceRepository.findAll(pageable);
    }

    @Transactional(readOnly = true)
    public Page<DataSource> findAllActive(Pageable pageable) {
        return dataSourceRepository.findAll(pageable)
                .map(source -> source.getIsActive() ? source : null);
    }

    @Transactional(readOnly = true)
    public long countAll() {
        return dataSourceRepository.count();
    }

    @Transactional(readOnly = true)
    public long countActive() {
        return dataSourceRepository.findByIsActiveTrue().size();
    }

    // Method to save/update entity directly
    @Transactional
    public DataSource save(DataSource source) {
        return dataSourceRepository.save(source);
    }
}
