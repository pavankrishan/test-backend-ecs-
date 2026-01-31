# Kafka Connection Fix - Applied

## Problem
Kafka container is running and healthy, but services cannot connect:
- Error: `ECONNREFUSED ::1:9092` (IPv6 localhost)
- Payment service trying to connect to `localhost:9092` instead of `kafka:9092`
- Events not being emitted/consumed

## Root Cause
**Payment service missing `KAFKA_BROKERS` environment variable in docker-compose.yml**

### What Was Happening:
1. ✅ Kafka container is running (`kodingcaravan-kafka`)
2. ✅ Kafka is healthy and accessible
3. ❌ Payment service reads `KAFKA_BROKERS=localhost:9092` from `.env` file
4. ❌ Inside Docker containers, `localhost` refers to the container itself, not Kafka
5. ❌ Connection fails: `ECONNREFUSED ::1:9092`

### Why `localhost:9092` Doesn't Work:
- Inside Docker containers, `localhost` = the container itself
- Kafka is a separate container named `kafka`
- Services must use Docker service name: `kafka:9092`

## Solution Applied

**File**: `kc-backend/docker-compose.yml`
- **Line 288**: Added `KAFKA_BROKERS: kafka:9092` to payment-service environment
- **Line 289-291**: Added `depends_on` to ensure Kafka is healthy before starting

## Services with Correct Configuration

These services already have `KAFKA_BROKERS: kafka:9092`:
- ✅ student-service (line 159)
- ✅ notification-service (line 267)
- ✅ payment-service (line 288) - **FIXED**
- ✅ purchase-worker (line 376)
- ✅ allocation-worker (line 397)
- ✅ cache-worker (line 423)
- ✅ session-worker (line 444)

## How to Apply Fix

1. **Restart payment-service**:
   ```bash
   docker-compose restart payment-service
   ```

2. **Verify connection**:
   ```bash
   docker logs kodingcaravan-payment-service | grep -i kafka
   ```

3. **Test event emission**:
   - Make a payment
   - Check logs for successful event emission
   - Verify purchase-worker receives events

## Expected Behavior After Fix

1. ✅ Payment service connects to Kafka successfully
2. ✅ `PURCHASE_CONFIRMED` events are emitted
3. ✅ purchase-worker consumes events
4. ✅ Purchases are created automatically
5. ✅ No more `ECONNREFUSED` errors

## Verification

After restarting payment-service, check logs:
```bash
# Should see successful Kafka connection
docker logs kodingcaravan-payment-service --tail 20 | grep -i kafka

# Should see events being emitted
docker logs kodingcaravan-payment-service | grep "PURCHASE_CONFIRMED event emitted"
```

## Note

The `.env` file may have `KAFKA_BROKERS=localhost:9092` for local development (outside Docker), but docker-compose.yml environment variables override it, ensuring services use `kafka:9092` inside Docker.



