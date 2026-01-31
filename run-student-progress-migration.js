/**
 * Run Student Progress Migration
 * 
 * This script runs the migration to update student_progress when sessions are completed.
 * 
 * Usage:
 *   node run-student-progress-migration.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  console.log('🚀 Starting Student Progress Migration...\n');

  // Build connection string from environment variables
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

    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', '004-update-student-progress-on-session-completion.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`❌ Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    console.log('📄 Reading migration file...');
    console.log(`   Path: ${migrationPath}\n`);

    // Run migration
    console.log('⚙️  Executing migration...\n');
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!\n');

    // Verify triggers were updated
    console.log('🔍 Verifying triggers...');
    const triggerResult = await client.query(`
      SELECT trigger_name, event_manipulation, event_object_table 
      FROM information_schema.triggers 
      WHERE trigger_name LIKE '%sync_course_progress%'
      ORDER BY trigger_name;
    `);

    if (triggerResult.rows.length > 0) {
      console.log(`   ✅ Found ${triggerResult.rows.length} trigger(s):`);
      triggerResult.rows.forEach((row) => {
        console.log(`      - ${row.trigger_name} (${row.event_manipulation} on ${row.event_object_table})`);
      });
    } else {
      console.log('   ⚠️  No triggers found (this may indicate an issue)');
    }

    // Verify function exists
    console.log('\n🔍 Verifying functions...');
    const functionResult = await client.query(`
      SELECT routine_name, routine_type
      FROM information_schema.routines
      WHERE routine_name IN ('sync_course_progress_on_session_completion', 'sync_course_progress_on_session_revert')
        AND routine_schema = 'public'
      ORDER BY routine_name;
    `);

    if (functionResult.rows.length > 0) {
      console.log(`   ✅ Found ${functionResult.rows.length} function(s):`);
      functionResult.rows.forEach((row) => {
        console.log(`      - ${row.routine_name} (${row.routine_type})`);
      });
    } else {
      console.log('   ⚠️  Functions not found (this may indicate an issue)');
    }

    console.log('\n✨ Migration verification complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Test completing a session to verify student_progress is updated');
    console.log('   2. Check the course content screen to see completion status');
    console.log('   3. Verify that sessions are marked in sequential order');

  } catch (error) {
    console.error('\n❌ Migration failed!');
    console.error(`   Error: ${error.message}`);
    if (error.position) {
      console.error(`   Position: ${error.position}`);
    }
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    if (error.message.includes('password authentication failed')) {
      console.error('\n💡 Database authentication failed. Please check your .env file:');
      console.error('   - POSTGRES_PASSWORD or DB_PASSWORD');
      console.error('   - POSTGRES_USER or DB_USER');
      console.error('   - Or use DATABASE_URL/POSTGRES_URL connection string');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Cannot connect to database. Please check:');
      console.error('   - POSTGRES_HOST or DB_HOST');
      console.error('   - POSTGRES_PORT or DB_PORT');
      console.error('   - Database server is running');
    } else if (error.message.includes('ECONNRESET') || error.message.includes('read ECONNRESET')) {
      console.error('\n💡 Connection was reset. This might be an SSL/TLS issue.');
      console.error('   Try setting POSTGRES_SSL=true in your .env file');
      console.error('   Or ensure your connection string includes sslmode=require');
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

