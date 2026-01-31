# Fix for Idle App Errors

## Issues Identified

When the app is idle, you're seeing these errors:

1. **JWT Token Expired Errors**: Tokens expired but app keeps making requests
2. **Background Polling**: App polls API every 30 seconds even when idle
3. **Database Connection Errors**: PostgreSQL database not reachable

## Fixes Applied

### 1. App State Detection
- Added `AppState` monitoring to detect foreground/background
- Background polling now stops when app is in background
- Only polls when app is in `active` state

### 2. Token Expiration Check
- Added token expiration check before making requests
- Prevents requests with expired tokens
- Better error suppression for expected failures

### 3. Background Polling Improvements
- Stops polling when app is in background
- Stops polling when token is expired
- Exponential backoff on failures
- Reduced logging noise (only logs 10% of background errors)

### 4. Error Suppression
- Suppresses expected errors for background services
- Reduces console noise when app is idle
- Better error categorization

## Changes Made

### `kc-app/context/LocationTrackingContext.tsx`
- Added `AppState` import and monitoring
- Added `appStateRef` to track app state
- Modified polling to only run when app is `active`
- Added app state check before making API calls

### `kc-app/services/api/client.ts`
- Added `isTokenExpired()` helper function
- Added token expiration check in request interceptor
- Improved error suppression for background services
- Reduced logging for background polling requests

## Result

- ✅ No more polling when app is in background
- ✅ No more requests with expired tokens
- ✅ Reduced error noise in console
- ✅ Better battery life (no unnecessary polling)
- ✅ Better user experience (no errors when app is idle)

## Testing

1. Open the app
2. Put app in background (press home button)
3. Check logs - should see no more polling errors
4. Wait for token to expire
5. Check logs - should see no more token expired errors for background requests

## Notes

- Background polling will resume when app comes to foreground
- Token refresh will happen automatically when app is active
- Database connection errors are separate issue (check DATABASE_URL)

