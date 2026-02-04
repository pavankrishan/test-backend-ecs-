FROM node:20-alpine

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy package files
COPY package*.json ./
COPY services/allocation-worker/package*.json ./services/allocation-worker/
COPY services/admin-service/package*.json ./services/admin-service/
COPY shared/package*.json ./shared/

# Copy pnpm workspace and lock files
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Copy TypeScript config (needed for shared package build)
COPY tsconfig.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN pnpm install

# Copy source
COPY shared ./shared
COPY services/allocation-worker ./services/allocation-worker
COPY services/admin-service ./services/admin-service

# Build (admin-service must be built first for allocation-worker to import from it)
RUN cd shared && pnpm run build
RUN cd services/admin-service && pnpm run build
RUN cd services/allocation-worker && pnpm run build

# # Remove dev dependencies to reduce image size
# RUN pnpm prune --production

# Ensure shared package is properly linked in allocation-worker's node_modules
# After prune, the workspace link might be broken, so we manually ensure it exists
WORKDIR /app/services/allocation-worker
RUN mkdir -p node_modules/@kodingcaravan/shared && \
    # Copy shared package files (package.json, dist, and node_modules)
    cp ../../shared/package.json node_modules/@kodingcaravan/shared/ && \
    cp -r ../../shared/dist node_modules/@kodingcaravan/shared/ && \
    cp -r ../../shared/node_modules node_modules/@kodingcaravan/shared/ 2>/dev/null || true && \
    # Verify the shared package structure WITHOUT executing code (build-time safety)
    # Check that required files exist (static verification, no Node execution)
    test -f node_modules/@kodingcaravan/shared/package.json || (echo "ERROR: Shared package.json not found!" && exit 1) && \
    test -f node_modules/@kodingcaravan/shared/dist/index.js || (echo "ERROR: Shared dist/index.js not found!" && exit 1) && \
    test -d node_modules/@kodingcaravan/shared/dist || (echo "ERROR: Shared dist directory not found!" && exit 1) && \
    echo "✅ Shared package structure verified (no runtime code executed)"

# Run as non-root for ECS security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

CMD ["node", "dist/index.js"]

