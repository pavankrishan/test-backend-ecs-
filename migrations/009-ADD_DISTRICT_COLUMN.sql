-- ============================================================================
-- MIGRATION: Add district column to location tables
-- ============================================================================
-- This migration adds district column to cities, pincodes, and trainer_addresses
-- ============================================================================

BEGIN;

-- Add district column to cities table
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
        ALTER TABLE cities ADD COLUMN IF NOT EXISTS district TEXT;
        CREATE INDEX IF NOT EXISTS idx_cities_district ON cities(district) WHERE district IS NOT NULL;
        RAISE NOTICE 'District column added to cities table';
    END IF;
END $$;

-- Add district column to pincodes table
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pincodes') THEN
        ALTER TABLE pincodes ADD COLUMN IF NOT EXISTS district TEXT;
        CREATE INDEX IF NOT EXISTS idx_pincodes_district ON pincodes(district) WHERE district IS NOT NULL;
        RAISE NOTICE 'District column added to pincodes table';
    END IF;
END $$;

-- Add district column to trainer_addresses table
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'trainer_addresses') THEN
        ALTER TABLE trainer_addresses ADD COLUMN IF NOT EXISTS district TEXT;
        CREATE INDEX IF NOT EXISTS idx_trainer_addresses_district ON trainer_addresses(district) WHERE district IS NOT NULL;
        RAISE NOTICE 'District column added to trainer_addresses table';
    END IF;
END $$;

COMMIT;

