# Production Dockerfile Template for KodingCaravan Services
# Architecture: ONE SERVICE = ONE IMAGE
# 
# USAGE: Copy this file to services/<service-name>/Dockerfile
# Replace trainer-service and 3004 placeholders
#
# Example for student-service:
#   SERVICE_NAME=student-service
#   SERVICE_PACKAGE=@kodingcaravan/student-service
#   SERVICE_PORT=3003

# ============================================================================
# STAGE 1: Base image with build tools
# ============================================================================
FROM node:18-alpine AS base
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
COPY services/trainer-service/package.json ./services/trainer-service/

# Install all dependencies (dev + prod) for build
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
COPY services/trainer-service ./services/trainer-service

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/services/trainer-service/node_modules ./services/trainer-service/node_modules

# Build shared package first (required by this service)
RUN pnpm --filter @kodingcaravan/shared build

# Build ONLY this service
RUN pnpm --filter @kodingcaravan/trainer-service build

# ============================================================================
# STAGE 4: Production runtime
# ============================================================================
FROM node:18-alpine AS runtime

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy shared package (built dist + package.json)
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist

# Copy service package (built dist + package.json)
COPY --from=builder /app/services/trainer-service/package.json ./service/package.json
COPY --from=builder /app/services/trainer-service/dist ./service/dist

# Install production dependencies for shared
WORKDIR /app/shared
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts

# Install production dependencies for service
# Replace workspace:* with file:../shared for runtime resolution
WORKDIR /app/service
RUN sed -i 's|"@kodingcaravan/shared": "workspace:\*"|"@kodingcaravan/shared": "file:../shared"|g' package.json && \
    npm install --omit=dev --no-audit --no-fund --ignore-scripts && \
    # Ensure shared package.json is properly linked in node_modules
    mkdir -p node_modules/@kodingcaravan/shared && \
    cp ../shared/package.json node_modules/@kodingcaravan/shared/ && \
    cp -r ../shared/dist node_modules/@kodingcaravan/shared/ && \
    cp -r ../shared/node_modules node_modules/@kodingcaravan/shared/ 2>/dev/null || true && \
    # Verify package structure (static verification, no code execution)
    test -f node_modules/@kodingcaravan/shared/package.json || (echo "ERROR: Shared package.json not found!" && exit 1) && \
    test -f node_modules/@kodingcaravan/shared/dist/index.js || (echo "ERROR: Shared dist/index.js not found!" && exit 1) && \
    echo "✅ Shared package structure verified (no runtime code executed)"

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set working directory to service
WORKDIR /app/service

ENV PORT=3004
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || '3004') + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Start the service
CMD ["node", "dist/index.js"]

