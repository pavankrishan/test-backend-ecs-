# Google OAuth Authentication Architecture

## Overview

This document describes the dual Google authentication system designed for smooth migration from native mobile sign-in to web OAuth.

## Core Principles

1. **Backend Owns Identity**: Email is the primary identifier, not Google UID
2. **Provider vs Identity**: Google is an authentication provider, not the identity source
3. **Unified JWT**: Same JWT format for all auth methods (native, web, email, phone)
4. **Migration Ready**: `auth_provider` field tracks authentication method for transition

## Architecture

### Database Schema

```sql
-- Added to students and trainers tables
auth_provider VARCHAR(50) NULL
  - 'google_native' (temporary - mobile app)
  - 'google_web' (final - browser OAuth)
  - 'email' (email/password)
  - 'phone' (phone OTP)
  - NULL (legacy)
```

### Authentication Endpoints

#### 1. `/auth/google/native` (TEMPORARY)
- **Purpose**: Accept verified user info from mobile app
- **Input**: `{ email, name?, provider: 'google' }`
- **Security**: Backend trusts mobile app's Google verification
- **Use Case**: Current mobile apps using native Google Sign-In
- **Status**: Temporary - will be deprecated

**Flow:**
```
Mobile App → Google Sign-In → Get user info → Backend
Backend → Find/Create by email → Issue JWT
```

#### 2. `/auth/google/web` (FINAL)
- **Purpose**: Server-side OAuth code exchange
- **Input**: `{ code, redirectUri, codeVerifier? }`
- **Security**: Backend verifies with Google server-side
- **Use Case**: Browser-based OAuth (production)
- **Status**: Production-ready

**Flow:**
```
Browser → Google OAuth → Authorization code → Backend
Backend → Exchange code for ID token → Verify with Google → Find/Create by email → Issue JWT
```

#### 3. `/auth/google` (LEGACY)
- **Purpose**: Backward compatibility
- **Input**: `{ idToken }`
- **Status**: Deprecated - use native or web endpoints

## Implementation Details

### User Identity Model

```typescript
// Primary identifier: EMAIL (not Google UID)
const email = payload.email.toLowerCase();

// Find or create by email
let user = await findUserByEmail(email);

if (!user) {
  user = await createUser({
    email,
    username: email.split('@')[0],
    googleId: payload.sub, // Reference only
    authProvider: 'google_web' // or 'google_native'
  });
}
```

### Token Flow

1. **Authentication**: User authenticates with Google (native or web)
2. **Backend Verification**: Backend verifies/accepts Google credentials
3. **User Resolution**: Find or create user by **email** (primary key)
4. **JWT Issuance**: Backend issues own JWT tokens
5. **Session Management**: Redis session tracking

### Key Functions

#### `authenticateWithGoogleNative()`
- Accepts user info from mobile
- No Google token verification
- Sets `auth_provider = 'google_native'`

#### `authenticateWithGoogleWeb()`
- Exchanges OAuth code for ID token
- Verifies ID token with Google
- Sets `auth_provider = 'google_web'`

#### `exchangeCodeForIdToken()`
- Server-side OAuth code exchange
- Requires `GOOGLE_CLIENT_SECRET`
- Returns verified ID token

## Migration Strategy

### Phase 1: Current (Native)
- Mobile apps use `/auth/google/native`
- Backend accepts verified user info
- `auth_provider = 'google_native'`

### Phase 2: Transition (Dual Support)
- New mobile apps use `/auth/google/web`
- Existing apps continue with `/auth/google/native`
- Both create same user records (by email)

### Phase 3: Final (Web Only)
- All apps use `/auth/google/web`
- `/auth/google/native` deprecated
- Users can migrate seamlessly (same email)

## Security Considerations

1. **Native Endpoint**: Trusts mobile app - acceptable for temporary solution
2. **Web Endpoint**: Full server-side verification - production-ready
3. **No Token Storage**: Backend never stores Google access/refresh tokens
4. **JWT Ownership**: All sessions use backend-issued JWTs
5. **Email Verification**: Google email is auto-verified

## Database Migration

Run migration: `007-add-auth-provider.sql`

```sql
-- Adds auth_provider column
-- Creates indexes
-- Updates existing Google users to 'google_native'
```

## API Examples

### Native Auth (Mobile)
```bash
POST /api/student-auth/google/native
{
  "email": "user@example.com",
  "name": "John Doe",
  "provider": "google"
}
```

### Web OAuth (Browser)
```bash
POST /api/student-auth/google/web
{
  "code": "4/0AeanS...",
  "redirectUri": "com.googleusercontent.apps.407775598356:/oauth2redirect/google",
  "codeVerifier": "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
}
```

## Files Modified

### Student Auth Service
- `src/integrations/googleAuth.ts` - Added `exchangeCodeForIdToken()`
- `src/services/studentAuth.service.ts` - Added native/web auth functions
- `src/models/student.model.ts` - Added `authProvider` field
- `src/schemas/authSchema.ts` - Added native/web schemas
- `src/routes/studentAuth.routes.ts` - Added new endpoints
- `src/controllers/studentAuth.controller.ts` - Added controllers

### Trainer Auth Service
- Same changes as student service (apply separately)

## Next Steps

1. ✅ Run database migration
2. ✅ Update student auth service
3. ⏳ Update trainer auth service (same pattern)
4. ⏳ Update mobile apps to use `/google/web`
5. ⏳ Test migration path
6. ⏳ Deprecate `/google/native` after migration

## Notes

- Email is the **source of truth** for user identity
- Google UID is stored for reference only
- Same user can authenticate via native or web (same email)
- JWT format is identical regardless of auth method
- No breaking changes - legacy endpoint still works

