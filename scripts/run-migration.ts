/**
 * Run Database Migration Script
 * 
 * This script runs the canonical progress model migration using the existing database connection.
 * 
 * Usage:
 *   npm run migrate:progress
 *   OR
 *   ts-node scripts/run-migration.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
// @ts-ignore - pg types may not be available
import { Pool } from 'pg';

// Load environment variables
config();

async function runMigration() {
  console.log('🚀 Starting Canonical Progress Model Migration...\n');

  // Build connection string from environment variables
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URI || process.env.DATABASE_URL;
  let connectionString: string;
  
  if (url) {
    connectionString = url;
  } else {
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = process.env.POSTGRES_PORT || '5432';
    const user = process.env.POSTGRES_USER || 'postgres';
    const password = process.env.POSTGRES_PASSWORD || 'postgres';
    const database = process.env.POSTGRES_DB || 'postgres';
    const ssl = process.env.POSTGRES_SSL === 'true';
    connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${ssl ? '?sslmode=require' : ''}`;
  }
  
  if (!connectionString) {
    console.error('❌ Database connection string not found!');
    console.error('   Please set POSTGRES_URL or POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB');
    process.exit(1);
  }
  
  console.log(`📡 Connecting to database...`);
  console.log(`   Host: ${connectionString.split('@')[1]?.split('/')[0] || 'hidden'}\n`);
  
  // Create connection pool with SSL for cloud databases
  const isCloud = /render\.com|amazonaws\.com|googleapis\.com|azure|supabase/i.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: 1, // Use single connection for migration
    ssl: isCloud ? { rejectUnauthorized: false } : undefined,
  });

  let client;
  try {
    // Connect to database
    client = await pool.connect();
    console.log('✅ Connected to database\n');

    // Read migration file
    const migrationPath = join(__dirname, '../migrations/003-canonical-progress-model.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('📄 Reading migration file...');
    console.log(`   Path: ${migrationPath}\n`);

    // Run migration
    console.log('⚙️  Executing migration...\n');
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!\n');

    // Verify triggers were created
    console.log('🔍 Verifying triggers...');
    const triggerResult = await client.query(`
      SELECT trigger_name, event_manipulation, event_object_table 
      FROM information_schema.triggers 
      WHERE trigger_name LIKE '%sync_course_progress%'
      ORDER BY trigger_name;
    `);

    if (triggerResult.rows.length > 0) {
      console.log(`   ✅ Found ${triggerResult.rows.length} trigger(s):`);
      triggerResult.rows.forEach((row: any) => {
        console.log(`      - ${row.trigger_name} (${row.event_manipulation} on ${row.event_object_table})`);
      });
    } else {
      console.log('   ⚠️  No triggers found (this may indicate an issue)');
    }

    // Verify indexes were created
    console.log('\n🔍 Verifying indexes...');
    const indexResult = await client.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'tutoring_sessions' 
        AND indexname LIKE '%student_course%'
      ORDER BY indexname;
    `);

    if (indexResult.rows.length > 0) {
      console.log(`   ✅ Found ${indexResult.rows.length} index(es):`);
      indexResult.rows.forEach((row: any) => {
        console.log(`      - ${row.indexname}`);
      });
    } else {
      console.log('   ⚠️  No indexes found (this may indicate an issue)');
    }

    // Validate consistency (sample check)
    console.log('\n🔍 Validating data consistency (sample)...');
    const validationResult = await client.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT student_id) as unique_students,
        COUNT(DISTINCT course_id) as unique_courses
      FROM student_course_progress;
    `);

    if (validationResult.rows.length > 0) {
      const stats = validationResult.rows[0];
      console.log(`   ✅ Progress records: ${stats.total_records}`);
      console.log(`   ✅ Unique students: ${stats.unique_students}`);
      console.log(`   ✅ Unique courses: ${stats.unique_courses}`);
    }

    console.log('\n✨ Migration verification complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Test completing a session to verify triggers work');
    console.log('   2. Check that progress updates automatically');
    console.log('   3. Monitor trigger performance');

  } catch (error: any) {
    console.error('\n❌ Migration failed!');
    console.error(`   Error: ${error.message}`);
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

