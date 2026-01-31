/**
 * Simple test script to verify database connection
 */

import "@kodingcaravan/shared/config";
import { initPostgres, getPostgresPool } from '../src/config/database';

async function test() {
  try {
    console.log('Testing database connection...');
    console.log('POSTGRES_URI:', process.env.POSTGRES_URI ? 'Set' : 'Not set');
    console.log('POSTGRES_HOST:', process.env.POSTGRES_HOST || 'Not set');
    
    await initPostgres();
    const pool = getPostgresPool();
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connection successful!');
    console.log('Current time:', result.rows[0].now);
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }
}

test();

