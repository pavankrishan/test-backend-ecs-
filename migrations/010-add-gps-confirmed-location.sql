-- ============================================================================
-- MIGRATION: Add GPS Confirmed Location Support
-- ============================================================================
-- WHY: Enable trainers to confirm their exact location via GPS + map pin
--      after approval, replacing inaccurate address-based geocoding
-- ============================================================================

-- Step 1: Add 'gps_confirmed' to source CHECK constraint
-- WHY: Allow storing GPS-confirmed locations separately from geocoded ones
ALTER TABLE trainer_base_locations
    DROP CONSTRAINT IF EXISTS trainer_base_locations_source_check;

ALTER TABLE trainer_base_locations
    ADD CONSTRAINT trainer_base_locations_source_check
    CHECK (source IN ('geocoded', 'manual', 'verified', 'gps_confirmed'));

-- Step 2: Add confirmed_at timestamp column
-- WHY: Legal requirement - track when trainer explicitly confirmed location
--      This timestamp proves trainer consent for location usage
ALTER TABLE trainer_base_locations
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Step 3: Add index for confirmed locations
-- WHY: Fast queries to check if trainer has confirmed location
CREATE INDEX IF NOT EXISTS idx_trainer_base_locations_confirmed
    ON trainer_base_locations(trainer_id, confirmed_at)
    WHERE source = 'gps_confirmed' AND confirmed_at IS NOT NULL;

-- Step 4: Update comments to reflect GPS confirmation capability
COMMENT ON COLUMN trainer_base_locations.source IS 
    'Source of coordinates: geocoded (from address), manual (admin override), verified (field verified), gps_confirmed (trainer confirmed via GPS + map pin).';

COMMENT ON COLUMN trainer_base_locations.confirmed_at IS 
    'Timestamp when trainer explicitly confirmed location via GPS + map pin. Legal proof of consent. Only set when source = gps_confirmed.';

-- Step 5: Update table comment
COMMENT ON TABLE trainer_base_locations IS 
    'Trainer base operational location. Can be geocoded from address (after approval) OR GPS-confirmed by trainer (after approval). Used for service area matching, distance calculations, and operational routing. Separate from identity address and live GPS tracking.';

