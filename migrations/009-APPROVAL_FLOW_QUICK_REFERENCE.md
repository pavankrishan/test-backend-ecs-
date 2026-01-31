# Trainer Approval Flow - Quick Reference

## Overview

This document provides a quick reference for implementing the transactional trainer approval flow with geocoding.

---

## Flow Diagram

```
Application Submitted
    ↓
Admin Reviews Application
    ↓
Admin Approves Trainer
    ↓
BEGIN TRANSACTION
    ↓
1. Get application data (address_text, pincode, city_id, zone_id)
    ↓
2. Resolve pincode → city_id (if not set)
    ↓
3. Create trainer_addresses record
    ↓
4. Geocode address → lat/long
    ↓
5. Create trainer_base_locations record
    ↓
6. Update trainer_applications (review_status = 'APPROVED')
    ↓
7. Update trainers (approval_status = 'approved', service_status = 'ACTIVE')
    ↓
COMMIT TRANSACTION
    ↓
Send Notification to Trainer
```

---

## TypeScript Service Function

```typescript
import { Pool } from 'pg';
import { geocodeAddress } from '../services/geocoding.service';

export async function approveTrainerWithGeocoding(
    trainerId: string,
    adminId: string,
    pool: Pool
): Promise<void> {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. Get application data
        const appResult = await client.query(
            `SELECT id, trainer_id, address_text, pincode, city_id, zone_id
             FROM trainer_applications
             WHERE trainer_id = $1 AND review_status = 'PENDING'`,
            [trainerId]
        );
        
        if (appResult.rows.length === 0) {
            throw new Error('Application not found or already reviewed');
        }
        
        const app = appResult.rows[0];
        
        // 2. Resolve pincode to city if needed
        let cityId = app.city_id;
        let state: string | null = null;
        
        if (!cityId && app.pincode) {
            const pincodeResult = await client.query(
                `SELECT city_id, state FROM pincodes WHERE pincode = $1`,
                [app.pincode]
            );
            if (pincodeResult.rows.length > 0) {
                cityId = pincodeResult.rows[0].city_id;
                state = pincodeResult.rows[0].state;
            }
        }
        
        if (cityId && !state) {
            const cityResult = await client.query(
                `SELECT state FROM cities WHERE id = $1`,
                [cityId]
            );
            if (cityResult.rows.length > 0) {
                state = cityResult.rows[0].state;
            }
        }
        
        // 3. Create trainer_addresses
        const addressResult = await client.query(
            `INSERT INTO trainer_addresses (
                trainer_id, address_text, pincode, city_id, state, country,
                is_verified, verified_by, verified_at, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), true)
            RETURNING id`,
            [trainerId, app.address_text, app.pincode, cityId, state, 'India', false, adminId]
        );
        const addressId = addressResult.rows[0].id;
        
        // 4. Geocode address
        const geocodeQuery = `${app.address_text}${app.pincode ? ` ${app.pincode}` : ''}, India`;
        const geocodeResult = await geocodeAddress(geocodeQuery);
        
        // 5. Create trainer_base_locations
        await client.query(
            `INSERT INTO trainer_base_locations (
                trainer_id, latitude, longitude, source, confidence_score,
                geocoded_by, address_id, geocoded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [
                trainerId,
                geocodeResult.latitude,
                geocodeResult.longitude,
                'geocoded',
                geocodeResult.confidence || 0.8,
                'google',
                addressId
            ]
        );
        
        // 6. Update trainer_applications
        await client.query(
            `UPDATE trainer_applications
             SET review_status = 'APPROVED',
                 reviewed_by = $1,
                 reviewed_at = NOW(),
                 city_id = $2,
                 zone_id = $3,
                 application_stage = 'approved',
                 updated_at = NOW()
             WHERE id = $4`,
            [adminId, cityId, app.zone_id, app.id]
        );
        
        // 7. Update trainers
        await client.query(
            `UPDATE trainers
             SET approval_status = 'approved',
                 service_status = 'ACTIVE',
                 city_id = $1,
                 zone_id = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [cityId, app.zone_id, trainerId]
        );
        
        await client.query('COMMIT');
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
```

---

## Geocoding Service Interface

```typescript
interface GeocodeResult {
    latitude: number;
    longitude: number;
    confidence?: number;
    source?: string;
    formattedAddress?: string;
}

async function geocodeAddress(address: string): Promise<GeocodeResult> {
    // Implementation using Google Maps, Mapbox, OSM, etc.
    // Example with Google Maps:
    const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`
    );
    const data = await response.json();
    
    if (data.status !== 'OK' || !data.results[0]) {
        throw new Error('Geocoding failed');
    }
    
    const location = data.results[0].geometry.location;
    
    return {
        latitude: location.lat,
        longitude: location.lng,
        confidence: calculateConfidence(data.results[0]),
        source: 'google',
        formattedAddress: data.results[0].formatted_address
    };
}
```

---

## Error Handling

```typescript
try {
    await approveTrainerWithGeocoding(trainerId, adminId, pool);
} catch (error) {
    if (error.message === 'Application not found or already reviewed') {
        // Handle: Application doesn't exist or already processed
    } else if (error.message.includes('Geocoding failed')) {
        // Handle: Geocoding service failure
        // Options:
        // 1. Retry with different service
        // 2. Use manual coordinates
        // 3. Mark for manual review
    } else {
        // Handle: Database or other errors
        // Transaction will rollback automatically
    }
}
```

---

## Testing Checklist

- [ ] Test approval with valid address and pincode
- [ ] Test approval with missing pincode
- [ ] Test approval with invalid pincode (not in pincodes table)
- [ ] Test approval with geocoding failure (retry logic)
- [ ] Test approval with database error (rollback)
- [ ] Test approval with duplicate approval (idempotency)
- [ ] Test approval with missing application
- [ ] Verify all records created correctly
- [ ] Verify transaction rollback on failure
- [ ] Verify notification sent after approval

---

## Integration Points

### Update Existing Approval Service

```typescript
// In: kc-backend/services/admin-service/src/services/trainerApproval.service.ts

async approveTrainer(trainerId: string, adminId: string): Promise<any> {
    // Replace existing approval logic with:
    await approveTrainerWithGeocoding(trainerId, adminId, this.pool);
    
    // Rest of existing code (notifications, etc.)
    // ...
}
```

### API Endpoint

```typescript
// POST /api/v1/admin/trainers/:trainerId/approve
router.post('/trainers/:trainerId/approve', async (req, res) => {
    const { trainerId } = req.params;
    const adminId = req.user.id; // From auth middleware
    
    try {
        await approveTrainerWithGeocoding(trainerId, adminId, pool);
        res.json({ success: true, message: 'Trainer approved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
```

---

## Key Points

1. **Always use transactions** - All steps must succeed or rollback
2. **Geocode AFTER approval** - Never geocode during application
3. **Store address separately** - Never replace address_text with coordinates
4. **Handle failures gracefully** - Retry geocoding, manual review fallback
5. **Maintain audit trail** - Track who approved, when, and geocoding source

---

## Support

For detailed implementation, see:
- `009-LOCATION_MODEL_GUIDE.md` - Full implementation guide
- `009-enterprise-location-model.sql` - Database schema
- `009-IMPLEMENTATION_SUMMARY.md` - Complete summary

