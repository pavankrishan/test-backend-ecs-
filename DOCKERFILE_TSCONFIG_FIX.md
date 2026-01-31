# Dockerfile TypeScript Config Fix

## Problem
The shared `tsconfig.json` extends `../tsconfig.json`, but the root `tsconfig.json` was not being copied into Docker containers, causing:
- `error TS5083: Cannot read file '/app/tsconfig.json'.`
- Files not recognized as modules

## Solution
Added `COPY tsconfig.json ./` to all worker Dockerfiles before the build step.

## Files Modified
- ✅ `services/purchase-worker/Dockerfile`
- ✅ `services/allocation-worker/Dockerfile`
- ✅ `services/session-worker/Dockerfile`
- ✅ `services/cache-worker/Dockerfile`

## Build Order Now
1. Copy package files
2. **Copy root tsconfig.json** ← NEW
3. Install dependencies
4. Copy source code
5. Build shared package (can now find root tsconfig.json)
6. Build worker package
7. Remove dev dependencies

## Next Steps
Rebuild workers:
```bash
docker-compose build purchase-worker allocation-worker session-worker cache-worker
docker-compose up -d purchase-worker allocation-worker session-worker cache-worker
```

The TypeScript compilation should now find the root `tsconfig.json` and resolve all module imports correctly.

