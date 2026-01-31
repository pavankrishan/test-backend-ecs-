#!/usr/bin/env ts-node
import 'dotenv/config';
import { createPostgresPool } from '../shared/databases/postgres/connection';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const pool = createPostgresPool();
  try {
    console.log('Applying migration: migrations/001-create-courses.sql');
    const sql = readFileSync(join(__dirname, '..', 'migrations', '001-create-courses.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migration applied successfully.');
    // Optional: verify table exists
    const res = await pool.query("SELECT to_regclass('public.courses') as exists");
    console.log('Table exists:', !!res.rows[0].exists);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Failed to apply migration:', err);
    try {
      await pool.end();
    } catch (e) {
      // ignore
    }
    process.exit(2);
  }
}

main();
