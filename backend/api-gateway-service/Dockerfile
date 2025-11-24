# Multi-stage build for API Gateway Service
FROM gradle:8.5-jdk21-alpine AS builder

WORKDIR /app

# Copy Gradle files for dependency caching
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY backend/shared-libs/build.gradle.kts backend/shared-libs/
COPY backend/api-gateway-service/build.gradle.kts backend/api-gateway-service/

# Download dependencies (cached layer)
RUN gradle :backend:api-gateway-service:dependencies --no-daemon

# Copy source code
COPY backend/api-gateway-service/src backend/api-gateway-service/src

# Build the application
RUN gradle :backend:api-gateway-service:bootJar --no-daemon

# Runtime stage
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Copy the built JAR from builder stage
COPY --from=builder /app/backend/api-gateway-service/build/libs/*.jar app.jar

# Create non-root user
RUN addgroup -S spring && adduser -S spring -G spring
USER spring:spring

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/actuator/health || exit 1

# Run the application
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
