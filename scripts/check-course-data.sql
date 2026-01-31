-- Diagnostic SQL to check course data for a student
-- Replace <STUDENT_ID> with actual student ID

-- 1. Check if student has allocations with course IDs
SELECT 
  ta.id AS allocation_id,
  ta.course_id,
  ta.status,
  c.id AS course_exists,
  c.title AS course_title,
  CASE 
    WHEN c.id IS NULL THEN '❌ Course NOT in courses table'
    WHEN c.title IS NULL THEN '⚠️ Course exists but title is NULL'
    ELSE '✅ Course and title exist'
  END AS status
FROM trainer_allocations ta
LEFT JOIN courses c ON c.id = ta.course_id
WHERE ta.student_id = '<STUDENT_ID>'
  AND ta.status IN ('approved', 'active')
  AND ta.course_id IS NOT NULL
ORDER BY ta.created_at DESC;

-- 2. Check if student has purchases with course IDs
SELECT 
  scp.id AS purchase_id,
  scp.course_id,
  scp.is_active,
  c.id AS course_exists,
  c.title AS course_title,
  CASE 
    WHEN c.id IS NULL THEN '❌ Course NOT in courses table'
    WHEN c.title IS NULL THEN '⚠️ Course exists but title is NULL'
    ELSE '✅ Course and title exist'
  END AS status
FROM student_course_purchases scp
LEFT JOIN courses c ON c.id = scp.course_id
WHERE scp.student_id = '<STUDENT_ID>'
  AND scp.is_active = true
ORDER BY scp.created_at DESC;

-- 3. List all unique course IDs for this student
SELECT DISTINCT 
  course_id,
  'from_allocations' AS source
FROM trainer_allocations
WHERE student_id = '<STUDENT_ID>' 
  AND course_id IS NOT NULL
UNION
SELECT DISTINCT 
  course_id,
  'from_purchases' AS source
FROM student_course_purchases
WHERE student_id = '<STUDENT_ID>' 
  AND is_active = true
  AND course_id IS NOT NULL;

-- 4. Check if these courses exist in courses table
SELECT 
  c.id,
  c.title,
  c.category,
  CASE 
    WHEN c.title IS NULL THEN '⚠️ Title is NULL'
    WHEN c.title = '' THEN '⚠️ Title is empty string'
    ELSE '✅ Title exists'
  END AS title_status
FROM courses c
WHERE c.id IN (
  SELECT DISTINCT course_id
  FROM trainer_allocations
  WHERE student_id = '<STUDENT_ID>' 
    AND course_id IS NOT NULL
  UNION
  SELECT DISTINCT course_id
  FROM student_course_purchases
  WHERE student_id = '<STUDENT_ID>' 
    AND is_active = true
    AND course_id IS NOT NULL
);

