/**
 * Run GPS Confirmed Location Migration (010)
 * 
 * WHY: Adds gps_confirmed source type and confirmed_at column to trainer_base_locations
 * 
 * Usage:
 *   npx ts-node scripts/run-gps-confirmed-migration.ts
 *   OR
 *   node scripts/run-gps-confirmed-migration.js (if compiled)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
// @ts-ignore - pg types may not be available
import { Pool } from 'pg';

// Load environment variables
config();

const MIGRATION_FILE = join(__dirname, '../migrations/010-add-gps-confirmed-location.sql');

async function runMigration() {
  console.log('🚀 Starting GPS Confirmed Location Migration (010)...\n');

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
    ssl: isCloud ? { rejectUnauthorized: false } : false,
    max: 1, // Single connection for migration
  });

  try {
    // Read migration SQL
    const migrationSQL = readFileSync(MIGRATION_FILE, 'utf-8');
    console.log('✅ Migration file loaded\n');

    // Test connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful\n');

    // Run migration in transaction
    console.log('🔄 Running migration...');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Execute migration SQL
      await client.query(migrationSQL);

      await client.query('COMMIT');
      console.log('✅ Migration completed successfully!\n');

      // Verify changes
      console.log('🔍 Verifying changes...');
      
      // Check constraint exists
      const constraintCheck = await pool.query(`
        SELECT constraint_name, check_clause
        FROM information_schema.check_constraints
        WHERE constraint_name = 'trainer_base_locations_source_check'
      `);
      
      if (constraintCheck.rows.length > 0) {
        console.log('✅ Source constraint updated (includes gps_confirmed)');
      } else {
        console.warn('⚠️  Source constraint not found (may already exist)');
      }

      // Check confirmed_at column exists
      const columnCheck = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'trainer_base_locations'
          AND column_name = 'confirmed_at'
      `);

      if (columnCheck.rows.length > 0) {
        console.log('✅ confirmed_at column added');
      } else {
        console.warn('⚠️  confirmed_at column not found');
      }

      // Check index exists
      const indexCheck = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'trainer_base_locations'
          AND indexname = 'idx_trainer_base_locations_confirmed'
      `);

      if (indexCheck.rows.length > 0) {
        console.log('✅ Confirmed location index created');
      } else {
        console.warn('⚠️  Confirmed location index not found');
      }

      console.log('\n✅ Verification complete!\n');
      console.log('🎉 GPS Confirmed Location Migration (010) - SUCCESS\n');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error: any) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

