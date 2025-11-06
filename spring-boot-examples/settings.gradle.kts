// NewsInsight Spring Boot 멀티 모듈 프로젝트 설정

rootProject.name = "newsinsight"

// 마이그레이션 대상 서비스 모듈
include(
    "api-gateway",           // Spring Cloud Gateway
    "collector-service",     // Spring Boot Collector (web-crawler 통합)
    "common"                 // 공통 라이브러리 (선택 사항)
)
