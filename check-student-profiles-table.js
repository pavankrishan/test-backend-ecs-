/**
 * Run this to verify where student_profiles table exists (schema + name).
 * Uses same env as services: POSTGRES_URL or DATABASE_URL.
 *
 * Usage (from kc-backend): node check-student-profiles-table.js
 */
const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URI || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set POSTGRES_URL, POSTGRES_URI, or DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: /sslmode=require|ssl=true/i.test(connectionString) ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_name = 'student_profiles'
    `);
    console.log('student_profiles table location(s):');
    if (res.rows.length === 0) {
      console.log('  (none found)');
    } else {
      res.rows.forEach((r) => console.log(`  schema: ${r.table_schema}, table: ${r.table_name}`));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
