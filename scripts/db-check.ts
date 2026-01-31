#!/usr/bin/env ts-node
import 'dotenv/config';
import { createPostgresPool } from '../shared/databases/postgres/connection';

async function main() {
  const pool = createPostgresPool();
  try {
    console.log('Connecting to Postgres using connection string from env...');
    const res = await pool.query("SELECT NOW() as now");
    console.log('Postgres reachable. Server time:', res.rows[0].now);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Postgres connectivity check failed:', err);
    try {
      await pool.end();
    } catch (e) {
      // ignore
    }
    process.exit(2);
  }
}

main();
