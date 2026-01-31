# Production Dockerfile Template for KodingCaravan Services
# Architecture: ONE SERVICE = ONE IMAGE
# 
# USAGE: Copy this file to services/<service-name>/Dockerfile
# Replace notification-service and 3006 placeholders
#
# Example for student-service:
#   SERVICE_NAME=student-service
#   SERVICE_PACKAGE=@kodingcaravan/student-service
#   SERVICE_PORT=3003

# ============================================================================
# STAGE 1: Base image with build tools
# ============================================================================
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app

# ============================================================================
# STAGE 2: Dependencies installation
# ============================================================================
FROM base AS deps

# Install build dependencies for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++

# Copy workspace configuration files (required for pnpm workspace resolution)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy shared package.json (required dependency)
COPY shared/package.json ./shared/

# Copy ONLY this service's package.json
COPY services/notification-service/package.json ./services/notification-service/

# Install all dependencies (dev + prod) for build
# Use install (no frozen-lockfile) so lockfile can be updated if package.json has new deps (e.g. firebase-admin)
RUN pnpm install

# ============================================================================
# STAGE 3: Build stage
# ============================================================================
FROM base AS builder

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./

# Copy shared source code
COPY shared ./shared

# Copy ONLY this service's source code
COPY services/notification-service ./services/notification-service

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/services/notification-service/node_modules ./services/notification-service/node_modules

# Build shared package first (required by this service)
RUN pnpm --filter @kodingcaravan/shared build

# Build ONLY this service
RUN pnpm --filter @kodingcaravan/notification-service build

# ============================================================================
# STAGE 4: Production runtime
# ============================================================================
FROM node:20-alpine AS runtime

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy shared package (built dist + package.json)
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist

# Copy service package (built dist + package.json)
COPY --from=builder /app/services/notification-service/package.json ./service/package.json
COPY --from=builder /app/services/notification-service/dist ./service/dist

# Install production dependencies for shared
WORKDIR /app/shared
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts

# Install production dependencies for service
# Replace workspace:* with file:../shared for runtime resolution
WORKDIR /app/service
RUN sed -i 's|"@kodingcaravan/shared": "workspace:\*"|"@kodingcaravan/shared": "file:../shared"|g' package.json && \
    npm install --omit=dev --no-audit --no-fund --ignore-scripts

# Ensure shared package is accessible - npm install should create symlink, but verify it exists
# If npm didn't create it properly, create it manually to help Node.js resolve package exports
RUN if [ ! -L "node_modules/@kodingcaravan/shared" ] && [ ! -d "node_modules/@kodingcaravan/shared" ]; then \
        mkdir -p node_modules/@kodingcaravan && \
        ln -sfn ../../shared node_modules/@kodingcaravan/shared; \
    fi

# Verify shared package dist files exist (static verification, no code execution)
RUN test -f /app/shared/dist/config/index.js || (echo "ERROR: Shared package dist/config/index.js not found" && exit 1) && \
    test -f /app/shared/dist/index.js || (echo "ERROR: Shared package dist/index.js not found" && exit 1) && \
    test -f /app/shared/package.json || (echo "ERROR: Shared package.json not found" && exit 1) && \
    echo "✅ Shared package structure verified (no runtime code executed)"

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set working directory to service
WORKDIR /app/service

ENV PORT=3006
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || '3006') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Start the service
CMD ["node", "dist/index.js"]

