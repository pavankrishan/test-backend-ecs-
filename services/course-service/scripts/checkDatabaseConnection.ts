/**
 * Quick script to test database connection
 * Run this to verify your PostgreSQL credentials are correct
 */

// Load environment variables from .env file
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from kc-backend root directory
const envPath = resolve(__dirname, '../../.env');
config({ path: envPath });

// Also try loading from current directory
config();

import { initPostgres, getPostgresPool } from '../src/config/database';

async function checkConnection() {
  try {
    console.log('🔍 Testing PostgreSQL connection...\n');
    console.log('Environment variables:');
    console.log('  POSTGRES_HOST:', process.env.POSTGRES_HOST || 'not set');
    console.log('  POSTGRES_PORT:', process.env.POSTGRES_PORT || 'not set');
    console.log('  POSTGRES_USER:', process.env.POSTGRES_USER || 'not set');
    console.log('  POSTGRES_PASSWORD:', process.env.POSTGRES_PASSWORD ? '***' : 'not set');
    console.log('  POSTGRES_DB:', process.env.POSTGRES_DB || 'not set');
    console.log('  POSTGRES_URI:', process.env.POSTGRES_URI ? 'set (hidden)' : 'not set');
    console.log('\n');

    await initPostgres();
    const pool = getPostgresPool();
    
    const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Connection successful!');
    console.log('  Current time:', result.rows[0].current_time);
    console.log('  PostgreSQL version:', result.rows[0].pg_version.split(',')[0]);
    
    await pool.end();
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Connection failed!');
    console.error('Error:', error.message);
    console.error('\n💡 Tips:');
    console.error('  1. Check your .env file in kc-backend/.env');
    console.error('  2. Verify PostgreSQL is running');
    console.error('  3. Check database credentials (username/password)');
    console.error('  4. Ensure database exists');
    process.exit(1);
  }
}

checkConnection();

