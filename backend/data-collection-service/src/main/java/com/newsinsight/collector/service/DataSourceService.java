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

    /**
     * 모든 데이터 소스 목록 조회
     */
    @Transactional(readOnly = true)
    public List<DataSourceDTO> getAllSources() {
        return dataSourceRepository.findAll().stream()
                .map(entityMapper::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * 활성화된 데이터 소스 목록 조회
     */
    @Transactional(readOnly = true)
    public List<DataSourceDTO> getActiveSources() {
        return dataSourceRepository.findByIsActiveTrue().stream()
                .map(entityMapper::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * 소스 타입별 데이터 소스 조회
     */
    @Transactional(readOnly = true)
    public List<DataSourceDTO> getSourcesByType(SourceType sourceType) {
        return dataSourceRepository.findBySourceType(sourceType).stream()
                .map(entityMapper::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * 데이터 소스 단건 조회 (ID)
     */
    @Transactional(readOnly = true)
    public DataSourceDTO getSource(Long id) {
        return dataSourceRepository.findById(id)
                .map(entityMapper::toDTO)
                .orElse(null);
    }

    // findById의 Optional<DataSource> 반환 버전
    @Transactional(readOnly = true)
    public Optional<DataSource> findById(Long id) {
        return dataSourceRepository.findById(id);
    }

    /**
     * 데이터 소스 생성 (DTO 요청 기반)
     */
    @Transactional
    public DataSourceDTO createSource(DataSourceCreateRequest request) {
        DataSource source = entityMapper.toEntity(request);
        DataSource saved = dataSourceRepository.save(source);
        log.info("Created data source: id={}, name={}, type={}", 
                 saved.getId(), saved.getName(), saved.getSourceType());
        return entityMapper.toDTO(saved);
    }

    // 엔티티 직접 저장/반환 버전
    @Transactional
    public DataSource create(DataSource source) {
        DataSource saved = dataSourceRepository.save(source);
        log.info("Created data source: id={}, name={}, type={}", 
                 saved.getId(), saved.getName(), saved.getSourceType());
        return saved;
    }

    /**
     * 데이터 소스 수정 (DTO 요청 기반)
     */
    @Transactional
    public DataSourceDTO updateSource(Long id, DataSourceUpdateRequest request) {
        DataSource source = dataSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Data source not found: " + id));
        
        entityMapper.updateEntity(source, request);
        DataSource saved = dataSourceRepository.save(source);
        log.info("Updated data source: id={}, name={}", saved.getId(), saved.getName());
        return entityMapper.toDTO(saved);
    }

    // 엔티티 직접 수정/반환 버전
    @Transactional
    public DataSource update(Long id, DataSourceUpdateRequest request) {
        DataSource source = dataSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Data source not found: " + id));
        
        entityMapper.updateEntity(source, request);
        DataSource saved = dataSourceRepository.save(source);
        log.info("Updated data source: id={}, name={}", saved.getId(), saved.getName());
        return saved;
    }

    /**
     * 데이터 소스 삭제 (예외 발생)
     */
    @Transactional
    public void deleteSource(Long id) {
        if (!dataSourceRepository.existsById(id)) {
            throw new IllegalArgumentException("Data source not found: " + id);
        }
        dataSourceRepository.deleteById(id);
        log.info("Deleted data source: id={}", id);
    }

    // 삭제 결과를 boolean으로 반환하는 버전
    @Transactional
    public boolean delete(Long id) {
        if (!dataSourceRepository.existsById(id)) {
            return false;
        }
        dataSourceRepository.deleteById(id);
        log.info("Deleted data source: id={}", id);
        return true;
    }

    /**
     * 마지막 수집 시각 업데이트
     */
    @Transactional
    public void updateLastCollected(Long id, LocalDateTime timestamp) {
        DataSource source = dataSourceRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Data source not found: " + id));
        source.setLastCollected(timestamp);
        dataSourceRepository.save(source);
    }

    /**
     * 수집 대상(기한 도래) 소스 조회
     */
    @Transactional(readOnly = true)
    public List<DataSource> findDueForCollection() {
        LocalDateTime threshold = LocalDateTime.now().minusSeconds(3600); // Default 1 hour
        return dataSourceRepository.findDueForCollection(threshold);
    }

    /**
     * 활성화된 소스 목록 조회
     */
    @Transactional(readOnly = true)
    public List<DataSource> findActiveSources() {
        return dataSourceRepository.findByIsActiveTrue();
    }

    // 페이징 지원 메서드
    /**
     * 모든 소스 페이징 조회
     */
    @Transactional(readOnly = true)
    public Page<DataSource> findAll(Pageable pageable) {
        return dataSourceRepository.findAll(pageable);
    }

    /**
     * 활성 소스 페이징 조회 (주의: null 포함 가능)
     */
    @Transactional(readOnly = true)
    public Page<DataSource> findAllActive(Pageable pageable) {
        return dataSourceRepository.findAll(pageable)
                .map(source -> source.getIsActive() ? source : null);
    }

    /**
     * 전체 소스 개수 조회
     */
    @Transactional(readOnly = true)
    public long countAll() {
        return dataSourceRepository.count();
    }

    /**
     * 활성 소스 개수 조회
     */
    @Transactional(readOnly = true)
    public long countActive() {
        return dataSourceRepository.findByIsActiveTrue().size();
    }

    // 엔티티 직접 저장/업데이트
    /**
     * 데이터 소스 저장/업데이트 (엔티티 직접 전달)
     */
    @Transactional
    public DataSource save(DataSource source) {
        return dataSourceRepository.save(source);
    }
}
