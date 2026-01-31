// Check all tables in cloud database and their row counts
const { Pool } = require('pg');

const POSTGRES_URL = process.env.POSTGRES_URL || 'postgresql://kc_app_user:p6L8tbBxHZ2lWrzhg5wsZS1jgiVdYIla@dpg-d4iloikhg0os73a1789g-a.oregon-postgres.render.com/kc_app';

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function checkTables() {
  try {
    console.log('Connecting to cloud database...');
    console.log('Database:', POSTGRES_URL.split('@')[1]?.split('/')[1] || 'unknown');
    
    // Get all tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log(`\nFound ${tablesResult.rows.length} tables\n`);
    
    // Check row counts for each table
    const tableData = [];
    for (const row of tablesResult.rows) {
      const tableName = row.table_name;
      try {
        const countResult = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const count = parseInt(countResult.rows[0].count);
        tableData.push({ table: tableName, count });
      } catch (error) {
        tableData.push({ table: tableName, count: -1, error: error.message });
      }
    }
    
    // Sort by count (descending)
    tableData.sort((a, b) => b.count - a.count);
    
    console.log('Table Row Counts:');
    console.log('==================');
    const tablesWithData = tableData.filter(t => t.count > 0);
    const emptyTables = tableData.filter(t => t.count === 0);
    const errorTables = tableData.filter(t => t.count === -1);
    
    if (tablesWithData.length > 0) {
      console.log(`\n📊 Tables WITH data (${tablesWithData.length}):`);
      tablesWithData.forEach(t => {
        console.log(`  ${t.table.padEnd(40)} ${t.count.toString().padStart(10)} rows`);
      });
    }
    
    if (emptyTables.length > 0) {
      console.log(`\n📭 Empty tables (${emptyTables.length}):`);
      emptyTables.slice(0, 20).forEach(t => {
        console.log(`  ${t.table}`);
      });
      if (emptyTables.length > 20) {
        console.log(`  ... and ${emptyTables.length - 20} more empty tables`);
      }
    }
    
    if (errorTables.length > 0) {
      console.log(`\n❌ Tables with errors (${errorTables.length}):`);
      errorTables.forEach(t => {
        console.log(`  ${t.table}: ${t.error}`);
      });
    }
    
    // Check specific important tables
    console.log('\n\n🔍 Checking Important Tables:');
    console.log('=============================');
    
    const importantTables = [
      'student_course_purchases',
      'payments',
      'students',
      'trainers',
      'trainer_allocations',
      'tutoring_sessions',
      'courses',
      'course_phases',
      'course_levels',
      'course_sessions',
      'student_progress',
      'processed_events'
    ];
    
    for (const tableName of importantTables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const count = parseInt(result.rows[0].count);
        if (count > 0) {
          // Get sample data
          const sample = await pool.query(`SELECT * FROM ${tableName} LIMIT 3`);
          console.log(`\n✅ ${tableName}: ${count} rows`);
          if (sample.rows.length > 0) {
            console.log(`   Sample:`, JSON.stringify(sample.rows[0], null, 2).substring(0, 200));
          }
        } else {
          console.log(`\n📭 ${tableName}: 0 rows (empty)`);
        }
      } catch (error) {
        console.log(`\n❌ ${tableName}: Table does not exist or error - ${error.message}`);
      }
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

checkTables();

