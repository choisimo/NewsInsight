FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go mod files
COPY go.mod ./

# Download dependencies (if any)
RUN go mod download

# Copy source code
COPY *.go ./

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o ip-rotation .

# Final stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/ip-rotation .

# Create data directory for persistence
RUN mkdir -p /data

# Environment variables
ENV PORT=8050
ENV STRATEGY=round_robin
ENV MAX_FAILURES=5
ENV COOLDOWN_MINUTES=30
ENV HEALTH_CHECK_INTERVAL=300
ENV PERSISTENCE_PATH=/data/ip_pool_state.json

EXPOSE 8050

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8050/health || exit 1

CMD ["./ip-rotation"]
