# Build stage
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod .
RUN go mod download
COPY . .
# Ensure go.sum is generated within the build container
RUN go mod tidy
# Ensure output directory exists before writing binary
RUN mkdir -p /out /app/data
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/proxy-admin .

# Run stage
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=build /out/proxy-admin /app/proxy-admin
COPY --from=build /src/static /app/static
COPY --from=build /app/data /app/data
EXPOSE 7080
ENV ADMIN_PORT=7080
ENV ADMIN_DB_PATH=/app/data/proxy-admin.db
ENTRYPOINT ["/app/proxy-admin"]
