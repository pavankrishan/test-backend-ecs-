-- Migration: Update coupon discount values from ₹1000 to ₹2000
-- Description: Update existing promotional coupon codes to have ₹2000 discount instead of ₹1000

UPDATE coupons
SET 
    discount_value = 2000.00,
    metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{description}',
        '"₹2000 discount promotional code"'
    ),
    updated_at = NOW()
WHERE code IN ('KCFEB26', 'KCTRI25', 'KCUNLOCK', 'KCSAVE26', 'KCLAUNCH26')
  AND discount_value = 1000.00;
