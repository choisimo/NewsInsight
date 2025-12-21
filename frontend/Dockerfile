# Multi-stage build for NewsInsight Frontend
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for better caching
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Copy source files
COPY . .

# Build arguments for environment variables
# NOTE: Do NOT set VITE_API_BASE_URL - let frontend use relative paths via nginx proxy
# Setting an explicit URL like http://api-gateway:8000 would be baked into the JS bundle
# and wouldn't work from the browser (Docker internal network address)
ARG VITE_BROWSER_USE_URL

ENV VITE_BROWSER_USE_URL=${VITE_BROWSER_USE_URL}

# Build the application
RUN npm run build

# Stage 2: Production with Nginx
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Add healthcheck (use 127.0.0.1 to force IPv4)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# Expose port
EXPOSE 8080

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
