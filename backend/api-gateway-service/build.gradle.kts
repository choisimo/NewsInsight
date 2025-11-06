// API Gateway 모듈 빌드 설정

plugins {
    java
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

dependencies {
    // Spring Cloud Gateway
    implementation("org.springframework.cloud:spring-cloud-starter-gateway")
    
    // Security (JWT 인증)
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("io.jsonwebtoken:jjwt-api:0.12.3")
    runtimeOnly("io.jsonwebtoken:jjwt-impl:0.12.3")
    runtimeOnly("io.jsonwebtoken:jjwt-jackson:0.12.3")
    
    // Redis for Rate Limiting
    implementation("org.springframework.boot:spring-boot-starter-data-redis-reactive")
    
    // WebFlux (Gateway는 Reactive 스택)
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    
    // Test
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("io.projectreactor:reactor-test")
}

tasks.named<org.springframework.boot.gradle.tasks.bundling.BootJar>("bootJar") {
    archiveBaseName.set("api-gateway")
    archiveVersion.set("1.0.0")
}
