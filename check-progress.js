/**
 * Script to check if progress data is correctly stored and can be read
 * 
 * Usage:
 *   node check-progress.js <studentId> [courseId]
 */

const { Client } = require('pg');
require('dotenv').config();

async function checkProgress(studentId, courseId = null) {
    console.log('🔍 Checking progress data...\n');

    // Support connection string (DATABASE_URL, POSTGRES_URL, POSTGRES_URI)
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URI;
    const useSSL = process.env.POSTGRES_SSL === 'true' || process.env.CLOUD_DATABASE === 'true';
    
    let client;
    if (connectionString) {
        let finalConnectionString = connectionString;
        if (useSSL && !/sslmode=/.test(connectionString)) {
            const separator = connectionString.includes('?') ? '&' : '?';
            finalConnectionString = `${connectionString}${separator}sslmode=require`;
        }
        client = new Client({
            connectionString: finalConnectionString,
            ssl: useSSL ? { rejectUnauthorized: false } : undefined,
        });
    } else {
        client = new Client({
            host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
            port: process.env.DB_PORT || process.env.POSTGRES_PORT || 5432,
            database: process.env.DB_NAME || process.env.POSTGRES_DB || 'koding_caravan',
            user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
            password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || 'postgres',
            ssl: useSSL ? { rejectUnauthorized: false } : undefined,
        });
    }

    try {
        await client.connect();
        console.log('✅ Connected to database\n');

        // Check student_course_progress table
        console.log('📊 Checking student_course_progress table...');
        let progressQuery = `
            SELECT 
                id,
                student_id,
                course_id,
                percentage,
                completed_lessons,
                total_lessons,
                last_completed_at,
                updated_at
            FROM student_course_progress
            WHERE student_id = $1`;
        
        const progressParams = [studentId];
        
        if (courseId) {
            progressQuery += ` AND course_id = $2`;
            progressParams.push(courseId);
        }
        
        progressQuery += ` ORDER BY updated_at DESC`;

        const progressResult = await client.query(progressQuery, progressParams);

        if (progressResult.rows.length === 0) {
            console.log('   ❌ No progress records found in student_course_progress table');
            console.log(`   Student ID: ${studentId}`);
            if (courseId) {
                console.log(`   Course ID: ${courseId}`);
            }
        } else {
            console.log(`   ✅ Found ${progressResult.rows.length} progress record(s):\n`);
            progressResult.rows.forEach((row, index) => {
                console.log(`   Record ${index + 1}:`);
                console.log(`      ID: ${row.id}`);
                console.log(`      Student ID: ${row.student_id}`);
                console.log(`      Course ID: ${row.course_id}`);
                console.log(`      Percentage: ${row.percentage}%`);
                console.log(`      Completed Lessons: ${row.completed_lessons}`);
                console.log(`      Total Lessons: ${row.total_lessons}`);
                console.log(`      Last Completed At: ${row.last_completed_at || 'N/A'}`);
                console.log(`      Updated At: ${row.updated_at}`);
                console.log('');
            });

            // Calculate average progress
            const totalPercentage = progressResult.rows.reduce((sum, row) => sum + (parseFloat(row.percentage) || 0), 0);
            const averageProgress = progressResult.rows.length > 0 
                ? (totalPercentage / progressResult.rows.length).toFixed(2)
                : 0;
            
            console.log(`   📊 Calculated Average Progress: ${averageProgress}%`);
        }

        // Check student_progress table (individual sessions)
        console.log('\n📋 Checking student_progress table (individual sessions)...');
        let sessionProgressQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
                COUNT(*) FILTER (WHERE is_unlocked = true) as unlocked_count,
                COUNT(*) as total_count
            FROM student_progress
            WHERE student_id = $1`;
        
        const sessionParams = [studentId];
        
        if (courseId) {
            sessionProgressQuery += ` AND course_id = $2`;
            sessionParams.push(courseId);
        }

        const sessionResult = await client.query(sessionProgressQuery, sessionParams);
        const sessionStats = sessionResult.rows[0];
        
        console.log(`   Completed Sessions: ${sessionStats.completed_count}`);
        console.log(`   Unlocked Sessions: ${sessionStats.unlocked_count}`);
        console.log(`   Total Sessions: ${sessionStats.total_count}`);

        // Check purchase tier
        if (courseId) {
            console.log('\n💰 Checking purchase tier...');
            const purchaseResult = await client.query(
                `SELECT purchase_tier, is_active, created_at
                 FROM student_course_purchases
                 WHERE student_id = $1 AND course_id = $2 AND is_active = true
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [studentId, courseId]
            );

            if (purchaseResult.rows.length > 0) {
                console.log(`   ✅ Purchase Tier: ${purchaseResult.rows[0].purchase_tier} sessions`);
                console.log(`   Active: ${purchaseResult.rows[0].is_active}`);
            } else {
                console.log('   ⚠️  No active purchase found');
            }
        }

        // Verify data consistency
        console.log('\n🔍 Data Consistency Check:');
        if (progressResult.rows.length > 0 && courseId) {
            const progressRow = progressResult.rows.find(r => r.course_id === courseId);
            if (progressRow) {
                const expectedPercentage = sessionStats.unlocked_count > 0
                    ? Math.round((parseInt(sessionStats.completed_count) / parseInt(sessionStats.unlocked_count)) * 100)
                    : 0;
                
                console.log(`   Expected Percentage (from sessions): ${expectedPercentage}%`);
                console.log(`   Stored Percentage: ${progressRow.percentage}%`);
                
                if (Math.abs(parseFloat(progressRow.percentage) - expectedPercentage) > 1) {
                    console.log(`   ⚠️  WARNING: Mismatch between stored and calculated percentage!`);
                } else {
                    console.log(`   ✅ Percentage matches`);
                }
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        if (client) {
            await client.end().catch(() => {});
        }
    }
}

// Get student ID and course ID from command line arguments
const studentId = process.argv[2];
const courseId = process.argv[3] || null;

if (!studentId) {
    console.error('❌ Student ID is required');
    console.error('Usage: node check-progress.js <studentId> [courseId]');
    process.exit(1);
}

if (courseId) {
    console.log(`🎯 Checking progress for student: ${studentId}, course: ${courseId}\n`);
} else {
    console.log(`🎯 Checking progress for student: ${studentId} (all courses)\n`);
}

checkProgress(studentId, courseId).catch(console.error);

