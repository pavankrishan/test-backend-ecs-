# Enterprise Location Model - Implementation Guide

## Overview

This document provides implementation guidance for the enterprise-grade location model migration (`009-enterprise-location-model.sql`). The model separates identity location (KYC) from operational GPS, uses pincode for auto-fill, and geocodes addresses only after trainer approval.

---

## Table Architecture

### 1. `cities` (Enhanced)
**Purpose:** Geography master table for standardized city data  
**Why:** Eliminates free-text city storage, enables service area operations  
**Key Fields:** `id`, `name`, `state`, `country`, `is_active`

### 2. `pincodes`
**Purpose:** Pincode resolver for auto-fill functionality  
**Why:** Enables pincode → city auto-fill during application  
**Key Fields:** `pincode` (PK), `city_id` (FK), `state`, `country`

### 3. `trainer_addresses`
**Purpose:** Trainer identity address (KYC/profile location)  
**Why:** Stores legal address for KYC compliance, separate from operational GPS  
**Key Fields:** `id`, `trainer_id`, `address_text`, `pincode`, `city_id`, `is_verified`, `is_primary`

### 4. `trainer_base_locations`
**Purpose:** Trainer base operational location (AFTER APPROVAL ONLY)  
**Why:** Derived geocoded anchor for operational use, separate from identity address  
**Key Fields:** `id`, `trainer_id`, `latitude`, `longitude`, `source`, `confidence_score`, `address_id`

---

## Example Queries

### 1. Pincode → City Lookup (Auto-fill)

```sql
-- Resolve pincode to city for auto-fill during application
SELECT 
    p.pincode,
    c.id AS city_id,
    c.name AS city_name,
    c.state,
    c.country,
FROM pincodes p
INNER JOIN cities c ON p.city_id = c.id
WHERE p.pincode = $1  -- e.g., '110001'
AND c.is_active = true;
```

**Usage in Application:**
```typescript
// Frontend: User enters pincode
const pincode = '110001';

// Backend: Resolve to city
const result = await pool.query(
    `SELECT p.pincode, c.id AS city_id, c.name AS city_name, c.state, c.country
     FROM pincodes p
     INNER JOIN cities c ON p.city_id = c.id
     WHERE p.pincode = $1 AND c.is_active = true`,
    [pincode]
);

// Auto-fill city, state in UI
if (result.rows.length > 0) {
    const city = result.rows[0];
    // Pre-fill: city_name, state, country
}
```

### 2. Get Trainer Address with City

```sql
-- Get trainer's primary address with resolved city
SELECT 
    ta.id,
    ta.address_text,
    ta.pincode,
    ta.state,
    ta.country,
    ta.is_verified,
    c.id AS city_id,
    c.name AS city_name,
FROM trainer_addresses ta
LEFT JOIN cities c ON ta.city_id = c.id
WHERE ta.trainer_id = $1
AND ta.is_primary = true;
```

### 3. Get Trainer Base Location (Operational)

```sql
-- Get trainer's base operational location
SELECT 
    tbl.id,
    tbl.latitude,
    tbl.longitude,
    tbl.source,
    tbl.confidence_score,
    tbl.geocoded_at,
    ta.address_text,
    ta.pincode
FROM trainer_base_locations tbl
LEFT JOIN trainer_addresses ta ON tbl.address_id = ta.id
WHERE tbl.trainer_id = $1;
```

### 4. Find Trainers Near Location (Distance Query)

```sql
-- Find trainers within X km of a location
-- Note: For production, use PostGIS for accurate distance calculations
-- This is an approximate query using Haversine formula

WITH target_location AS (
    SELECT $1::NUMERIC AS lat, $2::NUMERIC AS lng, $3::NUMERIC AS radius_km
)
SELECT 
    t.id AS trainer_id,
    tbl.latitude,
    tbl.longitude,
    -- Approximate distance (km) - use PostGIS ST_Distance for production
    (
        6371 * acos(
            cos(radians(tl.lat)) * 
            cos(radians(tbl.latitude)) * 
            cos(radians(tbl.longitude) - radians(tl.lng)) + 
            sin(radians(tl.lat)) * 
            sin(radians(tbl.latitude))
        )
    ) AS distance_km
FROM trainer_base_locations tbl
CROSS JOIN target_location tl
INNER JOIN trainers t ON tbl.trainer_id = t.id
WHERE t.service_status = 'ACTIVE'
HAVING distance_km <= tl.radius_km
ORDER BY distance_km ASC
LIMIT 50;
```

---

## Approval-Time Geocoding Flow

### Pseudocode

```typescript
/**
 * Geocode trainer address AFTER approval
 * This function is called during trainer approval transaction
 */
async function geocodeTrainerAddressOnApproval(
    trainerId: string,
    addressId: string,
    addressText: string,
    pincode: string,
    cityId: string | null
): Promise<{
    latitude: number;
    longitude: number;
    confidenceScore: number;
    source: string;
}> {
    // 1. Build geocoding query string
    let geocodeQuery = addressText;
    
    // 2. Add city name if available
    if (cityId) {
        const cityResult = await pool.query(
            'SELECT name, state FROM cities WHERE id = $1',
            [cityId]
        );
        if (cityResult.rows.length > 0) {
            const city = cityResult.rows[0];
            geocodeQuery += `, ${city.name}, ${city.state}, India`;
        }
    }
    
    // 3. Add pincode if available
    if (pincode) {
        geocodeQuery += ` ${pincode}`;
    }
    
    // 4. Call geocoding service (Google Maps, Mapbox, OSM, etc.)
    const geocodeResult = await geocodeService.geocode({
        address: geocodeQuery,
        country: 'India',
        region: 'IN'
    });
    
    // 5. Validate and extract coordinates
    if (!geocodeResult || !geocodeResult.latitude || !geocodeResult.longitude) {
        throw new Error('Geocoding failed: No coordinates returned');
    }
    
    // 6. Validate coordinate ranges
    if (
        geocodeResult.latitude < -90 || geocodeResult.latitude > 90 ||
        geocodeResult.longitude < -180 || geocodeResult.longitude > 180
    ) {
        throw new Error('Geocoding failed: Invalid coordinates');
    }
    
    // 7. Return geocoded data
    return {
        latitude: geocodeResult.latitude,
        longitude: geocodeResult.longitude,
        confidenceScore: geocodeResult.confidence || 0.8, // Default if not provided
        source: geocodeResult.source || 'geocoded'
    };
}
```

### Geocoding Service Interface

```typescript
interface GeocodeService {
    geocode(params: {
        address: string;
        country?: string;
        region?: string;
    }): Promise<{
        latitude: number;
        longitude: number;
        confidence?: number;
        source?: string;
        formattedAddress?: string;
    }>;
}

// Example implementations:
// - Google Maps Geocoding API
// - Mapbox Geocoding API
// - OpenStreetMap Nominatim
// - India Post Geocoding API (if available)
```

---

## Transactional Approval Flow

### Complete SQL Transaction

```sql
-- ============================================================================
-- TRAINER APPROVAL TRANSACTION WITH GEOCODING
-- ============================================================================
-- This transaction:
-- 1. Updates trainer approval status
-- 2. Creates trainer_addresses record
-- 3. Geocodes address and creates trainer_base_locations
-- 4. Updates trainer_applications review status
-- 5. Updates trainers table with service assignment
-- ============================================================================

BEGIN;

-- Step 1: Get application data
DO $$
DECLARE
    v_trainer_id UUID;
    v_application_id UUID;
    v_address_text TEXT;
    v_pincode VARCHAR(6);
    v_city_id UUID;
    v_zone_id UUID;
    v_admin_id UUID;
    
    -- Geocoding results (set by application code)
    v_latitude NUMERIC(10, 8);
    v_longitude NUMERIC(11, 8);
    v_confidence_score NUMERIC(3, 2);
    v_geocoded_source TEXT;
    
    -- Generated IDs
    v_address_id UUID;
    v_base_location_id UUID;
BEGIN
    -- Get application data
    SELECT 
        ta.trainer_id,
        ta.id,
        ta.address_text,
        ta.pincode,
        ta.city_id,
        ta.zone_id,
        $1::UUID  -- admin_id parameter
    INTO 
        v_trainer_id,
        v_application_id,
        v_address_text,
        v_pincode,
        v_city_id,
        v_zone_id,
        v_admin_id
    FROM trainer_applications ta
    WHERE ta.trainer_id = $2::UUID  -- trainer_id parameter
    AND ta.review_status = 'PENDING';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found or already reviewed';
    END IF;
    
    -- Step 2: Resolve pincode to city_id if not already set
    IF v_city_id IS NULL AND v_pincode IS NOT NULL THEN
        SELECT city_id INTO v_city_id
        FROM pincodes
        WHERE pincode = v_pincode
        LIMIT 1;
    END IF;
    
    -- Step 3: Get state from city if available
    DECLARE
        v_state TEXT;
    BEGIN
        IF v_city_id IS NOT NULL THEN
            SELECT state INTO v_state
            FROM cities
            WHERE id = v_city_id;
        END IF;
    END;
    
    -- Step 4: Create trainer_addresses record
    INSERT INTO trainer_addresses (
        trainer_id,
        address_text,
        pincode,
        city_id,
        state,
        country,
        is_verified,
        verified_by,
        verified_at,
        is_primary,
        created_at,
        updated_at
    ) VALUES (
        v_trainer_id,
        v_address_text,
        v_pincode,
        v_city_id,
        v_state,
        'India',
        false,  -- Will be verified later in KYC process
        v_admin_id,
        NOW(),
        true,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_address_id;
    
    -- Step 5: Geocode address (coordinates set by application code before transaction)
    -- NOTE: Geocoding happens in application code, results passed as parameters
    -- v_latitude, v_longitude, v_confidence_score, v_geocoded_source are set externally
    
    -- Step 6: Create trainer_base_locations record
    INSERT INTO trainer_base_locations (
        trainer_id,
        latitude,
        longitude,
        source,
        confidence_score,
        geocoded_by,
        address_id,
        geocoded_at,
        created_at,
        updated_at
    ) VALUES (
        v_trainer_id,
        $3::NUMERIC,  -- latitude (from geocoding)
        $4::NUMERIC,  -- longitude (from geocoding)
        COALESCE($5::TEXT, 'geocoded'),  -- source
        COALESCE($6::NUMERIC, 0.8),  -- confidence_score
        'google',  -- geocoded_by (service name)
        v_address_id,
        NOW(),
        NOW(),
        NOW()
    )
    RETURNING id INTO v_base_location_id;
    
    -- Step 7: Update trainer_applications review status
    UPDATE trainer_applications
    SET 
        review_status = 'APPROVED',
        reviewed_by = v_admin_id,
        reviewed_at = NOW(),
        city_id = v_city_id,
        zone_id = v_zone_id,
        application_stage = 'approved',
        updated_at = NOW()
    WHERE id = v_application_id;
    
    -- Step 8: Update trainers table with service assignment
    UPDATE trainers
    SET 
        approval_status = 'approved',
        service_status = 'ACTIVE',
        city_id = v_city_id,
        zone_id = v_zone_id,
        updated_at = NOW()
    WHERE id = v_trainer_id;
    
    -- Success
    RAISE NOTICE 'Trainer approved: %, Address: %, Base Location: %', 
        v_trainer_id, v_address_id, v_base_location_id;
END $$;

COMMIT;
```

### TypeScript Service Implementation

```typescript
import { Pool, PoolClient } from 'pg';
import { geocodeAddress } from '../services/geocoding.service';

/**
 * Approve trainer with transactional geocoding
 */
export async function approveTrainerWithGeocoding(
    trainerId: string,
    adminId: string,
    pool: Pool
): Promise<void> {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Step 1: Get application data
        const appResult = await client.query(
            `SELECT 
                id, trainer_id, address_text, pincode, city_id, zone_id
            FROM trainer_applications
            WHERE trainer_id = $1 AND review_status = 'PENDING'`,
            [trainerId]
        );
        
        if (appResult.rows.length === 0) {
            throw new Error('Application not found or already reviewed');
        }
        
        const application = appResult.rows[0];
        
        // Step 2: Resolve pincode to city if needed
        let cityId = application.city_id;
        let state: string | null = null;
        
        if (!cityId && application.pincode) {
            const pincodeResult = await client.query(
                `SELECT city_id, state FROM pincodes WHERE pincode = $1`,
                [application.pincode]
            );
            
            if (pincodeResult.rows.length > 0) {
                cityId = pincodeResult.rows[0].city_id;
                state = pincodeResult.rows[0].state;
            }
        }
        
        // Get state from city if available
        if (cityId && !state) {
            const cityResult = await client.query(
                `SELECT state FROM cities WHERE id = $1`,
                [cityId]
            );
            if (cityResult.rows.length > 0) {
                state = cityResult.rows[0].state;
            }
        }
        
        // Step 3: Create trainer_addresses record
        const addressResult = await client.query(
            `INSERT INTO trainer_addresses (
                trainer_id, address_text, pincode, city_id, state, country,
                is_verified, verified_by, verified_at, is_primary
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), true)
            RETURNING id`,
            [
                trainerId,
                application.address_text,
                application.pincode,
                cityId,
                state,
                'India',
                false, // Will be verified in KYC process
                adminId
            ]
        );
        
        const addressId = addressResult.rows[0].id;
        
        // Step 4: Geocode address
        const geocodeQuery = buildGeocodeQuery(
            application.address_text,
            application.pincode,
            cityId
        );
        
        const geocodeResult = await geocodeAddress(geocodeQuery);
        
        // Step 5: Create trainer_base_locations record
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
                'google', // or your geocoding service name
                addressId
            ]
        );
        
        // Step 6: Update trainer_applications
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
            [adminId, cityId, application.zone_id, application.id]
        );
        
        // Step 7: Update trainers table
        await client.query(
            `UPDATE trainers
            SET approval_status = 'approved',
                service_status = 'ACTIVE',
                city_id = $1,
                zone_id = $2,
                updated_at = NOW()
            WHERE id = $3`,
            [cityId, application.zone_id, trainerId]
        );
        
        await client.query('COMMIT');
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Build geocoding query string from address components
 */
function buildGeocodeQuery(
    addressText: string,
    pincode: string | null,
    cityId: string | null
): string {
    let query = addressText;
    
    // Add city and state if available
    if (cityId) {
        // In production, fetch city name from database
        // For now, assume it's included in address_text
    }
    
    // Add pincode
    if (pincode) {
        query += ` ${pincode}`;
    }
    
    query += ', India';
    
    return query;
}
```

---

## Application-Time Behavior

### Frontend (Application Form)

```typescript
// Trainer enters:
interface ApplicationLocationInput {
    address_text: string;  // Required
    pincode: string;        // Required (6 digits)
    // GPS is optional at application time
    latitude?: number;
    longitude?: number;
}

// Backend stores in trainer_applications:
// - address_text
// - pincode
// - latitude (optional)
// - longitude (optional)
// - NO city_id or zone_id (set during review)
```

### Backend (Application Submission)

```typescript
// Store application location (no geocoding yet)
await pool.query(
    `INSERT INTO trainer_applications (
        trainer_id, address_text, pincode, latitude, longitude
    ) VALUES ($1, $2, $3, $4, $5)`,
    [trainerId, addressText, pincode, latitude, longitude]
);

// Pincode → city lookup for admin review (optional, for suggestions)
if (pincode) {
    const cityResult = await pool.query(
        `SELECT c.id, c.name, c.state, c.tier
         FROM pincodes p
         INNER JOIN cities c ON p.city_id = c.id
         WHERE p.pincode = $1`,
        [pincode]
    );
    // Return to admin for review (suggestion only)
}
```

---

## Key Principles

1. **Address and pincode are NEVER replaced by lat/long**
   - `trainer_addresses.address_text` and `pincode` remain as text
   - `trainer_base_locations` stores derived coordinates separately

2. **No free-text city storage**
   - Always use `city_id` (FK to `cities`)
   - Resolve via `pincodes` table during application

3. **GPS is optional at application time**
   - `trainer_applications.latitude/longitude` are optional
   - Geocoding happens AFTER approval

4. **Base location separate from live tracking**
   - `trainer_base_locations` = operational anchor (geocoded)
   - `location_tracking_sessions` / `location_updates` = live GPS tracking

5. **Transactional approval flow**
   - All approval steps in a single transaction
   - Geocoding happens within transaction
   - Rollback on any failure

---

## Production Recommendations

1. **Use PostGIS for accurate distance calculations**
   ```sql
   -- Add PostGIS extension
   CREATE EXTENSION IF NOT EXISTS postgis;
   
   -- Add geography column
   ALTER TABLE trainer_base_locations
   ADD COLUMN location_geography GEOGRAPHY(POINT, 4326);
   
   -- Create spatial index
   CREATE INDEX idx_trainer_base_locations_geography
   ON trainer_base_locations USING GIST(location_geography);
   ```

2. **Implement geocoding retry logic**
   - Retry on transient failures
   - Fallback to alternative geocoding services
   - Log failures for manual review

3. **Monitor geocoding quality**
   - Track `confidence_score` distribution
   - Alert on low-confidence geocodes
   - Manual review for critical cases

4. **Cache pincode lookups**
   - Pincode → city mapping is static
   - Cache in Redis for fast auto-fill

5. **Audit trail**
   - Log all geocoding operations
   - Track address changes
   - Maintain history in `trainer_addresses` (is_primary flag)

---

## Migration Checklist

- [ ] Run migration: `009-enterprise-location-model.sql`
- [ ] Verify all tables created
- [ ] Verify all indexes created
- [ ] Populate `pincodes` table (India Post data)
- [ ] Populate `cities` table with tier information
- [ ] Implement geocoding service
- [ ] Update approval service to use transactional flow
- [ ] Update application form to use pincode auto-fill
- [ ] Test approval flow with geocoding
- [ ] Monitor geocoding success rate
- [ ] Set up alerts for low-confidence geocodes

---

## Support

For questions or issues, refer to:
- Migration file: `009-enterprise-location-model.sql`
- This guide: `009-LOCATION_MODEL_GUIDE.md`
- Codebase: `kc-backend/services/admin-service/src/services/trainerApproval.service.ts`

