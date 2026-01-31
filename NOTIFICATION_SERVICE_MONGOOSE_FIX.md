# Notification Service Mongoose Fix

## Problem
Notification service container was crashing at runtime with:
```
Error: Cannot find module 'mongoose'
Require stack:
- /app/service/dist/services/notification.service.js
- /app/service/dist/app.js
- /app/service/dist/index.js
```

## Root Cause
**`mongoose` was missing from `notification-service/package.json` dependencies.**

The service code imports mongoose in multiple files:
- `src/services/notification.service.ts`: `import { FilterQuery, Types } from 'mongoose'`
- `src/services/fcm.service.ts`: `import { Types } from 'mongoose'`
- `src/services/deviceToken.service.ts`: `import { Types } from 'mongoose'`

However, `package.json` only had:
- `@kodingcaravan/shared`
- `axios`
- `express`
- `google-auth-library`

**Missing**: `mongoose`

## Fix Applied

### 1. Added mongoose to dependencies
**File**: `services/notification-service/package.json`

```json
"dependencies": {
  "@kodingcaravan/shared": "workspace:*",
  "axios": "^1.7.7",
  "express": "^4.18.2",
  "google-auth-library": "^9.0.0",
  "mongoose": "^8.0.3"  // ← ADDED
}
```

**Version**: `^8.0.3` (matches shared package version for consistency)

### 2. Dockerfile Verification
**File**: `services/notification-service/Dockerfile`

The Dockerfile correctly uses:
```dockerfile
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts
```

This is the correct modern syntax (equivalent to `npm install --production`). The Dockerfile is correct.

## Why the Crash Happened

The crash occurred because:
1. **Code imports mongoose** but **package.json doesn't declare it** as a dependency
2. During Docker build, `npm install --omit=dev` only installs packages listed in `dependencies`
3. Since `mongoose` wasn't listed, it wasn't installed
4. At runtime, Node.js tried to `require('mongoose')` and couldn't find the module → **crash**

## Next Steps

1. **Rebuild the notification-service container:**
   ```powershell
   cd kc-backend
   docker-compose build notification-service
   docker-compose up -d notification-service
   ```

2. **Verify the service starts successfully:**
   ```powershell
   docker-compose logs notification-service | Select-String -Pattern "Connected|error|ERROR|uncaughtException"
   ```

3. **Expected logs after fix:**
   - ✅ "Connected to MongoDB" (or similar connection success message)
   - ✅ No "Cannot find module 'mongoose'" errors
   - ✅ Container stays running (doesn't exit)

## Verification Checklist

- [x] mongoose added to dependencies (NOT devDependencies)
- [x] Dockerfile uses `--omit=dev` (correct)
- [x] Version matches shared package (^8.0.3)
- [ ] Container rebuilds successfully
- [ ] Service starts without mongoose errors
- [ ] Service connects to MongoDB successfully

