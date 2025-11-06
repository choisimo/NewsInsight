// 공통 라이브러리 모듈 빌드 설정 (선택 사항)

plugins {
    `java-library`
}

// 공통 라이브러리는 실행 가능한 JAR가 아니므로 일반 JAR로 패키징
tasks.named<Jar>("jar") {
    enabled = true
}

dependencies {
    // 공통으로 사용할 유틸리티 클래스, 예외, DTO 등
    
    // Consul Config (공통 설정 로더)
    api("org.springframework.cloud:spring-cloud-starter-consul-config")
    
    // Validation
    api("org.springframework.boot:spring-boot-starter-validation")
    
    // JSON Processing
    api("com.fasterxml.jackson.core:jackson-databind")
    api("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
}
