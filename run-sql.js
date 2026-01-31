const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/kodingcaravan',
});

async function runSQL() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    const sql = fs.readFileSync('simple-fix.sql', 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        console.log('Executing statement...');
        console.log('SQL:', statement.trim());
        const result = await client.query(statement.trim());
        if (result.rows && result.rows.length > 0) {
          console.log('Results:', result.rows.length, 'rows');
          console.table(result.rows);
        } else {
          console.log('Statement executed successfully');
        }
        console.log('');
      }
    }
    
    console.log('âœ… SQL script executed successfully!');
    
  } catch (error) {
    console.error('âŒ Error:', error.message);
  } finally {
    await client.end();
  }
}

runSQL();
