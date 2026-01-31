# Troubleshooting Robotics Course Creation

## Common Issues and Solutions

### Issue 1: "Database configuration missing"

**Solution:**
1. Ensure your `kc-backend/.env` file exists
2. Add PostgreSQL credentials:
   ```env
   POSTGRES_URI=postgresql://postgres:YOUR_PASSWORD@localhost:5432/your_database
   ```
3. Restart your terminal after updating .env

### Issue 2: "Password authentication failed"

**Solution:**
1. Verify PostgreSQL password in `.env` matches your actual PostgreSQL password
2. Test connection manually:
   ```powershell
   psql -U postgres -h localhost
   ```
3. If connection works, update `.env` with correct password

### Issue 3: Script runs but no output

**Solution:**
1. Use the logging version:
   ```powershell
   npm run create-robotics-course-log
   ```
2. Check the log file: `scripts/createRoboticsCourse.log`
3. Or run directly and capture output:
   ```powershell
   npx tsx scripts/createRoboticsCourse.ts > output.txt 2>&1
   type output.txt
   ```

### Issue 4: "Table already exists" or constraint errors

**Solution:**
- This is normal if tables were already created
- The script will continue and create the course
- If you get unique constraint errors, the course might already exist

### Issue 5: Script fails silently

**Solution:**
1. Check if course-service is running (it might be using the database connection)
2. Stop the course-service before running the script
3. Or use a different database for testing

## Manual Verification

After running the script, verify in your database:

```sql
-- Check course was created
SELECT id, title FROM courses WHERE title = 'Robotics Fundamentals';

-- Check phases
SELECT COUNT(*) FROM course_phases;

-- Check levels  
SELECT COUNT(*) FROM course_levels;

-- Check sessions
SELECT COUNT(*) FROM course_sessions;
```

Expected results:
- 1 course
- 3 phases
- 9 levels
- 90 sessions

## Alternative: Create via API

If the script doesn't work, you can create the course via API:

1. Start the course-service
2. Use the API endpoints:
   - `POST /api/v1/courses/:courseId/phases`
   - `POST /api/v1/phases/:phaseId/levels`
   - `POST /api/v1/levels/:levelId/sessions`

## Getting Help

If you're still having issues:

1. Run with logging: `npm run create-robotics-course-log`
2. Check the log file for detailed error messages
3. Verify database connection: `npm run check-db`
4. Share the error message from the log file

