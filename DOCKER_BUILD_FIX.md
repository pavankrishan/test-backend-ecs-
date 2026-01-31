# Docker Build Fix: POSTGRES_URL Not Required During Build

## Problem
Backend services were accessing runtime environment variables (`POSTGRES_URL`, `POSTGRES_URI`) during Docker build phase, causing build failures. This violates Docker best practices where build-time should not require runtime secrets.

## Root Cause
The `shared/config/global-env.ts` file was validating `POSTGRES_URL` at module import time. When any service imported from `@kodingcaravan/shared`, it triggered this validation chain:
- `shared/index.ts` → `shared/config/index.ts` → `shared/config/global-init.ts` → `shared/config/global-env.ts`
- Validation ran during TypeScript compilation/build, requiring env vars that don't exist at build time

## Solution

### 1. Refactored `global-env.ts`
- **Removed**: Validation at module import time
- **Added**: Lazy validation function `validateRequiredEnvVars()` that only runs when explicitly called
- **Result**: Module can be imported without requiring env vars

### 2. Updated `global-init.ts`
- **Changed**: Logger initialization only logs if `NODE_ENV` is defined (prevents build-time logging issues)
- **Result**: Safe to import during build

### 3. Verified Database Connection Code
- **Confirmed**: All database connection functions (`createPostgresPool`, `createCloudConnectionPool`) only access env vars when invoked at runtime
- **Result**: No env var access at import time

## Changes Made

### Files Modified
1. `shared/config/global-env.ts`
   - Removed top-level validation
   - Added `validateRequiredEnvVars()` function for runtime validation
   - Added documentation explaining when to call it

2. `shared/config/global-init.ts`
   - Added guard to prevent logging during build (when `NODE_ENV` is undefined)

## Expected Behavior

### ✅ Build Time (docker compose build)
- **No POSTGRES_URL required**: Build completes successfully without any database env vars
- **Only runs**: `npm install`, `npm run build`
- **No node processes**: Only compilation happens, no runtime code executes

### ✅ Runtime (docker compose up)
- **POSTGRES_URL required**: Services will fail correctly if `POSTGRES_URL` is missing
- **Failure point**: When services attempt to connect to database (in `initialize()`, `start()`, etc.)
- **Error message**: Clear error indicating missing `POSTGRES_URL`

## Verification

### Test Build (without POSTGRES_URL)
```bash
# Unset POSTGRES_URL
unset POSTGRES_URL  # Linux/Mac
$env:POSTGRES_URL = $null  # PowerShell

# Build should succeed
docker compose build allocation-worker
docker compose build api-gateway
docker compose build course-service
# ... all services should build successfully
```

### Test Runtime (with POSTGRES_URL)
```bash
# Set POSTGRES_URL
export POSTGRES_URL="postgres://..."  # Linux/Mac
$env:POSTGRES_URL = "postgres://..."  # PowerShell

# Services should start successfully
docker compose up allocation-worker
```

### Test Runtime (without POSTGRES_URL)
```bash
# Unset POSTGRES_URL
unset POSTGRES_URL  # Linux/Mac
$env:POSTGRES_URL = $null  # PowerShell

# Services should fail with clear error
docker compose up allocation-worker
# Expected: Error about missing POSTGRES_URL when connection is attempted
```

## Optional: Explicit Validation

If you want services to fail fast with a clear error message before attempting database connections, you can call `validateRequiredEnvVars()` at the start of service entry points:

```typescript
import { validateRequiredEnvVars } from '@kodingcaravan/shared/config/global-env';

async function start() {
  // Validate env vars before starting
  validateRequiredEnvVars();
  
  // ... rest of startup code
}
```

**Note**: This is optional. Services will still fail correctly at runtime when they attempt database connections if `POSTGRES_URL` is missing.

## Docker Best Practices Followed

✅ **Build-time**: No runtime secrets required  
✅ **Runtime**: Clear failure if required env vars are missing  
✅ **Separation**: Build and runtime concerns are properly separated  
✅ **Lazy initialization**: Database connections only happen at runtime  

## Impact

- ✅ All services can build without `POSTGRES_URL`
- ✅ Services still fail correctly at runtime if `POSTGRES_URL` is missing
- ✅ No breaking changes to existing code
- ✅ Follows Docker best practices
