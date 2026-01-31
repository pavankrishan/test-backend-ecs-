-- ============================================================================
-- TRAINER MONTHLY PAYROLL CALCULATION QUERIES
-- ============================================================================
-- This file contains SQL queries for calculating trainer monthly payroll
-- based on student allocations with base salary slabs and per-student allowance

-- ============================================================================
-- QUERY 1: Calculate Base Salary by Date Ranges
-- ============================================================================
-- Splits the month into date ranges where student count is constant
-- and calculates base salary for each range

WITH RECURSIVE date_series AS (
    -- Generate all days in the month (30 days)
    SELECT DATE '2024-01-01' AS day
    UNION ALL
    SELECT day + 1
    FROM date_series
    WHERE day < DATE '2024-01-01' + 29  -- 30 days total (0-29)
),
daily_student_counts AS (
    -- Count active students for each day
    SELECT 
        ds.day,
        COUNT(DISTINCT tsa.student_id) AS student_count
    FROM date_series ds
    LEFT JOIN trainer_student_allocations tsa ON (
        tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
        AND tsa.start_date <= ds.day
        AND (tsa.end_date IS NULL OR tsa.end_date >= ds.day)
    )
    GROUP BY ds.day
    ORDER BY ds.day
),
student_count_ranges AS (
    -- Identify ranges where student count changes
    SELECT 
        day AS range_start,
        student_count,
        ROW_NUMBER() OVER (ORDER BY day) AS rn,
        LAG(student_count) OVER (ORDER BY day) AS prev_count
    FROM daily_student_counts
),
range_groups AS (
    -- Group consecutive days with same student count
    SELECT 
        range_start,
        student_count,
        rn,
        SUM(CASE WHEN student_count != COALESCE(prev_count, -1) THEN 1 ELSE 0 END) 
            OVER (ORDER BY range_start) AS range_id
    FROM student_count_ranges
),
final_ranges AS (
    -- Calculate date ranges and days per range
    SELECT 
        MIN(range_start) AS range_start,
        MAX(range_start) AS range_end,
        MAX(student_count) AS student_count,
        COUNT(*) AS days_in_range
    FROM range_groups
    GROUP BY range_id
)
SELECT 
    range_start,
    range_end,
    student_count,
    days_in_range,
    CASE 
        WHEN student_count = 3 THEN 9000.00 / 30 * days_in_range
        WHEN student_count = 4 THEN 12000.00 / 30 * days_in_range
        WHEN student_count = 5 THEN 15000.00 / 30 * days_in_range
        WHEN student_count = 6 THEN 18000.00 / 30 * days_in_range
        WHEN student_count = 7 THEN 21000.00 / 30 * days_in_range
        WHEN student_count = 8 THEN 24000.00 / 30 * days_in_range
        ELSE 0
    END AS range_base_salary
FROM final_ranges
ORDER BY range_start;

-- ============================================================================
-- QUERY 2: Calculate Total Base Salary for Month
-- ============================================================================

SELECT 
    COALESCE(SUM(
        CASE 
            WHEN student_count = 3 THEN 9000.00 / 30 * days_in_range
            WHEN student_count = 4 THEN 12000.00 / 30 * days_in_range
            WHEN student_count = 5 THEN 15000.00 / 30 * days_in_range
            WHEN student_count = 6 THEN 18000.00 / 30 * days_in_range
            WHEN student_count = 7 THEN 21000.00 / 30 * days_in_range
            WHEN student_count = 8 THEN 24000.00 / 30 * days_in_range
            ELSE 0
        END
    ), 0) AS total_base_salary
FROM (
    -- Use the final_ranges CTE from Query 1
    -- ... (same CTEs as Query 1)
) final_ranges;

-- ============================================================================
-- QUERY 3: Calculate Allowance (Per Student Per Day)
-- ============================================================================
-- Calculates allowance for each student based on active days in the month

SELECT 
    tsa.student_id,
    tsa.start_date,
    tsa.end_date,
    -- Calculate active days in the month
    GREATEST(0, 
        LEAST(
            DATE '2024-01-30',  -- month_end
            COALESCE(tsa.end_date, DATE '2024-01-30')
        ) - 
        GREATEST(
            DATE '2024-01-01',  -- month_start
            tsa.start_date
        ) + 1
    ) AS active_days,
    -- Calculate allowance (₹25 per student per day)
    GREATEST(0, 
        LEAST(
            DATE '2024-01-30',
            COALESCE(tsa.end_date, DATE '2024-01-30')
        ) - 
        GREATEST(
            DATE '2024-01-01',
            tsa.start_date
        ) + 1
    ) * 25.00 AS student_allowance
FROM trainer_student_allocations tsa
WHERE tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
    AND tsa.start_date <= DATE '2024-01-30'  -- month_end
    AND (tsa.end_date IS NULL OR tsa.end_date >= DATE '2024-01-01');  -- month_start

-- Total Allowance
SELECT 
    COALESCE(SUM(
        GREATEST(0, 
            LEAST(
                DATE '2024-01-30',  -- month_end
                COALESCE(tsa.end_date, DATE '2024-01-30')
            ) - 
            GREATEST(
                DATE '2024-01-01',  -- month_start
                tsa.start_date
            ) + 1
        ) * 25.00
    ), 0) AS total_allowance
FROM trainer_student_allocations tsa
WHERE tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
    AND tsa.start_date <= DATE '2024-01-30'
    AND (tsa.end_date IS NULL OR tsa.end_date >= DATE '2024-01-01');

-- ============================================================================
-- QUERY 4: Complete Monthly Payroll Calculation
-- ============================================================================
-- Combines base salary and allowance calculations

WITH month_params AS (
    SELECT 
        DATE '2024-01-01' AS month_start,
        DATE '2024-01-30' AS month_end,
        30 AS month_days,
        25.00 AS daily_allowance_per_student
),
base_salary_calc AS (
    -- Base salary calculation (from Query 1 & 2)
    SELECT COALESCE(SUM(
        CASE 
            WHEN student_count = 3 THEN 9000.00 / 30 * days_in_range
            WHEN student_count = 4 THEN 12000.00 / 30 * days_in_range
            WHEN student_count = 5 THEN 15000.00 / 30 * days_in_range
            WHEN student_count = 6 THEN 18000.00 / 30 * days_in_range
            WHEN student_count = 7 THEN 21000.00 / 30 * days_in_range
            WHEN student_count = 8 THEN 24000.00 / 30 * days_in_range
            ELSE 0
        END
    ), 0) AS total_base_salary
    FROM (
        -- Insert final_ranges CTE from Query 1 here
        -- ... (same CTEs as Query 1)
    ) final_ranges
),
allowance_calc AS (
    -- Allowance calculation (from Query 3)
    SELECT 
        COALESCE(SUM(
            GREATEST(0, 
                LEAST(
                    mp.month_end,
                    COALESCE(tsa.end_date, mp.month_end)
                ) - 
                GREATEST(
                    mp.month_start,
                    tsa.start_date
                ) + 1
            ) * mp.daily_allowance_per_student
        ), 0) AS total_allowance
    FROM trainer_student_allocations tsa
    CROSS JOIN month_params mp
    WHERE tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
        AND tsa.start_date <= mp.month_end
        AND (tsa.end_date IS NULL OR tsa.end_date >= mp.month_start)
)
SELECT 
    bs.total_base_salary,
    al.total_allowance,
    bs.total_base_salary + al.total_allowance AS total_payout
FROM base_salary_calc bs
CROSS JOIN allowance_calc al;

-- ============================================================================
-- QUERY 5: Check Trainer Student Limit (Max 8 students per day)
-- ============================================================================

SELECT 
    trainer_id,
    date,
    COUNT(DISTINCT student_id) AS student_count
FROM (
    SELECT 
        tsa.trainer_id,
        generate_series(
            tsa.start_date,
            COALESCE(tsa.end_date, CURRENT_DATE),
            '1 day'::interval
        )::DATE AS date,
        tsa.student_id
    FROM trainer_student_allocations tsa
    WHERE tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
        AND tsa.start_date <= CURRENT_DATE
        AND (tsa.end_date IS NULL OR tsa.end_date >= CURRENT_DATE - INTERVAL '90 days')
) daily_allocations
GROUP BY trainer_id, date
HAVING COUNT(DISTINCT student_id) > 8;  -- Should return no rows if constraint is satisfied

-- ============================================================================
-- QUERY 6: Get Active Students for a Trainer on a Specific Date
-- ============================================================================

SELECT 
    tsa.student_id,
    s.name AS student_name,
    tsa.start_date,
    tsa.end_date,
    CASE 
        WHEN tsa.end_date IS NULL THEN true
        WHEN tsa.end_date >= DATE '2024-01-15' THEN true
        ELSE false
    END AS is_active
FROM trainer_student_allocations tsa
JOIN students s ON s.id = tsa.student_id
WHERE tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
    AND tsa.start_date <= DATE '2024-01-15'
    AND (tsa.end_date IS NULL OR tsa.end_date >= DATE '2024-01-15')
ORDER BY tsa.start_date DESC;

