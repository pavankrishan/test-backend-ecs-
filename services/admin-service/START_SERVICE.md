# How to Start Admin Service

## The Problem
The Admin Service is not starting automatically, causing 502 Bad Gateway errors.

## Solution: Start Manually

### Step 1: Open PowerShell Terminal
Open a new PowerShell terminal window.

### Step 2: Navigate to Admin Service
```powershell
cd C:\Users\PC\Desktop\React-Expo-set\kc-backend\services\admin-service
```

### Step 3: Start the Service
```powershell
pnpm dev
```

### Step 4: Wait for Success Message
You should see:
```
✅ Admin Service is ready to accept requests
✅ Socket.io server running on port 3010
```

### Step 5: Verify It's Working
In another terminal, test:
```powershell
Invoke-RestMethod -Uri "http://localhost:3010/healthz" -Method GET
```

Should return: `{ "status": "ok", "service": "admin" }`

## If You See Errors

### Error: Cannot find module '@kodingcaravan/shared'
**Fix:**
```powershell
cd C:\Users\PC\Desktop\React-Expo-set\kc-backend\shared
pnpm build
cd ..\services\admin-service
pnpm dev
```

### Error: Port 3010 already in use
**Fix:**
```powershell
# Find process using port 3010
netstat -ano | findstr :3010

# Kill the process (replace PID)
taskkill /PID <PID> /F
```

### Error: TypeScript compilation errors
**Fix:**
```powershell
pnpm typecheck
# Fix any errors shown
```

### Error: Database connection failed
The service will still start, but admin features won't work. Check:
- PostgreSQL is running
- Database credentials in `.env` file
- Database exists

## Quick Start Script

You can also use the script created at:
```
kc-backend/start-admin-manual.ps1
```

Just run:
```powershell
.\start-admin-manual.ps1
```

## After Starting

Once the service is running, your login request will work:
```powershell
$body = @{ email = "admin@kodingcaravan.com"; password = "KodingCaravan!23" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/auth/login" -Method POST -Body $body -ContentType "application/json"
```

