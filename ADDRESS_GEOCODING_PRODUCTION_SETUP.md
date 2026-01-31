# Address Geocoding Production Setup

This document outlines the production-level address geocoding implementation that automatically converts student addresses to GPS coordinates for session creation.

## Overview

The geocoding system ensures that students with addresses like "4-82, near ramalayam, Etukuru, guntur" get proper latitude/longitude coordinates required for home tutoring session creation.

## Features

- ✅ **Automatic geocoding** on profile updates
- ✅ **Multiple geocoding providers** (Google Maps, OpenStreetMap, fallback)
- ✅ **Production-grade error handling** with graceful degradation
- ✅ **Batch processing** for existing profiles
- ✅ **Confidence scoring** for geocoding accuracy
- ✅ **Rate limiting protection** and retry logic

## Architecture

### Core Components

1. **GeocodingService** (`shared/src/services/geocoding.service.ts`)
   - Handles address to coordinate conversion
   - Supports multiple geocoding providers
   - Provides fallback mechanisms

2. **Student Profile Integration** (`student-service`)
   - Automatically geocodes addresses during profile updates
   - Batch processing for existing profiles

3. **Admin API Endpoint** (`POST /students/admin/geocode-profiles`)
   - Triggers batch geocoding of existing profiles

## Setup Instructions

### 1. Environment Variables

Add to your `.env` file:

```bash
# Google Maps API (for geocoding addresses to coordinates)
GOOGLE_MAPS_API_KEY=your-google-maps-api-key-here
```

### 2. Get Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the "Geocoding API"
4. Create credentials (API Key)
5. Optionally restrict the API key to your domain/IP

**Note:** If you don't have a Google Maps API key, the system will use OpenStreetMap as fallback, and then hardcoded coordinates as last resort.

### 3. Database Schema

The system uses existing `student_profiles` table columns:
- `address` (string) - Student address
- `latitude` (number) - GPS latitude
- `longitude` (number) - GPS longitude

### 4. Deploy and Test

```bash
# Build and deploy services
pnpm build
pnpm deploy

# Test geocoding with a sample address
curl -X POST http://your-api/students/admin/geocode-profiles
```

## Geocoding Providers

### 1. Google Maps API (Primary)
- **Accuracy:** Highest
- **Cost:** Paid (but has free tier)
- **Requirements:** API key required
- **Rate limits:** 40,000 requests/day free tier

### 2. OpenStreetMap Nominatim (Fallback)
- **Accuracy:** Good
- **Cost:** Free
- **Requirements:** None
- **Rate limits:** 1 request/second per IP

### 3. Hardcoded Fallback (Last Resort)
- **Accuracy:** Basic (city-level)
- **Cost:** Free
- **Requirements:** None
- **Coverage:** Major Indian cities

## API Usage

### Automatic Geocoding

When students update their profiles with addresses, geocoding happens automatically:

```typescript
// This will automatically geocode the address
await studentService.upsertProfile(studentId, {
  address: "4-82, near ramalayam, Etukuru, guntur"
});
```

### Batch Geocoding Existing Profiles

To geocode all existing profiles without coordinates:

```bash
# Via API (requires admin authentication)
curl -X POST http://your-api/students/admin/geocode-profiles

# Via script (direct database access)
node scripts/geocode-student-profiles.js
```

## Monitoring and Maintenance

### Logs to Monitor

```
[Student Service] Geocoding address for student xxx: "4-82, near ramalayam, Etukuru,guntur"
[Student Service] ✅ Successfully geocoded address for student xxx: 16.3067, 80.4365
[Geocoding] Using fallback coordinates for guntur: 16.3067, 80.4365
```

### Performance Considerations

- **Rate Limiting:** 200ms delay between API calls
- **Batch Processing:** 50 profiles per batch
- **Timeouts:** 8-10 second timeout per request
- **Caching:** Consider adding Redis caching for repeated addresses

### Troubleshooting

#### Common Issues

1. **"Google Maps API key not configured"**
   - Add `GOOGLE_MAPS_API_KEY` to environment variables

2. **"Student does not have valid GPS coordinates"**
   - Run batch geocoding script
   - Check student profile has address field

3. **Geocoding timeout errors**
   - Check internet connectivity
   - Verify API keys are valid
   - Consider increasing timeout values

#### Manual Geocoding

If automatic geocoding fails, you can manually update coordinates:

```sql
UPDATE student_profiles
SET latitude = 16.3067, longitude = 80.4365
WHERE student_id = 'your-student-id';
```

## Production Deployment Checklist

- [ ] Google Maps API key configured
- [ ] Environment variables updated
- [ ] Services rebuilt and deployed
- [ ] Batch geocoding script run for existing profiles
- [ ] Monitor logs for geocoding errors
- [ ] Test session creation with geocoded addresses

## Cost Estimation

### Google Maps API
- Free tier: 40,000 requests/month
- Paid: $0.005 per request after free tier
- For 1,000 students: ~$5/month

### OpenStreetMap
- Free (no API key required)
- Rate limited to 1 request/second

## Future Enhancements

- Redis caching for geocoded addresses
- Bulk geocoding API for better performance
- Address validation before geocoding
- Confidence threshold configuration
- Geocoding analytics dashboard
