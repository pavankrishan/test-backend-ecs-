-- ============================================================================
-- MIGRATION: 009 - ENTERPRISE LOCATION MODEL
-- ============================================================================
-- Enterprise-grade, legally safe, scalable location architecture
-- 
-- PURPOSE:
--   - Separate identity location (KYC/profile) from operational GPS
--   - Use pincode for auto-fill, geocode AFTER approval only
--   - Maintain address/pincode as text (never replace with lat/long)
--   - Scale to BYJU'S / UrbanCompany level
--
-- ABSOLUTE RULES (DO NOT VIOLATE):
--   - DO NOT replace address or pincode with latitude/longitude
--   - DO NOT store free-text city long-term
--   - DO NOT capture GPS at application time compulsorily
--   - DO NOT mix base location with live tracking tables
-- ============================================================================

BEGIN;

-- ============================================================================
-- TABLE: cities (ENHANCED)
-- ============================================================================
-- Geography master table for standardized city data
-- WHY: Eliminates free-text city storage, enables service area operations
-- Legal compliance: Standardized city names for KYC/verification
-- Scalability: Indexed lookups, supports service expansion
-- ============================================================================

-- Create cities table if it doesn't exist
CREATE TABLE IF NOT EXISTS cities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    district TEXT,
    state TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'India',
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add district column if it doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
        ALTER TABLE cities ADD COLUMN IF NOT EXISTS district TEXT;
    END IF;
END $$;

-- Add indexes for state and district-based queries
-- Only if cities table exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
        CREATE INDEX IF NOT EXISTS idx_cities_state ON cities(state) WHERE state IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_cities_district ON cities(district) WHERE district IS NOT NULL;
    END IF;
END $$;

-- Add unique constraint on (name, state, country) if not exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'cities_name_state_country_key'
        ) THEN
            ALTER TABLE cities 
            ADD CONSTRAINT cities_name_state_country_key 
            UNIQUE (name, state, country);
        END IF;
    END IF;
END $$;

-- Comments for documentation (only if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
        COMMENT ON TABLE cities IS 
            'Geography master table. Standardized city data for KYC, service area assignment, and operations. Never store free-text city names in other tables.';
    END IF;
END $$;

-- ============================================================================
-- TABLE: pincodes
-- ============================================================================
-- Pincode resolver table for auto-fill functionality
-- WHY: Enables pincode → city auto-fill during application
-- Legal compliance: Official pincode-to-city mapping (India Post standard)
-- Scalability: Indexed lookups, supports millions of pincodes
-- ============================================================================

CREATE TABLE IF NOT EXISTS pincodes (
    pincode VARCHAR(6) PRIMARY KEY,
    city_id UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    district TEXT,
    state TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'India',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure pincode format is valid (6 digits)
    CONSTRAINT pincode_format_check 
        CHECK (pincode ~ '^[0-9]{6}$')
);

-- Indexes for pincodes (all foreign keys indexed)
CREATE INDEX IF NOT EXISTS idx_pincodes_city 
    ON pincodes(city_id);

-- Add district column if it doesn't exist
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pincodes') THEN
        ALTER TABLE pincodes ADD COLUMN IF NOT EXISTS district TEXT;
    END IF;
END $$;

-- Index for state-based queries (common in Indian operations)
CREATE INDEX IF NOT EXISTS idx_pincodes_state 
    ON pincodes(state);

-- Index for district-based queries
CREATE INDEX IF NOT EXISTS idx_pincodes_district 
    ON pincodes(district) WHERE district IS NOT NULL;

-- Composite index for pincode + state lookups (optimizes auto-fill)
CREATE INDEX IF NOT EXISTS idx_pincodes_pincode_state 
    ON pincodes(pincode, state);

-- Comments for documentation
COMMENT ON TABLE pincodes IS 
    'Pincode resolver table. Maps Indian pincodes (6 digits) to cities for auto-fill during application. Source: India Post standard. Used ONLY for auto-fill, NOT for geocoding.';

COMMENT ON COLUMN pincodes.pincode IS 
    '6-digit Indian pincode (e.g., "110001"). Primary key for fast lookups.';

COMMENT ON COLUMN pincodes.city_id IS 
    'Foreign key to cities table. Resolves pincode to standardized city.';

-- ============================================================================
-- TABLE: trainer_addresses
-- ============================================================================
-- Trainer identity address (KYC / profile location)
-- WHY: Stores legal address for KYC compliance, separate from operational GPS
-- Legal compliance: Required for background verification, tax compliance
-- Audit-friendly: Immutable address history, verification status tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS trainer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    
    -- Identity address (KYC data)
    address_text TEXT NOT NULL, -- Full address as entered by trainer
    pincode VARCHAR(6), -- 6-digit pincode (for auto-fill and verification)
    city_id UUID REFERENCES cities(id) ON DELETE SET NULL, -- Resolved from pincode
    district TEXT, -- District name (for display and verification)
    state TEXT, -- State name (for display and verification)
    country TEXT NOT NULL DEFAULT 'India',
    
    -- Verification status (for KYC compliance)
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verified_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    
    -- Audit trail
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one active address per trainer (can have history)
    -- Note: We allow multiple addresses for history, but mark one as primary
    is_primary BOOLEAN NOT NULL DEFAULT true
);

-- Indexes for trainer_addresses (all foreign keys indexed)
CREATE INDEX IF NOT EXISTS idx_trainer_addresses_trainer 
    ON trainer_addresses(trainer_id);

CREATE INDEX IF NOT EXISTS idx_trainer_addresses_city 
    ON trainer_addresses(city_id) WHERE city_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trainer_addresses_pincode 
    ON trainer_addresses(pincode) WHERE pincode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trainer_addresses_district 
    ON trainer_addresses(district) WHERE district IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trainer_addresses_verified 
    ON trainer_addresses(is_verified) WHERE is_verified = true;

CREATE INDEX IF NOT EXISTS idx_trainer_addresses_primary 
    ON trainer_addresses(trainer_id, is_primary) WHERE is_primary = true;

-- Ensure only one primary address per trainer
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_addresses_primary_unique 
    ON trainer_addresses(trainer_id) 
    WHERE is_primary = true;

-- Comments for documentation
COMMENT ON TABLE trainer_addresses IS 
    'Trainer identity address (KYC/profile location). Stores legal address for background verification and tax compliance. Separate from operational GPS tracking. Address and pincode are NEVER replaced by lat/long.';

COMMENT ON COLUMN trainer_addresses.address_text IS 
    'Full address as entered by trainer. Never replaced by geocoded coordinates. Required for KYC compliance.';

COMMENT ON COLUMN trainer_addresses.pincode IS 
    '6-digit pincode. Used for auto-fill (resolves to city_id) and verification. Never replaced by lat/long.';

COMMENT ON COLUMN trainer_addresses.city_id IS 
    'Resolved from pincode via pincodes table. Standardized city reference, not free-text.';

COMMENT ON COLUMN trainer_addresses.is_verified IS 
    'KYC verification status. Set to true after background verification completes.';

-- ============================================================================
-- TABLE: trainer_base_locations
-- ============================================================================
-- Trainer base operational location (AFTER APPROVAL ONLY)
-- WHY: Derived geocoded anchor for operational use, separate from identity address
-- Legal compliance: Created only after approval, with audit trail
-- Scalability: Supports distance calculations, service area matching
-- ============================================================================

CREATE TABLE IF NOT EXISTS trainer_base_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    
    -- Geocoded coordinates (derived from address, NOT GPS)
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    
    -- Geocoding metadata
    source TEXT NOT NULL DEFAULT 'geocoded' 
        CHECK (source IN ('geocoded', 'manual', 'verified')),
    confidence_score NUMERIC(3, 2), -- 0.00 to 1.00 (geocoding confidence)
    geocoded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    geocoded_by TEXT, -- Service name (e.g., 'google', 'mapbox', 'osm')
    
    -- Reference to address used for geocoding
    address_id UUID REFERENCES trainer_addresses(id) ON DELETE SET NULL,
    
    -- Audit trail
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure one base location per trainer (can be updated)
    UNIQUE(trainer_id),
    
    -- Validate coordinate ranges
    CONSTRAINT latitude_range_check 
        CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT longitude_range_check 
        CHECK (longitude >= -180 AND longitude <= 180)
);

-- Indexes for trainer_base_locations (all foreign keys indexed)
CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_trainer 
    ON trainer_base_locations(trainer_id);

CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_address 
    ON trainer_base_locations(address_id) WHERE address_id IS NOT NULL;

-- Spatial index for distance queries (PostGIS extension recommended for production)
-- For now, use B-tree index on lat/lng for approximate distance queries
CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_coords 
    ON trainer_base_locations(latitude, longitude);

-- Index for geocoding source tracking
CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_source 
    ON trainer_base_locations(source);

-- Comments for documentation
COMMENT ON TABLE trainer_base_locations IS 
    'Trainer base operational location. Geocoded coordinates derived from address AFTER approval. Used for service area matching, distance calculations, and operational routing. Separate from identity address and live GPS tracking.';

COMMENT ON COLUMN trainer_base_locations.latitude IS 
    'Geocoded latitude from address. Created AFTER approval, NOT during application.';

COMMENT ON COLUMN trainer_base_locations.longitude IS 
    'Geocoded longitude from address. Created AFTER approval, NOT during application.';

COMMENT ON COLUMN trainer_base_locations.source IS 
    'Source of coordinates: geocoded (from address), manual (admin override), verified (field verified).';

COMMENT ON COLUMN trainer_base_locations.confidence_score IS 
    'Geocoding confidence (0.00 to 1.00). Higher = more reliable. Used for quality filtering.';

COMMENT ON COLUMN trainer_base_locations.address_id IS 
    'Reference to trainer_addresses record used for geocoding. Maintains link between identity and operational location.';

-- ============================================================================
-- ENHANCE location_tracking_sessions (if missing fields)
-- ============================================================================
-- Live session tracking table (KEEP EXISTING DESIGN)
-- Add missing fields if they don't exist
-- ============================================================================

-- Add accuracy field if missing
ALTER TABLE location_tracking_sessions 
    ADD COLUMN IF NOT EXISTS accuracy NUMERIC(6, 2);

-- Add captured_at field if missing (for precise timestamp)
ALTER TABLE location_tracking_sessions 
    ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ DEFAULT NOW();

-- Index for accuracy-based queries
CREATE INDEX IF NOT EXISTS idx_location_tracking_sessions_accuracy 
    ON location_tracking_sessions(accuracy) WHERE accuracy IS NOT NULL;

-- ============================================================================
-- ENHANCE location_updates (if missing fields)
-- ============================================================================
-- Live location updates table (KEEP EXISTING DESIGN)
-- Add missing fields if they don't exist
-- ============================================================================

-- Ensure accuracy field exists (should already exist, but safe check)
ALTER TABLE location_updates 
    ADD COLUMN IF NOT EXISTS accuracy NUMERIC(6, 2);

-- Add captured_at field if missing (for precise timestamp)
ALTER TABLE location_updates 
    ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ DEFAULT NOW();

-- Index for accuracy-based queries
CREATE INDEX IF NOT EXISTS idx_location_updates_accuracy 
    ON location_updates(accuracy) WHERE accuracy IS NOT NULL;

-- Index for captured_at queries (for time-based filtering)
CREATE INDEX IF NOT EXISTS idx_location_updates_captured_at 
    ON location_updates(captured_at DESC);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

COMMIT;

-- ============================================================================
-- VERIFICATION QUERIES (Run after migration)
-- ============================================================================
-- 
-- 1. Verify all tables exist:
--    SELECT table_name FROM information_schema.tables 
--    WHERE table_schema = 'public' 
--    AND table_name IN ('cities', 'pincodes', 'trainer_addresses', 'trainer_base_locations');
--
-- 2. Verify all indexes exist:
--    SELECT indexname FROM pg_indexes 
--    WHERE tablename IN ('cities', 'pincodes', 'trainer_addresses', 'trainer_base_locations');
--
-- 3. Verify foreign key constraints:
--    SELECT conname, conrelid::regclass, confrelid::regclass 
--    FROM pg_constraint 
--    WHERE contype = 'f' 
--    AND conrelid::regclass::text IN ('pincodes', 'trainer_addresses', 'trainer_base_locations');
-- ============================================================================

