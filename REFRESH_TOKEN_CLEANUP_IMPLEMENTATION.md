# Refresh Token Cleanup Implementation

## Problem Statement

The refresh token tables were accumulating tokens without cleanup:
- **1 user had 1,109 refresh tokens** (excessive accumulation)
- At **100,000 users**, this could result in **110+ million tokens**
- No automatic cleanup of expired or revoked tokens
- Database bloat and performance degradation

## Solution Implemented

A comprehensive refresh token cleanup system has been implemented with the following features:

### 1. **Automatic Token Limiting Per User**
- **Maximum 10 active tokens per user** (configurable)
- Oldest tokens are automatically deleted when limit is exceeded
- Prevents unbounded growth per user

### 2. **Automatic Cleanup of Expired/Revoked Tokens**
- **Expired tokens**: Deleted 1 day after expiration
- **Revoked tokens**: Deleted after configurable retention period (default: 7 days)
- Runs automatically on token storage (non-blocking)
- Scheduled cleanup job runs daily

### 3. **Database Indexes**
Added indexes for efficient cleanup queries:
- `idx_student_refresh_tokens_expires_at` - For finding expired tokens
- `idx_student_refresh_tokens_revoked_at` - For finding old revoked tokens
- `idx_student_refresh_tokens_student_expires` - For per-user cleanup
- `idx_student_refresh_tokens_student_created` - For token limiting
- Same indexes for trainer tokens

### 4. **Scheduled Cleanup Jobs**
- **Student Auth Service**: Daily cleanup job
- **Trainer Auth Service**: Daily cleanup job
- Configurable via environment variables
- Runs on service startup and then on schedule

### 5. **One-Time Cleanup Script**
Manual cleanup script for existing tokens:
```bash
node scripts/cleanup-refresh-tokens.js [--days-to-keep-revoked=7] [--confirm] [--dry-run]
```

## Files Modified

### Student Auth Service
- `src/models/student.model.ts` - Added cleanup functions and token limiting
- `src/config/database.ts` - Added database indexes
- `src/jobs/refreshTokenCleanup.ts` - New cleanup job
- `src/index.ts` - Schedule cleanup job on startup

### Trainer Auth Service
- `src/models/trainerAuth.model.ts` - Added cleanup functions and token limiting
- `src/config/database.ts` - Added database indexes
- `src/jobs/refreshTokenCleanup.ts` - New cleanup job
- `src/index.ts` - Schedule cleanup job on startup

### Scripts
- `scripts/cleanup-refresh-tokens.js` - One-time cleanup script

## Environment Variables

```env
# Enable/disable cleanup job (default: true)
ENABLE_REFRESH_TOKEN_CLEANUP=true

# Cleanup interval in hours (default: 24)
REFRESH_TOKEN_CLEANUP_INTERVAL_HOURS=24

# Days to keep revoked tokens for audit (default: 7)
REFRESH_TOKEN_CLEANUP_DAYS_TO_KEEP_REVOKED=7
```

## How It Works

### On Token Storage
1. **Cleanup old tokens** (non-blocking): Deletes expired/revoked tokens for the user
2. **Limit active tokens** (non-blocking): Keeps only the 10 most recent active tokens
3. **Store new token**: Inserts the new refresh token

### Scheduled Cleanup
1. Runs daily (configurable interval)
2. Deletes all expired tokens (expired > 1 day ago)
3. Deletes revoked tokens older than retention period
4. Logs cleanup statistics

## Usage

### Run One-Time Cleanup
```bash
# Dry run (see what would be deleted)
node scripts/cleanup-refresh-tokens.js --dry-run

# Actual cleanup
node scripts/cleanup-refresh-tokens.js --confirm

# Custom retention period
node scripts/cleanup-refresh-tokens.js --days-to-keep-revoked=14 --confirm
```

### Monitor Cleanup
Check service logs for cleanup statistics:
```
Refresh token cleanup completed { totalDeleted: 1234, daysToKeepRevoked: 7 }
```

## Impact

### Before
- 1 user = 1,109 tokens
- 100K users = ~110.9 million tokens
- No cleanup = unbounded growth

### After
- 1 user = Max 10 active tokens
- Automatic cleanup of expired/revoked tokens
- Bounded growth per user
- Daily cleanup prevents accumulation

## Benefits

1. **Prevents Database Bloat**: Tokens are automatically cleaned up
2. **Better Performance**: Fewer rows = faster queries
3. **Scalability**: System can handle millions of users
4. **Security**: Old revoked tokens are removed after audit period
5. **Cost Efficiency**: Reduced storage requirements

## Testing

1. **Test token limiting**: Login multiple times and verify only 10 tokens remain
2. **Test cleanup**: Wait for tokens to expire and verify cleanup job runs
3. **Test script**: Run cleanup script with `--dry-run` to verify it works

## Notes

- Cleanup operations are **non-blocking** during token storage
- Cleanup failures are **silently caught** to not affect user experience
- Revoked tokens are kept for **7 days** by default for audit purposes
- The system is **backward compatible** - existing tokens will be cleaned up automatically

