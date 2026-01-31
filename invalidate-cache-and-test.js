// Script to invalidate cache and test API
const http = require('http');

const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

// Step 1: Invalidate cache
console.log('=== Step 1: Invalidating Cache ===');
const invalidateOptions = {
  hostname: 'localhost',
  port: 3002,
  path: `/api/v1/students/${studentId}/invalidate-cache`,
  method: 'POST',
};

http.request(invalidateOptions, (res) => {
  let body = '';
  res.on('data', (d) => { body += d.toString(); });
  res.on('end', () => {
    console.log('Cache invalidation status:', res.statusCode);
    console.log('Response:', body);
    console.log('');
    
    // Step 2: Test learning API
    console.log('=== Step 2: Testing Learning API ===');
    http.get(`http://localhost:3002/api/v1/students/${studentId}/learning`, (res) => {
      let body = '';
      res.on('data', (d) => { body += d.toString(); });
      res.on('end', () => {
        console.log('Learning API status:', res.statusCode);
        try {
          const data = JSON.parse(body);
          const courses = data.data?.courses || [];
          console.log('Courses found:', courses.length);
          
          const target = courses.find(c => 
            (c.id || c.courseId) === courseId
          );
          
          if (target) {
            console.log('\n✅ Target course FOUND in learning data');
            console.log('Course ID:', target.id || target.courseId);
            console.log('Has purchase:', !!target.purchase);
            
            if (target.purchase) {
              console.log('Purchase ID:', target.purchase.id);
              if (target.purchase.metadata) {
                const m = target.purchase.metadata;
                console.log('Metadata keys:', Object.keys(m).join(', '));
                console.log('startDate:', m.startDate || m.schedule?.startDate);
                console.log('timeSlot:', m.timeSlot || m.schedule?.timeSlot);
                console.log('classTypeId:', m.classTypeId);
                console.log('scheduleType:', m.scheduleType);
                console.log('sessionCount:', m.sessionCount);
              }
            } else {
              console.log('❌ No purchase object in course data');
            }
          } else {
            console.log('\n❌ Target course NOT in learning data');
            console.log('Available course IDs:', courses.slice(0, 5).map(c => c.id || c.courseId));
          }
        } catch (e) {
          console.log('Parse error:', e.message);
          console.log('Raw response (first 500 chars):', body.substring(0, 500));
        }
      });
    }).on('error', (e) => {
      console.error('Learning API error:', e.message);
    });
  });
}).on('error', (e) => {
  console.error('Cache invalidation error:', e.message);
}).end();

