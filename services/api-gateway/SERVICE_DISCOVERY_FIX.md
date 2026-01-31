# Service Discovery Fix for Local Development

## Problem

The API Gateway was trying to resolve Docker service names (e.g., `admin-service:3010`) in local development, causing DNS resolution failures:

```
ERROR: getaddrinfo ENOTFOUND admin-service
Status: 502 Bad Gateway
Message: Upstream service unavailable
```

## Root Cause

The `resolveTarget()` function was using Docker service names even in local development when `SERVICES_HOST` was not set or was `localhost`.

## Solution

Updated `resolveTarget()` to:
1. **Check for Docker environment** via `DOCKER` or `IN_DOCKER` env vars
2. **Use localhost in local development** (not Docker)
3. **Use service names in Docker** (inter-container communication)
4. **Add better error logging** for debugging

## Changes Made

### 1. Updated `resolveTarget()` Function

```typescript
function resolveTarget(def: ServiceProxyDefinition): string {
  // ... existing code ...
  
  const isDocker = process.env.DOCKER === 'true' || process.env.IN_DOCKER === 'true';
  
  // For local development (not Docker), use localhost
  if (!isDocker && (!servicesHost || servicesHost === 'http://localhost' || servicesHost === 'localhost')) {
    return `http://localhost:${port}`;
  }
  
  // Docker environment: use service names
  if (isDocker || (!servicesHost || servicesHost === 'http://localhost' || servicesHost === 'localhost')) {
    const dockerServiceName = def.name === 'course-service-structure' ? 'course-service' : def.name;
    return `http://${dockerServiceName}:${port}`;
  }
  
  // ... rest of code ...
}
```

### 2. Enhanced Error Handling

Added detailed error logging in development mode to help debug service discovery issues:

```typescript
onError(err, req, res) {
  const errorMessage = err.message || 'Unknown error';
  const isDnsError = errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo');
  
  if (process.env.NODE_ENV === 'development') {
    console.error(`[API Gateway] Proxy error for ${req.url}:`, {
      error: errorMessage,
      isDnsError,
      hint: isDnsError 
        ? 'Service hostname not resolved. Check if service is running and SERVICES_HOST/DOCKER env vars are set correctly.'
        : undefined,
    });
  }
  // ... error response ...
}
```

### 3. Added Service Registration Logging

Logs service targets during registration in development mode:

```typescript
if (process.env.NODE_ENV === 'development') {
  console.log(`[API Gateway] Registering ${def.name} -> ${target} (routes: ${def.routes.join(', ')})`);
}
```

## Environment Variables

### Local Development
```bash
# Not set or set to localhost - uses localhost:PORT
SERVICES_HOST=localhost
# OR
# (not set)
```

### Docker Development
```bash
# Set DOCKER flag to use service names
DOCKER=true
# OR
IN_DOCKER=true
```

### Production/Custom
```bash
# Set custom host for all services
SERVICES_HOST=http://your-service-host
```

## Verification

After the fix, you should see in development logs:

```
[API Gateway] Registering admin-service -> http://localhost:3010 (routes: /api/v1/admin)
[API Gateway] Registering booking-service -> http://localhost:3011 (routes: /api/v1/booking)
...
```

## Testing

1. **Start all services locally** (not in Docker)
2. **Check API Gateway logs** - should show `localhost:PORT` targets
3. **Make API request** - should succeed without DNS errors
4. **Check error logs** - if service is down, should show helpful error message

## Troubleshooting

### Still getting DNS errors?

1. **Check if services are running:**
   ```bash
   # Check if admin-service is running on port 3010
   curl http://localhost:3010/health
   ```

2. **Check API Gateway logs:**
   - Should show service registration with `localhost:PORT`
   - If showing `admin-service:3010`, check `DOCKER` env var

3. **Verify environment variables:**
   ```bash
   echo $DOCKER
   echo $IN_DOCKER
   echo $SERVICES_HOST
   ```

4. **Restart API Gateway** after setting env vars
