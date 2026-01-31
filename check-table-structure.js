const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function checkTableStructure() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Check columns in tutoring_sessions table
    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tutoring_sessions'
      ORDER BY ordinal_position;
    `);

    console.log('Columns in tutoring_sessions table:');
    result.rows.forEach(row => {
      console.log(`- ${row.column_name}: ${row.data_type} (${row.is_nullable})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkTableStructure();
