// NewsInsight Spring Boot 멀티 모듈 프로젝트 설정

rootProject.name = "newsinsight"

// Backend 서비스 모듈
include(
    "backend:api-gateway-service",           // Spring Cloud Gateway
    "backend:data-collection-service",       // Data Collection Service (RSS/Web Scraper)
    "backend:shared-libs"                    // 공통 라이브러리
)
