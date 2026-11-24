# ==============================================================================
# Multi-stage Dockerfile for PugArch Connect (Frontend + Backend Unified Portal)
# Optimized for Google Cloud Run / GCP GKE / Compute Engine
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Backend
# ------------------------------------------------------------------------------
FROM node:20-slim AS backend-builder
WORKDIR /app/backend

# Install build dependencies
COPY backend/package*.json ./
RUN npm ci

# Copy backend source and compile TypeScript
COPY backend/ ./
RUN npm run build

# Remove development dependencies to keep runtime lean
RUN npm prune --production

# ------------------------------------------------------------------------------
# Stage 2: Build Frontend
# ------------------------------------------------------------------------------
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

# Install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Pass API URL at build time (defaults to relative /api which routes via Nginx)
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build Next.js with standalone output
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 3: Production Runner (Nginx + Backend + Frontend via Supervisord)
# ------------------------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app

# Install Nginx, Supervisor, gettext (for envsubst), curl (for healthchecks), and sed
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    gettext-base \
    curl \
    sed \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

# 1. Setup Backend
WORKDIR /app/backend
COPY --from=backend-builder /app/backend/package.json ./
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/dist ./dist

# 2. Setup Frontend (Next.js Standalone)
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static ./.next/static
COPY --from=frontend-builder /app/frontend/public ./public

# 3. Setup Orchestration Configurations
WORKDIR /app
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/wait-and-start-nginx.sh /app/wait-and-start-nginx.sh

# Ensure scripts are executable and strip Windows CRLF line endings if present
RUN sed -i 's/\r$//' /app/*.sh && chmod +x /app/*.sh

# Cloud Run dynamic PORT variable (defaults to 8080)
EXPOSE 8080

# Health check matching GCP Cloud Run probes
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:${PORT:-8080}/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
