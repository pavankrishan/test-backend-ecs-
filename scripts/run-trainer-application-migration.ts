/**
 * Run Trainer Application Skills & Courses Migration
 * 
 * This script runs the trainer application skills and courses migration.
 * 
 * Usage:
 *   ts-node scripts/run-trainer-application-migration.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
// @ts-ignore - pg types may not be available
import { Pool } from 'pg';

// Load environment variables
config();

async function runMigration() {
  console.log('🚀 Starting Trainer Application Skills & Courses Migration...\n');

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
    const migrationPath = join(__dirname, '../migrations/008-trainer-application-skills-courses-ENHANCED.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    console.log('📄 Reading migration file...');
    console.log(`   Path: ${migrationPath}\n`);

    // Run migration
    console.log('⚙️  Executing migration...\n');
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!\n');

    // Verify tables were created
    console.log('🔍 Verifying tables...');
    const tableResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('trainer_application_skills', 'trainer_application_courses')
      ORDER BY table_name;
    `);

    if (tableResult.rows.length === 2) {
      console.log(`   ✅ Found ${tableResult.rows.length} table(s):`);
      tableResult.rows.forEach((row: any) => {
        console.log(`      - ${row.table_name}`);
      });
    } else {
      console.log(`   ⚠️  Expected 2 tables, found ${tableResult.rows.length}`);
    }

    // Verify indexes were created
    console.log('\n🔍 Verifying indexes...');
    const indexResult = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes 
      WHERE schemaname = 'public'
        AND (tablename = 'trainer_application_skills' OR tablename = 'trainer_application_courses')
      ORDER BY tablename, indexname;
    `);

    if (indexResult.rows.length > 0) {
      console.log(`   ✅ Found ${indexResult.rows.length} index(es):`);
      indexResult.rows.forEach((row: any) => {
        console.log(`      - ${row.indexname} (on ${row.tablename})`);
      });
    } else {
      console.log('   ⚠️  No indexes found (this may indicate an issue)');
    }

    // Verify functions were created
    console.log('\n🔍 Verifying functions...');
    const functionResult = await client.query(`
      SELECT routine_name, routine_type
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name IN ('check_max_courses_per_application', 'approve_trainer_application')
      ORDER BY routine_name;
    `);

    if (functionResult.rows.length === 2) {
      console.log(`   ✅ Found ${functionResult.rows.length} function(s):`);
      functionResult.rows.forEach((row: any) => {
        console.log(`      - ${row.routine_name} (${row.routine_type})`);
      });
    } else {
      console.log(`   ⚠️  Expected 2 functions, found ${functionResult.rows.length}`);
    }

    // Verify triggers were created
    console.log('\n🔍 Verifying triggers...');
    const triggerResult = await client.query(`
      SELECT trigger_name, event_manipulation, event_object_table 
      FROM information_schema.triggers 
      WHERE trigger_schema = 'public'
        AND trigger_name = 'trigger_check_max_courses'
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

    // Verify constraints
    console.log('\n🔍 Verifying constraints...');
    const constraintResult = await client.query(`
      SELECT 
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('trainer_application_skills', 'trainer_application_courses')
        AND tc.constraint_type IN ('UNIQUE', 'CHECK', 'FOREIGN KEY')
      ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
    `);

    if (constraintResult.rows.length > 0) {
      console.log(`   ✅ Found ${constraintResult.rows.length} constraint(s):`);
      constraintResult.rows.forEach((row: any) => {
        console.log(`      - ${row.constraint_name} (${row.constraint_type} on ${row.table_name})`);
      });
    } else {
      console.log('   ⚠️  No constraints found (this may indicate an issue)');
    }

    console.log('\n✨ Migration verification complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Test inserting skills into trainer_application_skills');
    console.log('   2. Test inserting courses (1-3) into trainer_application_courses');
    console.log('   3. Test attempting to insert 4th course (should fail)');
    console.log('   4. Test approve_trainer_application() function');
    console.log('   5. Verify data is copied to permanent tables');

  } catch (error: any) {
    console.error('\n❌ Migration failed!');
    console.error(`   Error: ${error.message}`);
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    if (error.detail) {
      console.error(`   Detail: ${error.detail}`);
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

