-- ============================================================================
-- EXTENSION: btree_gist (required for EXCLUDE constraints with UUIDs)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- TRAINER STUDENT ALLOCATIONS TABLE
-- ============================================================================
-- Tracks active student allocations to trainers with start/end dates
-- Used for accurate monthly payroll calculations
-- Only working days (Mon-Sat) are counted for payroll
CREATE TABLE IF NOT EXISTS trainer_student_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE, -- NULL means currently active
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure no duplicate overlapping allocations for same trainer-student
    CONSTRAINT no_overlapping_allocations EXCLUDE USING gist (
        trainer_id WITH =,
        student_id WITH =,
        daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
    )
);

-- ============================================================================
-- TRAINER SESSION SUBSTITUTIONS TABLE
-- ============================================================================
-- Tracks when one trainer substitutes for another on a specific date
-- Used to adjust allowance calculations (substitute gets allowance, original doesn't)
CREATE TABLE IF NOT EXISTS trainer_session_substitutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_date DATE NOT NULL,
    original_trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    substitute_trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure substitution only on working days (Mon-Sat)
    CONSTRAINT substitution_working_day CHECK (
        EXTRACT(DOW FROM session_date) BETWEEN 1 AND 6
    ),
    
    -- One substitution per session per day
    UNIQUE(session_date, original_trainer_id, student_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_trainer ON trainer_student_allocations(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_student ON trainer_student_allocations(student_id);
CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_dates ON trainer_student_allocations USING gist (
    trainer_id, 
    daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]')
);
CREATE INDEX IF NOT EXISTS idx_trainer_student_allocations_active ON trainer_student_allocations(trainer_id, start_date) 
    WHERE end_date IS NULL;

-- Indexes for substitutions
CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_date ON trainer_session_substitutions(session_date);
CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_original ON trainer_session_substitutions(original_trainer_id, session_date);
CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_substitute ON trainer_session_substitutions(substitute_trainer_id, session_date);
CREATE INDEX IF NOT EXISTS idx_trainer_session_substitutions_student ON trainer_session_substitutions(student_id, session_date);

-- ============================================================================
-- TRAINER PAYROLL CALCULATIONS TABLE
-- ============================================================================
-- Stores calculated monthly payroll for trainers
CREATE TABLE IF NOT EXISTS trainer_payroll_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    calculation_month DATE NOT NULL, -- First day of the month (YYYY-MM-01)
    base_salary_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    allowance_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_payout NUMERIC(10, 2) NOT NULL DEFAULT 0,
    calculation_details JSONB NOT NULL, -- Stores breakdown: date ranges, student counts, etc.
    status TEXT NOT NULL DEFAULT 'calculated' 
        CHECK (status IN ('calculated', 'approved', 'paid', 'cancelled')),
    approved_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    payment_reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- One calculation per trainer per month
    UNIQUE(trainer_id, calculation_month)
);

CREATE INDEX IF NOT EXISTS idx_trainer_payroll_calculations_trainer ON trainer_payroll_calculations(trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_payroll_calculations_month ON trainer_payroll_calculations(calculation_month);
CREATE INDEX IF NOT EXISTS idx_trainer_payroll_calculations_status ON trainer_payroll_calculations(status);
CREATE INDEX IF NOT EXISTS idx_trainer_payroll_calculations_trainer_month ON trainer_payroll_calculations(trainer_id, calculation_month);

-- ============================================================================
-- FUNCTION: Check trainer student count constraint (working days only)
-- ============================================================================
-- Ensures no trainer has more than 8 active students on any working day
CREATE OR REPLACE FUNCTION check_trainer_student_limit()
RETURNS TRIGGER AS $$
DECLARE
    max_students INTEGER := 8;
    active_count INTEGER;
    check_date DATE;
    day_of_week INTEGER;
BEGIN
    -- Determine the date to check
    IF TG_OP = 'INSERT' THEN
        check_date := NEW.start_date;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check both old and new dates
        check_date := COALESCE(NEW.start_date, OLD.start_date);
    ELSE
        RETURN NULL;
    END IF;
    
    -- Only check on working days (Mon-Sat, DOW 1-6)
    day_of_week := EXTRACT(DOW FROM check_date);
    IF day_of_week = 0 THEN -- Sunday
        -- Allow Sunday allocations but they won't count for payroll
        RETURN NEW;
    END IF;
    
    -- Count active students for this trainer on this working day
    SELECT COUNT(DISTINCT student_id) INTO active_count
    FROM trainer_student_allocations
    WHERE trainer_id = NEW.trainer_id
        AND start_date <= check_date
        AND (end_date IS NULL OR end_date >= check_date)
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
    
    -- Add the new allocation if it's an insert/update
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NEW.start_date <= check_date AND (NEW.end_date IS NULL OR NEW.end_date >= check_date) THEN
            active_count := active_count + 1;
        END IF;
    END IF;
    
    -- Check constraint (only on working days)
    IF active_count > max_students THEN
        RAISE EXCEPTION 'Trainer cannot have more than % active students on working days. Current count: %', max_students, active_count;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce student limit
DROP TRIGGER IF EXISTS trigger_check_trainer_student_limit ON trainer_student_allocations;
CREATE TRIGGER trigger_check_trainer_student_limit
    BEFORE INSERT OR UPDATE ON trainer_student_allocations
    FOR EACH ROW
    EXECUTE FUNCTION check_trainer_student_limit();

-- ============================================================================
-- FUNCTION: Calculate trainer monthly payroll (Working Days Only)
-- ============================================================================
-- Calculates base salary and allowance for a trainer for a given month
-- Only working days (Mon-Sat) are counted, Sundays are excluded
-- Handles session substitutions for allowance adjustments
CREATE OR REPLACE FUNCTION calculate_trainer_monthly_payroll(
    p_trainer_id UUID,
    p_month DATE -- First day of the month (YYYY-MM-01)
)
RETURNS JSONB AS $$
DECLARE
    month_start DATE;
    month_end DATE;
    daily_allowance_per_student NUMERIC(10, 2) := 25.00;
    v_base_salary NUMERIC(10, 2) := 0;
    v_allowance NUMERIC(10, 2) := 0;
    v_total NUMERIC(10, 2) := 0;
    v_working_days INTEGER;
    v_details JSONB;
    v_result JSONB;
BEGIN
    -- Set month boundaries (actual calendar month)
    month_start := DATE_TRUNC('month', p_month)::DATE;
    month_end := (DATE_TRUNC('month', p_month) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    
    -- Count working days in the month (Mon-Sat, exclude Sundays)
    SELECT COUNT(*) INTO v_working_days
    FROM generate_series(month_start, month_end, INTERVAL '1 day') AS day
    WHERE EXTRACT(DOW FROM day::DATE) BETWEEN 1 AND 6; -- 1=Monday, 6=Saturday
    
    -- Calculate base salary: Only working days (Mon-Sat)
    WITH working_days AS (
        SELECT day::DATE AS day
        FROM generate_series(month_start, month_end, INTERVAL '1 day') AS day
        WHERE EXTRACT(DOW FROM day::DATE) BETWEEN 1 AND 6 -- Mon-Sat only
    ),
    daily_student_counts AS (
        SELECT 
            wd.day,
            COUNT(DISTINCT tsa.student_id) AS student_count
        FROM working_days wd
        LEFT JOIN trainer_student_allocations tsa ON (
            tsa.trainer_id = p_trainer_id
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
    corrected_ranges AS (
        SELECT 
            range_start,
            range_start + days_in_range - 1 AS range_end,
            student_count,
            days_in_range
        FROM final_ranges
    )
    SELECT 
        COALESCE(SUM(
            CASE 
                WHEN cr.student_count = 3 THEN 9000.00 / v_working_days * cr.days_in_range
                WHEN cr.student_count = 4 THEN 12000.00 / v_working_days * cr.days_in_range
                WHEN cr.student_count = 5 THEN 15000.00 / v_working_days * cr.days_in_range
                WHEN cr.student_count = 6 THEN 18000.00 / v_working_days * cr.days_in_range
                WHEN cr.student_count = 7 THEN 21000.00 / v_working_days * cr.days_in_range
                WHEN cr.student_count = 8 THEN 24000.00 / v_working_days * cr.days_in_range
                ELSE 0
            END
        ), 0),
        jsonb_agg(
            jsonb_build_object(
                'start_date', cr.range_start,
                'end_date', cr.range_end,
                'student_count', cr.student_count,
                'days', cr.days_in_range,
                'daily_base', CASE 
                    WHEN cr.student_count = 3 THEN 9000.00 / v_working_days
                    WHEN cr.student_count = 4 THEN 12000.00 / v_working_days
                    WHEN cr.student_count = 5 THEN 15000.00 / v_working_days
                    WHEN cr.student_count = 6 THEN 18000.00 / v_working_days
                    WHEN cr.student_count = 7 THEN 21000.00 / v_working_days
                    WHEN cr.student_count = 8 THEN 24000.00 / v_working_days
                    ELSE 0
                END,
                'range_base_salary', CASE 
                    WHEN cr.student_count = 3 THEN 9000.00 / v_working_days * cr.days_in_range
                    WHEN cr.student_count = 4 THEN 12000.00 / v_working_days * cr.days_in_range
                    WHEN cr.student_count = 5 THEN 15000.00 / v_working_days * cr.days_in_range
                    WHEN cr.student_count = 6 THEN 18000.00 / v_working_days * cr.days_in_range
                    WHEN cr.student_count = 7 THEN 21000.00 / v_working_days * cr.days_in_range
                    WHEN cr.student_count = 8 THEN 24000.00 / v_working_days * cr.days_in_range
                    ELSE 0
                END
            ) ORDER BY cr.range_start
        )
    INTO v_base_salary, v_details
    FROM corrected_ranges cr;
    
    -- If no ranges found, initialize empty array
    IF v_details IS NULL THEN
        v_details := '[]'::jsonb;
    END IF;
    
    -- Calculate allowance: per student per working day, adjusted for substitutions
    WITH working_days AS (
        SELECT day::DATE AS day
        FROM generate_series(month_start, month_end, INTERVAL '1 day') AS day
        WHERE EXTRACT(DOW FROM day::DATE) BETWEEN 1 AND 6 -- Mon-Sat only
    ),
    original_student_days AS (
        -- Days where trainer has active students (original allocations)
        SELECT 
            wd.day,
            tsa.student_id
        FROM working_days wd
        INNER JOIN trainer_student_allocations tsa ON (
            tsa.trainer_id = p_trainer_id
            AND tsa.start_date <= wd.day
            AND (tsa.end_date IS NULL OR tsa.end_date >= wd.day)
        )
        -- Exclude days where this student's session was substituted
        WHERE NOT EXISTS (
            SELECT 1 FROM trainer_session_substitutions sub
            WHERE sub.session_date = wd.day
                AND sub.student_id = tsa.student_id
                AND sub.original_trainer_id = p_trainer_id
        )
    ),
    substitute_student_days AS (
        -- Days where trainer substituted for another trainer
        SELECT 
            sub.session_date AS day,
            sub.student_id
        FROM trainer_session_substitutions sub
        WHERE sub.substitute_trainer_id = p_trainer_id
            AND sub.session_date BETWEEN month_start AND month_end
            AND EXTRACT(DOW FROM sub.session_date) BETWEEN 1 AND 6
    ),
    all_eligible_days AS (
        SELECT day, student_id FROM original_student_days
        UNION
        SELECT day, student_id FROM substitute_student_days
    )
    SELECT COALESCE(COUNT(*) * daily_allowance_per_student, 0)
    INTO v_allowance
    FROM all_eligible_days;
    
    -- Calculate total
    v_total := v_base_salary + v_allowance;
    
    -- Build result JSONB
    v_result := jsonb_build_object(
        'base_salary_amount', v_base_salary,
        'allowance_amount', v_allowance,
        'total_payout', v_total,
        'calculation_details', jsonb_build_object(
            'month_start', month_start,
            'month_end', month_end,
            'working_days', v_working_days,
            'base_salary_ranges', v_details,
            'allowance', jsonb_build_object(
                'daily_rate_per_student', daily_allowance_per_student,
                'total_allowance', v_allowance
            )
        )
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEW: Active trainer student allocations
-- ============================================================================
CREATE OR REPLACE VIEW active_trainer_student_allocations AS
SELECT 
    tsa.id,
    tsa.trainer_id,
    tsa.student_id,
    tsa.start_date,
    tsa.end_date,
    tsa.created_at,
    tsa.updated_at,
    CASE 
        WHEN tsa.end_date IS NULL THEN true
        WHEN tsa.end_date >= CURRENT_DATE THEN true
        ELSE false
    END AS is_active
FROM trainer_student_allocations tsa;

-- ============================================================================
-- VIEW: Daily trainer student counts
-- ============================================================================
CREATE OR REPLACE VIEW daily_trainer_student_counts AS
SELECT 
    trainer_id,
    date,
    COUNT(DISTINCT student_id) AS student_count
FROM (
    SELECT 
        tsa.trainer_id,
        (generate_series(
            tsa.start_date,
            COALESCE(tsa.end_date, CURRENT_DATE),
            INTERVAL '1 day'
        ))::DATE AS date,
        tsa.student_id
    FROM trainer_student_allocations tsa
    WHERE tsa.start_date <= CURRENT_DATE
        AND (tsa.end_date IS NULL OR tsa.end_date >= CURRENT_DATE - INTERVAL '90 days')
) daily_allocations
GROUP BY trainer_id, date;

COMMENT ON TABLE trainer_student_allocations IS 'Tracks student allocations to trainers with start/end dates for accurate payroll calculations';
COMMENT ON TABLE trainer_payroll_calculations IS 'Stores calculated monthly payroll for trainers';
COMMENT ON FUNCTION calculate_trainer_monthly_payroll IS 'Calculates base salary and allowance for a trainer for a given month based on student count slabs and per-student daily allowance';

