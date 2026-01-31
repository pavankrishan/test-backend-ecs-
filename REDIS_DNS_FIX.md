# Redis Connection Fix - DNS Resolution Issue

## Problem Identified

Redis connection was failing with `ENOTFOUND` error even though:
- ✅ Upstash instance is active and working
- ✅ Windows DNS resolution works (`nslookup`, `Test-NetConnection`)
- ✅ TCP connectivity works (port 6379 reachable)
- ❌ Node.js `dns.lookup()` fails
- ✅ Node.js `dns.resolve4()` works

## Root Cause

**Node.js DNS Resolution Issue on Windows**

The issue is that Node.js's `dns.lookup()` function (which ioredis uses by default) fails on this Windows machine, but `dns.resolve4()` works correctly. This is a known issue on some Windows configurations.

## Solution Implemented

Updated `kc-backend/shared/databases/redis/connection.ts` to use a custom DNS lookup function that:
1. Uses `dns.resolve4()` first (works on Windows)
2. Falls back to `dns.lookup()` if resolve4 fails
3. Properly handles TLS/SNI for Upstash connections

## Changes Made

1. Added custom `customLookup()` function that uses `dns.resolve4()`
2. Updated `createRedisClient()` to use custom lookup for URL-based connections
3. Added proper TLS configuration with `servername` for SNI

## Testing

To test the fix:

```powershell
cd kc-backend
# Rebuild shared module
cd shared
npm run build

# Test connection
cd ..
node test-redis-connection.js
```

Or use ts-node to test directly from TypeScript:

```powershell
npx ts-node -e "import { getRedisClient } from './shared/databases/redis/connection'; const client = getRedisClient(); client.connect().then(() => client.ping().then(console.log));"
```

## Alternative Solutions

If the fix doesn't work after rebuilding:

1. **Flush DNS Cache:**
   ```powershell
   ipconfig /flushdns
   ```

2. **Use IP Address Directly (Not Recommended):**
   - Resolve IP: `nslookup lasting-macaque-34205.upstash.io`
   - Use IP in connection string (but lose SNI benefits)

3. **Configure Node.js DNS:**
   - Set `NODE_OPTIONS=--dns-result-order=ipv4first`
   - Or use `family: 4` in connection options

## Status

✅ **Fix implemented** - Custom DNS lookup using `resolve4`
⏳ **Needs rebuild** - Run `npm run build` in `shared/` directory
⏳ **Needs testing** - Test connection after rebuild

## Files Modified

- `kc-backend/shared/databases/redis/connection.ts`

## Next Steps

1. Rebuild the shared module: `cd shared && npm run build`
2. Test the connection: `node test-redis-connection.js`
3. If successful, Redis events will work in `complete-session.js`

