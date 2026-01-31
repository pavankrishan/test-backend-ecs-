-- ============================================================================
-- MIGRATION: Remove tier column from cities table
-- ============================================================================
-- This migration removes the tier column from the cities table
-- if it was previously added
-- ============================================================================

BEGIN;

-- Remove tier column if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'cities' 
        AND column_name = 'tier'
    ) THEN
        -- Drop index first
        DROP INDEX IF EXISTS idx_cities_tier;
        
        -- Drop column
        ALTER TABLE cities DROP COLUMN tier;
        
        RAISE NOTICE 'Tier column removed from cities table';
    ELSE
        RAISE NOTICE 'Tier column does not exist in cities table';
    END IF;
END $$;

COMMIT;

