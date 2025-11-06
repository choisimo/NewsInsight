// Collector Service 모듈 빌드 설정

plugins {
    java
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

dependencies {
    // Spring Boot Web
    implementation("org.springframework.boot:spring-boot-starter-web")
    
    // Spring Data JPA
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    
    // Redis
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    
    // WebClient for HTTP calls (web-crawler 통합)
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    
    // Database
    runtimeOnly("org.postgresql:postgresql")
    
    // Database Migration (선택)
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    
    // JSON Processing
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-xml")
    implementation("com.fasterxml.jackson.datatype:jackson-datatype-jsr310")
    
    // HTML Parsing (웹 크롤링용)
    implementation("org.jsoup:jsoup:1.17.1")
    
    // RSS Feed Parsing
    implementation("com.rometools:rome:2.1.0")
    
    // Async Support
    implementation("org.springframework.boot:spring-boot-starter-aop")
    
    // Test
    testImplementation("com.h2database:h2")
    testImplementation("org.testcontainers:testcontainers:1.19.3")
    testImplementation("org.testcontainers:postgresql:1.19.3")
    testImplementation("org.testcontainers:junit-jupiter:1.19.3")
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveBaseName.set("collector-service")
    archiveVersion.set("1.0.0")
}
