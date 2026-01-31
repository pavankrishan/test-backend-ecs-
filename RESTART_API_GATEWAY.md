# How to Restart API Gateway to Fix CORS

## The Problem
You're seeing CORS errors because the API Gateway needs to be restarted to apply the CORS configuration changes.

## Solution: Restart the API Gateway

### Option 1: If using `npm run dev` (Auto-reload)
If you're running the API Gateway with `npm run dev` (which uses `tsx watch`), it should auto-reload when files change. However, sometimes you need to manually restart:

1. **Stop the API Gateway**: Press `Ctrl+C` in the terminal where it's running
2. **Restart it**:
   ```bash
   cd kc-backend/services/api-gateway
   npm run dev
   ```

### Option 2: If using `npm start` (Production mode)
If you're running with `npm start`, you need to rebuild first:

1. **Stop the API Gateway**: Press `Ctrl+C`
2. **Rebuild**:
   ```bash
   cd kc-backend/services/api-gateway
   npm run build
   ```
3. **Restart**:
   ```bash
   npm start
   ```

### Option 3: Quick Restart Script
If you have a script that starts all services, restart that.

## Verify It's Working

After restarting, test the CORS configuration:

1. **Check the health endpoint**:
   ```bash
   curl http://localhost:3000/health
   ```

2. **Test CORS with OPTIONS request** (in browser console):
   ```javascript
   fetch('http://localhost:3000/api/v1/admin/auth/login', {
     method: 'OPTIONS',
     headers: {
       'Origin': 'http://localhost:5173',
       'Access-Control-Request-Method': 'POST',
       'Access-Control-Request-Headers': 'Content-Type'
     }
   }).then(r => {
     console.log('CORS Headers:', {
       'Access-Control-Allow-Origin': r.headers.get('Access-Control-Allow-Origin'),
       'Access-Control-Allow-Methods': r.headers.get('Access-Control-Allow-Methods'),
       'Access-Control-Allow-Credentials': r.headers.get('Access-Control-Allow-Credentials')
     });
   });
   ```

3. **Try logging in again** from the frontend - the CORS error should be gone.

## What Changed

The CORS configuration now:
- ✅ Explicitly allows `http://localhost:5173` (Vite dev server)
- ✅ Handles OPTIONS preflight requests
- ✅ Sets proper CORS headers
- ✅ Allows credentials (cookies/auth headers)

## Still Having Issues?

If CORS errors persist after restarting:

1. **Check the API Gateway logs** - you should see CORS warnings if an origin is blocked
2. **Verify the port** - Make sure API Gateway is on port 3000
3. **Check environment variables** - Set `CORS_ORIGIN=http://localhost:5173` in your `.env` file
4. **Clear browser cache** - Hard refresh with `Ctrl+Shift+R`

