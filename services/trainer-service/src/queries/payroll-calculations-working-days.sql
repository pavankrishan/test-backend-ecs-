-- ============================================================================
-- TRAINER MONTHLY PAYROLL CALCULATION QUERIES (Working Days Only)
-- ============================================================================
-- This file contains SQL queries for calculating trainer monthly payroll
-- based on student allocations with base salary slabs and per-student allowance
-- Only working days (Mon-Sat) are counted, Sundays are excluded
-- Handles session substitutions for allowance adjustments

-- ============================================================================
-- QUERY 1: Count Working Days in a Month
-- ============================================================================
-- Counts only Monday-Saturday, excludes Sundays

SELECT COUNT(*) AS working_days
FROM generate_series(
    DATE '2024-01-01',  -- month_start
    DATE '2024-01-31',  -- month_end
    '1 day'::interval
) AS day
WHERE EXTRACT(DOW FROM day) BETWEEN 1 AND 6; -- 1=Monday, 6=Saturday

-- ============================================================================
-- QUERY 2: Calculate Base Salary by Working Days
-- ============================================================================
-- Splits the month into date ranges where student count is constant
-- Only counts working days (Mon-Sat)

WITH month_params AS (
    SELECT 
        DATE '2024-01-01' AS month_start,
        DATE '2024-01-31' AS month_end
),
working_days AS (
    SELECT day::DATE AS day
    FROM generate_series(
        (SELECT month_start FROM month_params),
        (SELECT month_end FROM month_params),
        '1 day'::interval
    ) AS day
    WHERE EXTRACT(DOW FROM day) BETWEEN 1 AND 6 -- Mon-Sat only
),
daily_student_counts AS (
    SELECT 
        wd.day,
        COUNT(DISTINCT tsa.student_id) AS student_count
    FROM working_days wd
    LEFT JOIN trainer_student_allocations tsa ON (
        tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
        AND tsa.start_date <= wd.day
        AND (tsa.end_date IS NULL OR tsa.end_date >= wd.day)
    )
    GROUP BY wd.day
    ORDER BY wd.day
),
student_count_ranges AS (
    SELECT 
        day AS range_start,
        student_count,
        ROW_NUMBER() OVER (ORDER BY day) AS rn,
        LAG(student_count) OVER (ORDER BY day) AS prev_count
    FROM daily_student_counts
),
range_groups AS (
    SELECT 
        range_start,
        student_count,
        rn,
        SUM(CASE WHEN student_count != COALESCE(prev_count, -1) THEN 1 ELSE 0 END) 
            OVER (ORDER BY range_start) AS range_id
    FROM student_count_ranges
),
final_ranges AS (
    SELECT 
        MIN(range_start) AS range_start,
        MAX(range_start) AS range_end,
        MAX(student_count) AS student_count,
        COUNT(*) AS days_in_range
    FROM range_groups
    GROUP BY range_id
),
working_days_count AS (
    SELECT COUNT(*) AS total_working_days
    FROM working_days
)
SELECT 
    fr.range_start,
    fr.range_end,
    fr.student_count,
    fr.days_in_range,
    wdc.total_working_days,
    CASE 
        WHEN fr.student_count = 3 THEN 9000.00 / wdc.total_working_days * fr.days_in_range
        WHEN fr.student_count = 4 THEN 12000.00 / wdc.total_working_days * fr.days_in_range
        WHEN fr.student_count = 5 THEN 15000.00 / wdc.total_working_days * fr.days_in_range
        WHEN fr.student_count = 6 THEN 18000.00 / wdc.total_working_days * fr.days_in_range
        WHEN fr.student_count = 7 THEN 21000.00 / wdc.total_working_days * fr.days_in_range
        WHEN fr.student_count = 8 THEN 24000.00 / wdc.total_working_days * fr.days_in_range
        ELSE 0
    END AS range_base_salary
FROM final_ranges fr
CROSS JOIN working_days_count wdc
ORDER BY fr.range_start;

-- ============================================================================
-- QUERY 3: Calculate Allowance with Substitution Adjustments
-- ============================================================================
-- Calculates allowance per student per working day
-- Excludes allowance for students whose session was substituted
-- Includes allowance for students handled as substitute trainer

WITH month_params AS (
    SELECT 
        DATE '2024-01-01' AS month_start,
        DATE '2024-01-31' AS month_end,
        25.00 AS daily_allowance_per_student
),
working_days AS (
    SELECT day::DATE AS day
    FROM generate_series(
        (SELECT month_start FROM month_params),
        (SELECT month_end FROM month_params),
        '1 day'::interval
    ) AS day
    WHERE EXTRACT(DOW FROM day) BETWEEN 1 AND 6 -- Mon-Sat only
),
original_student_days AS (
    -- Days where trainer has active students (original allocations)
    SELECT 
        wd.day,
        tsa.student_id
    FROM working_days wd
    INNER JOIN trainer_student_allocations tsa ON (
        tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
        AND tsa.start_date <= wd.day
        AND (tsa.end_date IS NULL OR tsa.end_date >= wd.day)
    )
    -- Exclude days where this student's session was substituted
    WHERE NOT EXISTS (
        SELECT 1 FROM trainer_session_substitutions sub
        WHERE sub.session_date = wd.day
            AND sub.student_id = tsa.student_id
            AND sub.original_trainer_id = 'TRAINER_ID_HERE'::uuid
    )
),
substitute_student_days AS (
    -- Days where trainer substituted for another trainer
    SELECT 
        sub.session_date AS day,
        sub.student_id
    FROM trainer_session_substitutions sub
    WHERE sub.substitute_trainer_id = 'TRAINER_ID_HERE'::uuid
        AND sub.session_date BETWEEN (SELECT month_start FROM month_params) 
        AND (SELECT month_end FROM month_params)
        AND EXTRACT(DOW FROM sub.session_date) BETWEEN 1 AND 6
),
all_eligible_days AS (
    SELECT day, student_id FROM original_student_days
    UNION
    SELECT day, student_id FROM substitute_student_days
)
SELECT 
    COUNT(*) AS eligible_student_days,
    COUNT(*) * (SELECT daily_allowance_per_student FROM month_params) AS total_allowance
FROM all_eligible_days;

-- ============================================================================
-- QUERY 4: Complete Monthly Payroll Calculation
-- ============================================================================
-- Combines base salary and allowance calculations with substitutions

WITH month_params AS (
    SELECT 
        DATE '2024-01-01' AS month_start,
        DATE '2024-01-31' AS month_end,
        25.00 AS daily_allowance_per_student
),
working_days AS (
    SELECT day::DATE AS day
    FROM generate_series(
        (SELECT month_start FROM month_params),
        (SELECT month_end FROM month_params),
        '1 day'::interval
    ) AS day
    WHERE EXTRACT(DOW FROM day) BETWEEN 1 AND 6
),
working_days_count AS (
    SELECT COUNT(*) AS total_working_days FROM working_days
),
-- Base Salary Calculation
base_salary_calc AS (
    -- (Insert base salary calculation from Query 2 here)
    SELECT 11000.00 AS total_base_salary -- Placeholder
),
-- Allowance Calculation
allowance_calc AS (
    -- (Insert allowance calculation from Query 3 here)
    SELECT 2750.00 AS total_allowance -- Placeholder
)
SELECT 
    bs.total_base_salary,
    al.total_allowance,
    bs.total_base_salary + al.total_allowance AS total_payout,
    wdc.total_working_days
FROM base_salary_calc bs
CROSS JOIN allowance_calc al
CROSS JOIN working_days_count wdc;

-- ============================================================================
-- QUERY 5: Check Substitutions for a Trainer
-- ============================================================================

-- As original trainer (sessions substituted away)
SELECT 
    sub.session_date,
    sub.student_id,
    sub.substitute_trainer_id,
    s.name AS student_name,
    t.name AS substitute_trainer_name
FROM trainer_session_substitutions sub
JOIN students s ON s.id = sub.student_id
JOIN trainers t ON t.id = sub.substitute_trainer_id
WHERE sub.original_trainer_id = 'TRAINER_ID_HERE'::uuid
    AND sub.session_date BETWEEN DATE '2024-01-01' AND DATE '2024-01-31'
ORDER BY sub.session_date DESC;

-- As substitute trainer (sessions taken over)
SELECT 
    sub.session_date,
    sub.student_id,
    sub.original_trainer_id,
    s.name AS student_name,
    t.name AS original_trainer_name
FROM trainer_session_substitutions sub
JOIN students s ON s.id = sub.student_id
JOIN trainers t ON t.id = sub.original_trainer_id
WHERE sub.substitute_trainer_id = 'TRAINER_ID_HERE'::uuid
    AND sub.session_date BETWEEN DATE '2024-01-01' AND DATE '2024-01-31'
ORDER BY sub.session_date DESC;

-- ============================================================================
-- QUERY 6: Validate Substitution (Working Day Check)
-- ============================================================================

-- Check if a date is a working day
SELECT 
    DATE '2024-01-07' AS check_date,
    EXTRACT(DOW FROM DATE '2024-01-07') AS day_of_week,
    CASE 
        WHEN EXTRACT(DOW FROM DATE '2024-01-07') BETWEEN 1 AND 6 THEN 'Working Day'
        ELSE 'Sunday (Holiday)'
    END AS day_type;

-- ============================================================================
-- QUERY 7: Get Daily Student Count (Working Days Only)
-- ============================================================================

SELECT 
    wd.day,
    COUNT(DISTINCT tsa.student_id) AS student_count
FROM (
    SELECT day::DATE AS day
    FROM generate_series(DATE '2024-01-01', DATE '2024-01-31', '1 day'::interval) AS day
    WHERE EXTRACT(DOW FROM day) BETWEEN 1 AND 6
) wd
LEFT JOIN trainer_student_allocations tsa ON (
    tsa.trainer_id = 'TRAINER_ID_HERE'::uuid
    AND tsa.start_date <= wd.day
    AND (tsa.end_date IS NULL OR tsa.end_date >= wd.day)
)
GROUP BY wd.day
ORDER BY wd.day;

