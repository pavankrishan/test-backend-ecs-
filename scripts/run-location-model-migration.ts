/**
 * Run Enterprise Location Model Migration (009)
 * 
 * This script runs the enterprise location model migration.
 * Creates: cities (enhanced), pincodes, trainer_addresses, trainer_base_locations
 * 
 * Usage:
 *   ts-node scripts/run-location-model-migration.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
// @ts-ignore - pg types may not be available
import { Pool } from 'pg';

// Load environment variables
config();

async function runMigration() {
  console.log('🚀 Starting Enterprise Location Model Migration (009)...\n');

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
    // Test connection
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful\n');

    // Read migration file
    const migrationPath = join(__dirname, '../migrations/009-enterprise-location-model.sql');
    console.log(`📄 Reading migration file: ${migrationPath}\n`);
    
    const migrationSQL = readFileSync(migrationPath, 'utf-8');
    
    // Split by semicolons and execute each statement
    // Note: This is a simplified approach. For production, use a proper migration tool
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    console.log(`📝 Executing ${statements.length} SQL statements...\n`);

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let executed = 0;
      for (const statement of statements) {
        if (statement.trim().length === 0) continue;
        
        try {
          await client.query(statement);
          executed++;
          if (executed % 10 === 0) {
            console.log(`   ✓ Executed ${executed} statements...`);
          }
        } catch (error: any) {
          // Some statements might fail if they already exist (CREATE TABLE IF NOT EXISTS, etc.)
          if (error.message.includes('already exists') || error.message.includes('duplicate')) {
            console.log(`   ⚠ Skipping (already exists): ${statement.substring(0, 50)}...`);
            continue;
          }
          throw error;
        }
      }
      
      await client.query('COMMIT');
      console.log(`\n✅ Migration completed successfully!`);
      console.log(`   Executed ${executed} statements\n`);
      
      // Verify tables were created
      console.log('🔍 Verifying tables...\n');
      const tables = ['cities', 'pincodes', 'trainer_addresses', 'trainer_base_locations'];
      
      for (const table of tables) {
        const result = await client.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )`,
          [table]
        );
        
        if (result.rows[0].exists) {
          console.log(`   ✅ Table '${table}' exists`);
        } else {
          console.log(`   ❌ Table '${table}' NOT found`);
        }
      }
      
      console.log('\n🎉 Migration verification complete!\n');
      
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error: any) {
    console.error('\n❌ Migration failed!');
    console.error('   Error:', error.message);
    if (error.stack) {
      console.error('\n   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
    console.log('📡 Database connection closed\n');
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

