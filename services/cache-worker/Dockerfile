FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY services/cache-worker/package*.json ./services/cache-worker/
COPY shared/package*.json ./shared/

# Copy TypeScript config (needed for shared package build)
COPY tsconfig.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN npm install --legacy-peer-deps

# Copy source
COPY shared ./shared
COPY services/cache-worker ./services/cache-worker

# Build
RUN cd shared && npm run build
RUN cd services/cache-worker && npm run build

# # Remove dev dependencies to reduce image size
# RUN npm prune --production

# Run as non-root for ECS security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

WORKDIR /app/services/cache-worker

CMD ["node", "dist/index.js"]

