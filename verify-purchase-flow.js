// Verify purchase exists and API returns it
const { Pool } = require('pg');
const http = require('http');

const POSTGRES_URL = process.env.POSTGRES_URL;
const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

const pool = new Pool({
  connectionString: POSTGRES_URL,
  ssl: POSTGRES_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
});

async function checkDatabase() {
  console.log('=== Database Check ===\n');
  
  // Check purchase
  const purchase = await pool.query(
    `SELECT id, student_id, course_id, purchase_tier, is_active, created_at 
     FROM student_course_purchases 
     WHERE student_id = $1 AND course_id = $2 AND is_active = true`,
    [studentId, courseId]
  );
  
  if (purchase.rows.length > 0) {
    console.log('✅ Purchase EXISTS in database:');
    console.log('   ID:', purchase.rows[0].id);
    console.log('   Tier:', purchase.rows[0].purchase_tier);
    console.log('   Active:', purchase.rows[0].is_active);
    console.log('   Created:', purchase.rows[0].created_at);
    return true;
  } else {
    console.log('❌ NO purchase found in database');
    return false;
  }
}

function testAPI() {
  return new Promise((resolve, reject) => {
    console.log('\n=== API Test ===\n');
    
    const options = {
      hostname: 'localhost',
      port: 3005,
      path: `/api/v1/students/${studentId}/courses/${courseId}/purchase`,
      method: 'GET'
    };
    
    http.get(options, (res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            console.log('✅ API returns purchase:');
            console.log('   Purchase ID:', data.data?.id || 'N/A');
            console.log('   Tier:', data.data?.purchaseTier || 'N/A');
            resolve(true);
          } catch (e) {
            console.log('❌ Invalid JSON response:', body.substring(0, 200));
            resolve(false);
          }
        } else {
          console.log('❌ API returned error:', body.substring(0, 200));
          resolve(false);
        }
      });
    }).on('error', (e) => {
      console.error('❌ API request failed:', e.message);
      reject(e);
    });
  });
}

async function testLearningAPI() {
  return new Promise((resolve, reject) => {
    console.log('\n=== Learning Data API Test ===\n');
    
    const options = {
      hostname: 'localhost',
      port: 3002,
      path: `/api/v1/students/${studentId}/learning`,
      method: 'GET'
    };
    
    http.get(options, (res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        console.log('Status:', res.statusCode);
        if (res.statusCode === 200) {
          try {
            const data = JSON.parse(body);
            const courses = data.data?.courses || [];
            console.log(`Found ${courses.length} courses in learning data`);
            const targetCourse = courses.find((c: any) => c.id === courseId || c.courseId === courseId);
            if (targetCourse) {
              console.log('✅ Course found in learning data!');
              console.log('   Course ID:', targetCourse.id || targetCourse.courseId);
              console.log('   Has purchase:', !!targetCourse.purchase);
              resolve(true);
            } else {
              console.log('❌ Course NOT found in learning data');
              console.log('   Available course IDs:', courses.map((c: any) => c.id || c.courseId).slice(0, 5));
              resolve(false);
            }
          } catch (e) {
            console.log('❌ Invalid JSON:', body.substring(0, 200));
            resolve(false);
          }
        } else {
          console.log('❌ API error:', body.substring(0, 200));
          resolve(false);
        }
      });
    }).on('error', (e) => {
      console.error('❌ Request failed:', e.message);
      reject(e);
    });
  });
}

async function main() {
  try {
    const hasPurchase = await checkDatabase();
    
    if (hasPurchase) {
      await testAPI();
      await testLearningAPI();
    } else {
      console.log('\n⚠️  Purchase does not exist - need to create it first');
    }
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();

