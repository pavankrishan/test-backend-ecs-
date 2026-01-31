// Check database tables and data
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL;

if (!POSTGRES_URL) {
  console.error('POSTGRES_URL not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function main() {
  try {
    console.log('Connecting to:', POSTGRES_URL.split('@')[1]?.split('/')[1] || 'unknown');
    
    // Get total table count
    const tableCount = await pool.query(`
      SELECT COUNT(*) as total 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    console.log('\nTotal tables:', tableCount.rows[0].total);
    
    // Check important tables
    const importantTables = [
      'student_course_purchases',
      'payments',
      'students',
      'trainers',
      'courses',
      'trainer_allocations',
      'tutoring_sessions',
      'course_phases',
      'course_levels',
      'course_sessions',
      'student_progress',
      'processed_events'
    ];
    
    console.log('\n=== Checking Important Tables ===\n');
    
    for (const table of importantTables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = parseInt(result.rows[0].count);
        if (count > 0) {
          console.log(`✅ ${table.padEnd(35)} ${count.toString().padStart(10)} rows`);
          // Get sample
          const sample = await pool.query(`SELECT * FROM ${table} LIMIT 1`);
          if (sample.rows.length > 0) {
            const keys = Object.keys(sample.rows[0]).slice(0, 5);
            console.log(`   Sample keys: ${keys.join(', ')}`);
          }
        } else {
          console.log(`📭 ${table.padEnd(35)} ${'0'.padStart(10)} rows (EMPTY)`);
        }
      } catch (error) {
        console.log(`❌ ${table.padEnd(35)} ERROR: ${error.message.substring(0, 40)}`);
      }
    }
    
    // Get all tables with data
    console.log('\n=== All Tables with Data ===\n');
    const allTables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const tablesWithData = [];
    for (const row of allTables.rows) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM "${row.table_name}"`);
        const count = parseInt(result.rows[0].count);
        if (count > 0) {
          tablesWithData.push({ name: row.table_name, count });
        }
      } catch (e) {
        // Skip errors
      }
    }
    
    if (tablesWithData.length > 0) {
      tablesWithData.sort((a, b) => b.count - a.count);
      tablesWithData.forEach(t => {
        console.log(`${t.name.padEnd(40)} ${t.count.toString().padStart(10)} rows`);
      });
    } else {
      console.log('⚠️  NO TABLES HAVE DATA - ALL TABLES ARE EMPTY!');
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

