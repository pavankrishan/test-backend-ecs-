# Dockerfile Build Fix

## Problem
Dockerfiles were installing dependencies with `--production` flag, which excludes devDependencies. However, the build step requires TypeScript (`tsc`) which is a devDependency.

**Error**:
```
sh: tsc: not found
npm error Lifecycle script `build` failed with error: exit code 127
```

## Solution
Updated all 4 worker Dockerfiles to:
1. Install ALL dependencies (including dev) for building
2. Build the TypeScript code
3. Remove dev dependencies after build to reduce image size

## Changes Applied

### All Worker Dockerfiles:
- Changed `RUN npm install --production` → `RUN npm install`
- Added `RUN npm prune --production` after build to clean up dev dependencies

### Files Fixed:
- ✅ `services/purchase-worker/Dockerfile`
- ✅ `services/allocation-worker/Dockerfile`
- ✅ `services/session-worker/Dockerfile`
- ✅ `services/cache-worker/Dockerfile`

## Build Process Now:
1. Install all dependencies (including TypeScript)
2. Copy source code
3. Build shared package
4. Build worker package
5. Remove dev dependencies (keep only production deps)
6. Run worker from `dist/index.js`

## Next Steps
Rebuild workers:
```bash
docker-compose build purchase-worker allocation-worker session-worker cache-worker
docker-compose up -d purchase-worker allocation-worker session-worker cache-worker
```

