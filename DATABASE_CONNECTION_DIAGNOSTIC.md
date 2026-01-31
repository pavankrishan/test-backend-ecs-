# Database Connection Diagnostic & Fix Guide

## Error Analysis

### Error Message
```
Error: getaddrinfo ENOTFOUND dpg-d4iloikhg0os73a1789g-a.oregon-postgres.render.com
```

### Root Cause
**DNS Resolution Failure**: The backend cannot resolve the PostgreSQL database hostname. This indicates:

1. **Database hostname is unreachable** - The database service may be:
   - Paused (Render free tier databases pause after inactivity)
   - Deleted or terminated
   - Network connectivity issue between backend and database

2. **Incorrect connection string** - The `POSTGRES_URL` or `DATABASE_URL` environment variable may contain:
   - Wrong hostname
   - Expired/rotated credentials
   - Missing SSL configuration

3. **Render.com Database Status** - Render PostgreSQL databases can:
   - Auto-pause on free tier (requires manual resume)
   - Have connection limits
   - Require specific connection string format

## Diagnostic Steps

### Step 1: Verify Database Status on Render

1. **Log into Render Dashboard**: https://dashboard.render.com
2. **Navigate to Databases**: Find your PostgreSQL database
3. **Check Status**:
   - ✅ **Running** - Database is active
   - ⏸️ **Paused** - Database is paused (free tier)
   - ❌ **Deleted** - Database no longer exists

### Step 2: Check Connection String Format

The connection string should be in this format:
```
postgresql://username:password@hostname:port/database?sslmode=require
```

**Render PostgreSQL Connection String Format**:
```
postgresql://username:password@dpg-xxxxx-a.oregon-postgres.render.com:5432/database_name?sslmode=require
```

### Step 3: Verify Environment Variables

Check your backend service environment variables on Render:

**Required Variables**:
- `POSTGRES_URL` OR `DATABASE_URL` (one of these must be set)
- `POSTGRES_SSL=true` (if not in connection string)

**How to Check**:
1. Go to Render Dashboard → Your Service → Environment
2. Verify `POSTGRES_URL` or `DATABASE_URL` is set
3. Copy the connection string and verify it matches Render's database connection string

### Step 4: Test Database Connection

#### Option A: Test from Render Shell
1. Go to Render Dashboard → Your Database → Shell
2. Try connecting:
```bash
psql $DATABASE_URL
```

#### Option B: Test from Backend Service Logs
Check if the service is attempting to connect:
```bash
# View service logs
render logs <service-name>
```

Look for:
- Connection attempts
- DNS resolution errors
- SSL handshake errors

## Fixes

### Fix 1: Resume Paused Database (Free Tier)

If your database is paused:

1. **Go to Render Dashboard** → Your Database
2. **Click "Resume"** button
3. **Wait 1-2 minutes** for database to start
4. **Retry the connection**

### Fix 2: Update Connection String

If the connection string is incorrect:

1. **Get correct connection string from Render**:
   - Go to Render Dashboard → Your Database → Info
   - Copy the "Internal Database URL" or "External Database URL"
   - Use "Internal" if backend is on Render, "External" if backend is elsewhere

2. **Update environment variable**:
   - Go to Render Dashboard → Your Service → Environment
   - Update `POSTGRES_URL` or `DATABASE_URL`
   - Ensure it includes `?sslmode=require` at the end

3. **Redeploy service**:
   - Changes to environment variables require manual redeploy
   - Go to Render Dashboard → Your Service → Manual Deploy

### Fix 3: Verify SSL Configuration

Render PostgreSQL requires SSL. Ensure your connection string includes:
```
?sslmode=require
```

Or set environment variable:
```
POSTGRES_SSL=true
```

### Fix 4: Check Database Connection Limits

Render free tier databases have connection limits:
- **Free tier**: 97 connections max
- **Starter tier**: 97 connections max
- **Standard tier**: 97 connections max

**If you're hitting limits**:
1. Check connection pool settings in `shared/databases/postgres/cloud-connection.ts`
2. Reduce `max` connections per service
3. Current setting: `max: 10` per service (safe)

### Fix 5: Network/DNS Issues

If database is running but still can't connect:

1. **Check if backend and database are in same region**:
   - Both should be in same region (e.g., Oregon)
   - Cross-region connections may have latency/connectivity issues

2. **Use Internal Connection String**:
   - If backend is on Render, use "Internal Database URL"
   - Internal connections are faster and more reliable

3. **Check Render Status Page**:
   - https://status.render.com
   - Verify no ongoing incidents

## Code-Level Fixes

### Add Better Error Handling

The current error handling in `studentAuth.service.ts` should catch connection errors. Let's verify it's working:

**File**: `kc-backend/services/student-auth-service/src/services/studentAuth.service.ts`

The `persistRefreshToken` function calls `storeRefreshToken`, which uses the database connection pool. If the pool can't connect, it should throw a connection error.

### Add Connection Retry Logic

The `withTransaction` function in `database.ts` already has retry logic for connection errors. Verify it's working:

**File**: `kc-backend/services/student-auth-service/src/config/database.ts`

Lines 30-62 show retry logic for connection errors.

## Verification

After applying fixes:

1. **Check service logs**:
```bash
render logs <service-name> --tail
```

2. **Look for successful connection**:
```
✅ Connected to database
✅ Database health check passed
```

3. **Test OAuth login**:
- Try Google Sign-In again
- Should complete without database errors

## Prevention

### 1. Use Render Database Auto-Resume

For free tier databases, consider:
- Using a paid tier (databases don't auto-pause)
- Setting up a cron job to ping database periodically
- Using Render's webhook to auto-resume on first request

### 2. Monitor Database Status

Set up alerts:
- Render Dashboard → Your Database → Alerts
- Get notified when database is paused or has issues

### 3. Use Connection Pooling Wisely

Current settings are safe:
- `max: 10` connections per service
- `connectionTimeoutMillis: 20000` (20 seconds)
- Retry logic for transient failures

## Summary

**Most Likely Cause**: Database is paused (Render free tier)

**Quick Fix**:
1. Go to Render Dashboard
2. Find your PostgreSQL database
3. Click "Resume"
4. Wait 1-2 minutes
5. Retry OAuth login

**If database is running**: Check connection string format and SSL configuration.
