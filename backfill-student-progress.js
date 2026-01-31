/**
 * Backfill Student Progress for Completed Sessions
 * 
 * This script syncs existing completed tutoring_sessions to student_progress table.
 * 
 * Usage:
 *   node backfill-student-progress.js [courseId] [studentId]
 * 
 * If courseId and studentId are not provided, it will process all completed sessions.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function backfillStudentProgress(courseId = null, studentId = null) {
  console.log('🔄 Starting Student Progress Backfill...\n');

  // Build connection string
  const connectionString = 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.POSTGRES_URI ||
    (() => {
      const host = process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost';
      const port = process.env.DB_PORT || process.env.POSTGRES_PORT || 5432;
      const user = process.env.DB_USER || process.env.POSTGRES_USER || 'postgres';
      const password = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres';
      const database = process.env.DB_NAME || process.env.POSTGRES_DB || 'koding_caravan';
      const useSSL = process.env.POSTGRES_SSL === 'true' || process.env.CLOUD_DATABASE === 'true';
      
      return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${useSSL ? '?sslmode=require' : ''}`;
    })();

  const useSSL = process.env.POSTGRES_SSL === 'true' || 
                 process.env.CLOUD_DATABASE === 'true' ||
                 /render\.com|amazonaws\.com|googleapis\.com|azure|supabase/i.test(connectionString);

  const client = new Client({
    connectionString,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Find all completed sessions
    let query = `
      SELECT 
        ts.id,
        ts.student_id,
        ts.course_id,
        ts.status,
        ts.student_confirmed,
        ts.ended_at,
        COUNT(*) OVER (PARTITION BY ts.student_id, ts.course_id ORDER BY ts.ended_at) as session_number
      FROM tutoring_sessions ts
      WHERE ts.status = 'completed'
        AND ts.student_confirmed = true
        AND ts.course_id IS NOT NULL
        AND ts.student_id IS NOT NULL
    `;

    const params = [];
    if (courseId) {
      query += ` AND ts.course_id = $${params.length + 1}`;
      params.push(courseId);
    }
    if (studentId) {
      query += ` AND ts.student_id = $${params.length + 1}`;
      params.push(studentId);
    }

    query += ` ORDER BY ts.student_id, ts.course_id, ts.ended_at`;

    console.log('📋 Finding completed sessions...');
    const sessionsResult = await client.query(query, params);
    const completedSessions = sessionsResult.rows;

    if (completedSessions.length === 0) {
      console.log('   ℹ️  No completed sessions found');
      return;
    }

    console.log(`   ✅ Found ${completedSessions.length} completed session(s)\n`);

    // Group by student and course
    const groupedSessions = {};
    completedSessions.forEach(session => {
      const key = `${session.student_id}_${session.course_id}`;
      if (!groupedSessions[key]) {
        groupedSessions[key] = [];
      }
      groupedSessions[key].push(session);
    });

    let totalUpdated = 0;
    let totalCreated = 0;
    let totalSkipped = 0;

    // Process each student/course combination
    for (const [key, sessions] of Object.entries(groupedSessions)) {
      const [studentId, courseId] = key.split('_');
      
      console.log(`\n📚 Processing: Student ${studentId.substring(0, 8)}... | Course ${courseId.substring(0, 8)}...`);
      console.log(`   Completed sessions: ${sessions.length}`);

      // Get all course sessions ordered by phase, level, session_number
      const courseSessionsResult = await client.query(`
        SELECT 
          cs.id as session_id,
          cs.session_number,
          cl.id as level_id,
          cl.sequence as level_sequence,
          cp.id as phase_id,
          cp.sequence as phase_sequence
        FROM course_sessions cs
        JOIN course_levels cl ON cs.level_id = cl.id
        JOIN course_phases cp ON cl.phase_id = cp.id
        WHERE cp.course_id = $1
        ORDER BY cp.sequence ASC, cl.sequence ASC, cs.session_number ASC
      `, [courseId]);

      const courseSessions = courseSessionsResult.rows;
      console.log(`   Course sessions available: ${courseSessions.length}`);

      // For each completed tutoring session, mark the corresponding course session
      for (let i = 0; i < sessions.length && i < courseSessions.length; i++) {
        const tutoringSession = sessions[i];
        const courseSession = courseSessions[i];

        // Check if progress record exists
        const progressCheck = await client.query(`
          SELECT id, status FROM student_progress
          WHERE student_id = $1 AND session_id = $2
        `, [studentId, courseSession.session_id]);

        if (progressCheck.rows.length > 0) {
          const progress = progressCheck.rows[0];
          
          // Update if not already completed
          if (progress.status !== 'completed') {
            await client.query(`
              UPDATE student_progress
              SET 
                status = 'completed',
                video_watched = true,
                sheet_previewed = true,
                quiz_completed = true,
                video_watched_at = COALESCE(video_watched_at, NOW()),
                sheet_previewed_at = COALESCE(sheet_previewed_at, NOW()),
                quiz_completed_at = COALESCE(quiz_completed_at, NOW()),
                updated_at = NOW()
              WHERE id = $1
            `, [progress.id]);
            totalUpdated++;
            console.log(`   ✅ Updated progress for session ${courseSession.session_number} (Phase ${courseSession.phase_sequence}, Level ${courseSession.level_sequence})`);
          } else {
            totalSkipped++;
            console.log(`   ⏭️  Session ${courseSession.session_number} already completed, skipped`);
          }
        } else {
          // Create new progress record
          await client.query(`
            INSERT INTO student_progress (
              student_id,
              course_id,
              phase_id,
              level_id,
              session_id,
              status,
              is_unlocked,
              video_watched,
              sheet_previewed,
              quiz_completed,
              video_watched_at,
              sheet_previewed_at,
              quiz_completed_at,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, 'completed', true, true, true, true, NOW(), NOW(), NOW(), NOW(), NOW())
          `, [
            studentId,
            courseId,
            courseSession.phase_id,
            courseSession.level_id,
            courseSession.session_id
          ]);
          totalCreated++;
          console.log(`   ✨ Created progress for session ${courseSession.session_number} (Phase ${courseSession.phase_sequence}, Level ${courseSession.level_sequence})`);
        }
      }
    }

    console.log('\n📊 Summary:');
    console.log(`   ✅ Updated: ${totalUpdated}`);
    console.log(`   ✨ Created: ${totalCreated}`);
    console.log(`   ⏭️  Skipped: ${totalSkipped}`);
    console.log(`   📝 Total processed: ${totalUpdated + totalCreated + totalSkipped}`);

    console.log('\n✨ Backfill completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Refresh the app to see updated progress');
    console.log('   2. Check the course content screen to verify completion status');

  } catch (error) {
    console.error('\n❌ Backfill failed!');
    console.error(`   Error: ${error.message}`);
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Get parameters from command line
const courseId = process.argv[2] || null;
const studentId = process.argv[3] || null;

if (courseId) {
  console.log(`🎯 Target course: ${courseId}\n`);
}
if (studentId) {
  console.log(`🎯 Target student: ${studentId}\n`);
}

backfillStudentProgress(courseId, studentId).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

