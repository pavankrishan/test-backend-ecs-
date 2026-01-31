-- Fix sessions for student who changed address to etukuru
UPDATE student_profiles
SET latitude = 16.3067, longitude = 80.4365, updated_at = NOW()
WHERE student_id = '77697c62-0c49-4fb1-99b0-79d568576f45'
  AND (latitude IS NULL OR longitude IS NULL);

-- Create sessions for allocations without sessions
INSERT INTO tutoring_sessions (allocation_id, session_date, scheduled_time, status, created_at, updated_at)
SELECT
    a.id as allocation_id,
    (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '1 day' * gs.generate_series) as session_date,
    '16:00:00' as scheduled_time,
    'scheduled' as status,
    NOW() as created_at,
    NOW() as updated_at
FROM trainer_allocations a
CROSS JOIN generate_series(0, 29) as gs
LEFT JOIN tutoring_sessions s ON a.id = s.allocation_id
WHERE a.student_id = '77697c62-0c49-4fb1-99b0-79d568576f45'
  AND a.status IN ('approved', 'active')
  AND s.id IS NULL;
