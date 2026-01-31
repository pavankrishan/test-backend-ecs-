FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY services/session-worker/package*.json ./services/session-worker/
COPY shared/package*.json ./shared/

# Copy TypeScript config (needed for shared package build)
COPY tsconfig.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN npm install --legacy-peer-deps

# Copy source
COPY shared ./shared
COPY services/session-worker ./services/session-worker

# Build
RUN cd shared && npm run build
RUN cd services/session-worker && npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Run as non-root for ECS security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

WORKDIR /app/services/session-worker

CMD ["node", "dist/index.js"]

