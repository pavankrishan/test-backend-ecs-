# Booking Service Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd kc-backend/services/booking-service
pnpm install
```

### 2. Environment Variables

Create a `.env` file or set environment variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/kodingcaravan

# Service Port
PORT=3011

# External Services
TRAINER_SERVICE_URL=http://localhost:3003
COURSE_SERVICE_URL=http://localhost:3004
STUDENT_SERVICE_URL=http://localhost:3005

# Optional: Geocoding API (for city detection)
GOOGLE_MAPS_API_KEY=your-api-key-here
# OR
MAPBOX_ACCESS_TOKEN=your-token-here
```

### 3. Database Setup

The service will automatically create all required tables on first run. Ensure PostgreSQL is running and accessible.

Tables created:
- `cities`
- `clusters`
- `session_bookings`
- `pre_bookings`
- `schedule_slots`
- `attendance_records`

### 4. Build and Run

```bash
# Development mode (with hot reload)
pnpm dev

# Production build
pnpm build
pnpm start
```

### 5. Verify Installation

```bash
# Health check
curl http://localhost:3011/healthz

# Expected response:
# {"status":"ok","service":"booking"}
```

## Seed Data (Optional)

### Create Ongole City

```bash
# Using psql or any PostgreSQL client
INSERT INTO cities (name, state, country, is_active, franchise_id)
VALUES ('Ongole', 'Andhra Pradesh', 'India', true, NULL)
RETURNING id;
```

### Create Clusters for Ongole

```sql
-- Replace 'city-uuid' with the actual city ID from above
INSERT INTO clusters (city_id, name, center_latitude, center_longitude, radius_km)
VALUES
  ('city-uuid', 'Ongole-Center', 15.5057, 80.0499, 2.5),
  ('city-uuid', 'Ongole-North', 15.5250, 80.0500, 2.5),
  ('city-uuid', 'Ongole-South', 15.4850, 80.0500, 2.5),
  ('city-uuid', 'Ongole-East', 15.5057, 80.0700, 2.5),
  ('city-uuid', 'Ongole-West', 15.5057, 80.0300, 2.5);
```

## Integration Setup

### Trainer Service Integration

1. Update `src/utils/trainerIntegration.ts`
2. Replace placeholder functions with actual API calls
3. Ensure trainer-service exposes:
   - `GET /api/v1/trainers/available` - Get available trainers
   - `GET /api/v1/trainers` - Get all trainers with load info

### Geocoding Service Integration

1. Choose a provider (Google Maps, Mapbox, etc.)
2. Update `src/services/serviceArea.service.ts`
3. Implement `detectCity()` method with reverse geocoding

Example with Google Maps:
```typescript
import axios from 'axios';

private async detectCity(lat: number, lng: number) {
  const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
    params: {
      latlng: `${lat},${lng}`,
      key: process.env.GOOGLE_MAPS_API_KEY
    }
  });
  
  // Parse response to extract city name
  // Query database for city
}
```

## Testing

### Test Service Availability

```bash
curl -X POST http://localhost:3011/api/v1/booking/check-service-availability \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 15.5057,
    "lng": 80.0499,
    "course": "course-uuid",
    "timeslot": "09:00"
  }'
```

### Test Pre-Booking Creation

```bash
curl -X POST http://localhost:3011/api/v1/booking/create-prebooking \
  -H "Content-Type: application/json" \
  -d '{
    "address": "123 Main St, Ongole",
    "lat": 15.5057,
    "lng": 80.0499,
    "course": "course-uuid",
    "timeslot": "09:00",
    "mode": "1on1",
    "groupSize": 1,
    "sessionCount": 20
  }'
```

## Troubleshooting

### Database Connection Issues

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check if tables exist
psql $DATABASE_URL -c "\dt"
```

### Port Already in Use

```bash
# Change PORT in .env or use different port
PORT=3012 pnpm start
```

### Missing Dependencies

```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install
```

## Production Deployment

1. **Environment Variables**: Set all required env vars in production
2. **Database**: Use production PostgreSQL with proper backups
3. **Monitoring**: Set up health checks and monitoring
4. **Logging**: Configure structured logging
5. **Rate Limiting**: Add rate limiting middleware
6. **Authentication**: Add authentication middleware
7. **Caching**: Set up Redis for city/cluster data caching

## Next Steps

1. ✅ Install dependencies
2. ✅ Set environment variables
3. ✅ Initialize database
4. ⏳ Integrate with trainer-service
5. ⏳ Integrate with geocoding service
6. ⏳ Add authentication
7. ⏳ Add validation middleware
8. ⏳ Set up monitoring

