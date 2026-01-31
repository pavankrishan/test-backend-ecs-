-- Add Sunday Focus feature flag
-- This flag controls whether Sunday Focus mode is available in the student purchase flow
-- Disabled until July 31 (can be enabled via feature flag, not hardcoded dates)

INSERT INTO feature_flags (flag_key, flag_value, description) VALUES
('enable_sunday_focus', false, 'Enable Sunday Focus mode (disabled until July 31)')
ON CONFLICT (flag_key) DO NOTHING;

