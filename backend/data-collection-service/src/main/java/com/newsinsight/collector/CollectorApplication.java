package com.newsinsight.collector;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * NewsInsight Collector Service Application
 * 
 * Spring Boot 기반의 뉴스 수집 서비스
 * - 다양한 소스(RSS, Web Scraping, API)에서 뉴스 수집
 * - 비동기 처리를 통한 효율적인 수집
 * - Consul을 통한 서비스 디스커버리 및 설정 관리
 * - PostgreSQL 데이터베이스를 통한 데이터 저장
 */
@SpringBootApplication
@EnableDiscoveryClient
@EnableAsync
@EnableScheduling
public class CollectorApplication {

    public static void main(String[] args) {
        SpringApplication.run(CollectorApplication.class, args);
    }
}
