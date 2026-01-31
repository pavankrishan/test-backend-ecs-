-- Migration: Insert Promotional Coupon Codes
-- Description: Insert 5 promotional coupon codes with ₹2000 fixed discount
-- Each user can only use ONE coupon code lifetime (enforced in validation logic)

INSERT INTO coupons (
    code,
    name,
    type,
    discount_type,
    discount_value,
    max_redemptions,
    current_redemptions,
    valid_from,
    valid_until,
    is_active,
    metadata,
    created_at,
    updated_at
) VALUES
    (
        'KCFEB26',
        'February 2026 Promotional Code',
        'promotional',
        'fixed',
        2000.00,
        NULL, -- Unlimited redemptions
        0,
        NOW(),
        '2026-08-01 23:59:59+00',
        true,
        '{"description": "₹2000 discount promotional code"}',
        NOW(),
        NOW()
    ),
    (
        'KCTRI25',
        'Trial 2025 Promotional Code',
        'promotional',
        'fixed',
        2000.00,
        NULL, -- Unlimited redemptions
        0,
        NOW(),
        '2026-08-01 23:59:59+00',
        true,
        '{"description": "₹2000 discount promotional code"}',
        NOW(),
        NOW()
    ),
    (
        'KCUNLOCK',
        'Unlock Promotional Code',
        'promotional',
        'fixed',
        2000.00,
        NULL, -- Unlimited redemptions
        0,
        NOW(),
        '2026-08-01 23:59:59+00',
        true,
        '{"description": "₹2000 discount promotional code"}',
        NOW(),
        NOW()
    ),
    (
        'KCSAVE26',
        'Save 2026 Promotional Code',
        'promotional',
        'fixed',
        2000.00,
        NULL, -- Unlimited redemptions
        0,
        NOW(),
        '2026-08-01 23:59:59+00',
        true,
        '{"description": "₹2000 discount promotional code"}',
        NOW(),
        NOW()
    ),
    (
        'KCLAUNCH26',
        'Launch 2026 Promotional Code',
        'promotional',
        'fixed',
        2000.00,
        NULL, -- Unlimited redemptions
        0,
        NOW(),
        '2026-08-01 23:59:59+00',
        true,
        '{"description": "₹2000 discount promotional code"}',
        NOW(),
        NOW()
    )
ON CONFLICT (code) DO NOTHING;
