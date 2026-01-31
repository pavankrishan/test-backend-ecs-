/**
 * Test: update student_profiles for a given student_id (same as Edit Profile / More Info).
 * Proves the DB accepts full_name, age, gender, etc.
 * Usage: node test-profile-save.js
 * Env: POSTGRES_URL or DATABASE_URL (same as services).
 */
try { require('dotenv').config({ path: require('path').join(__dirname, '.env') }); } catch (_) {}
const { Pool } = require('pg');

const STUDENT_ID = '22246e6e-9754-4f72-a6ef-dd333f0c2913';

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
    // 1) Read current row
    const before = await client.query(
      `SELECT id, student_id, full_name, age, gender, address, latitude, longitude, created_at, updated_at
       FROM student_profiles WHERE student_id = $1`,
      [STUDENT_ID]
    );
    if (before.rows.length === 0) {
      console.log('No row for student_id', STUDENT_ID, '- inserting one.');
      await client.query(
        `INSERT INTO student_profiles (student_id, full_name, age, gender, address, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (student_id) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           age = EXCLUDED.age,
           gender = EXCLUDED.gender,
           address = EXCLUDED.address,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           updated_at = NOW()`,
        [STUDENT_ID, 'Test Full Name', 25, 'male', 'Singarayakonda, Andhra Pradesh, 523101, India', 15.2604317, 80.036725]
      );
    } else {
      console.log('Before:', JSON.stringify(before.rows[0], null, 2));
      // 2) Update (same shape as student-service upsert)
      await client.query(
        `UPDATE student_profiles SET
           full_name = $1,
           age = $2,
           gender = $3,
           address = COALESCE($4, address),
           latitude = COALESCE($5, latitude),
           longitude = COALESCE($6, longitude),
           updated_at = NOW()
         WHERE student_id = $7`,
        ['Test Full Name', 25, 'male', 'Singarayakonda, Andhra Pradesh, 523101, India', 15.2604317, 80.036725, STUDENT_ID]
      );
    }

    // 3) Read back
    const after = await client.query(
      `SELECT id, student_id, full_name, age, gender, address, latitude, longitude, created_at, updated_at
       FROM student_profiles WHERE student_id = $1`,
      [STUDENT_ID]
    );
    console.log('After:', after.rows[0] ? JSON.stringify(after.rows[0], null, 2) : 'no row');
    if (after.rows[0]?.full_name) {
      console.log('OK: full_name is saved in DB.');
    } else {
      console.log('WARN: full_name still empty after update.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  if (e.code === 'ENOTFOUND' || e.message?.includes('getaddrinfo')) {
    console.error('DB host unreachable (DNS/network). Run this script from a machine that can reach POSTGRES_URL.');
  }
  console.error(e.message || e);
  process.exit(1);
});
