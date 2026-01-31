# Coin Configuration System Implementation

## Overview
This document describes the implementation of a database-driven coin configuration system that allows admins to manage coin rewards and values through API endpoints instead of environment variables.

## Changes Made

### 1. Database Table
- **Table**: `coin_configuration`
- **Location**: `kc-backend/services/payment-service/src/config/database.ts`
- **Default Values**:
  - `registration`: 10 coins
  - `course_completion`: 100 coins
  - `referral`: 50 coins
  - `coin_to_rupee_rate`: 1 (1 coin = ₹1 discount)

### 2. Model Functions
- **Location**: `kc-backend/services/payment-service/src/models/payment.model.ts`
- **Functions**:
  - `getCoinConfiguration(key)`: Get a specific coin configuration
  - `getAllCoinConfiguration()`: Get all coin configurations
  - `updateCoinConfiguration(key, value, updatedBy)`: Update a coin configuration

### 3. Service Updates
- **Location**: `kc-backend/services/payment-service/src/services/payment.service.ts`
- **Changes**:
  - Added async functions to read coin values from database (with env var fallback)
  - Implemented caching (1-minute TTL) for performance
  - Priority: Database > Environment Variable > Fallback
  - Updated `awardCoinsForCourseCompletion()` to use database config
  - Updated `awardCoinsForReferral()` to use database config
  - Updated `createSessionBookingPayment()` to use database config for coin-to-rupee rate

### 4. Student Auth Service Updates
- **Location**: `kc-backend/services/student-auth-service/src/services/studentAuth.service.ts`
- **Changes**:
  - Updated `awardRegistrationCoins()` to fetch registration coins from payment service
  - Registration coins now read from database (default: 10 coins)
  - Falls back to env var or default 10 if payment service unavailable

### 5. API Endpoints
- **Location**: `kc-backend/services/payment-service/src/routes/payment.routes.ts`
- **Endpoints**:
  - `GET /api/v1/payments/coins/configuration`: Get all coin configurations
  - `PUT /api/v1/payments/coins/configuration`: Update a coin configuration

#### Get Coin Configuration
```http
GET /api/v1/payments/coins/configuration
```

**Response**:
```json
{
  "success": true,
  "message": "Coin configuration retrieved",
  "data": [
    {
      "id": "uuid",
      "key": "registration",
      "value": 10,
      "description": "Coins awarded for new user registration",
      "updatedBy": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "key": "course_completion",
      "value": 100,
      "description": "Coins awarded for completing a course",
      "updatedBy": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "key": "referral",
      "value": 50,
      "description": "Coins awarded for referring a new student",
      "updatedBy": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    },
    {
      "id": "uuid",
      "key": "coin_to_rupee_rate",
      "value": 1,
      "description": "Conversion rate: 1 coin = X rupees discount",
      "updatedBy": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### Update Coin Configuration
```http
PUT /api/v1/payments/coins/configuration
Content-Type: application/json

{
  "key": "registration",
  "value": 10
}
```

**Response**:
```json
{
  "success": true,
  "message": "Coin configuration updated",
  "data": {
    "id": "uuid",
    "key": "registration",
    "value": 10,
    "description": "Coins awarded for new user registration",
    "updatedBy": "admin-uuid",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

## Configuration Priority

The system uses the following priority order:

1. **Database Configuration** (highest priority)
   - Values stored in `coin_configuration` table
   - Can be updated via API endpoints
   - Cached for 1 minute for performance

2. **Environment Variables** (fallback)
   - `COIN_REWARD_REGISTRATION`
   - `COIN_REWARD_COURSE_COMPLETION`
   - `COIN_REWARD_REFERRAL`
   - `COIN_TO_RUPEE_RATE`

3. **Hardcoded Fallbacks** (lowest priority)
   - Registration: 10 coins
   - Course Completion: 100 coins
   - Referral: 50 coins
   - Coin to Rupee Rate: 1

## Registration Coins Fix

### Issue
New user registrations were not receiving 10 coins as expected.

### Solution
1. Updated `awardRegistrationCoins()` to fetch coin value from payment service
2. Payment service reads from database (default: 10 coins)
3. Coins are awarded when email is verified (in `verifyEmailOtpForStudent()`)
4. Also awarded for phone OTP and Google sign-in registrations

### Registration Flow
1. User registers with email/phone/Google
2. User verifies email/phone
3. `awardRegistrationCoins()` is called
4. Function fetches registration coin value from payment service
5. Payment service returns value from database (or env/fallback)
6. Coins are awarded via `/api/v1/payments/coins/adjust` endpoint

## Course Completion Coins

Course completion coins are automatically awarded when a course is completed. The coin value is read from the database configuration.

## Testing

### Test Registration Coins
1. Register a new user
2. Verify email/phone
3. Check wallet balance via `GET /api/v1/payments/wallet/:studentId`
4. Should show 10 coins (or configured value)

### Test Coin Configuration Update
1. Update registration coins: `PUT /api/v1/payments/coins/configuration` with `{"key": "registration", "value": 20}`
2. Register a new user
3. Verify email/phone
4. Check wallet - should show 20 coins

### Test Course Completion Coins
1. Complete a course
2. Check wallet balance
3. Should show course completion coins (default: 100)

## Migration Notes

- The `coin_configuration` table is automatically created on service startup
- Default values are inserted if they don't exist
- Existing environment variables continue to work as fallback
- No breaking changes to existing functionality

## Admin UI Integration

To integrate with admin UI:

1. **Get Configuration**: Call `GET /api/v1/payments/coins/configuration` to display current values
2. **Update Configuration**: Call `PUT /api/v1/payments/coins/configuration` with `{key, value}` to update
3. **Form Fields**:
   - Registration Coins (integer, >= 0)
   - Course Completion Coins (integer, >= 0)
   - Referral Coins (integer, >= 0)
   - Coin to Rupee Rate (number, >= 0)

## Notes

- Coin configuration is cached for 1 minute to reduce database queries
- Cache is invalidated when configuration is updated
- All coin values must be non-negative integers
- Coin-to-rupee rate can be a decimal (e.g., 0.5 for ₹0.50 per coin)
