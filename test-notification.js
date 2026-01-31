/**
 * Test script to send a push notification
 * 
 * Usage:
 *   node test-notification.js <userId> [title] [message]
 * 
 * Example:
 *   node test-notification.js be36fafb-5cfa-444e-822b-132f071f9408 "Test" "Hello from backend!"
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const userId = process.argv[2];
const title = process.argv[3] || 'Test Notification';
const message = process.argv[4] || 'This is a test push notification! 🎉';
// Valid types: 'course', 'assignment', 'achievement', 'payment', 'system'
const type = process.argv[5] || 'system';

if (!userId) {
  console.error('❌ Error: User ID is required');
  console.log('\nUsage: node test-notification.js <userId> [title] [message] [type]');
  console.log('\nValid types: course, assignment, achievement, payment, system');
  console.log('\nExample:');
  console.log('  node test-notification.js be36fafb-5cfa-444e-822b-132f071f9408');
  console.log('  node test-notification.js be36fafb-5cfa-444e-822b-132f071f9408 "Hello" "This is a test"');
  console.log('  node test-notification.js be36fafb-5cfa-444e-822b-132f071f9408 "Hello" "This is a test" "course"');
  process.exit(1);
}

async function sendTestNotification() {
  try {
    console.log(`\n📤 Sending test notification to user: ${userId}`);
    console.log(`   Title: ${title}`);
    console.log(`   Message: ${message}`);
    console.log(`   API URL: ${API_URL}\n`);

    // Create abort controller for timeout (compatible with all Node versions)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${API_URL}/api/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        title,
        message,
        type: type
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to send notification:');
      console.error('   Status:', response.status);
      console.error('   Data:', JSON.stringify(data, null, 2));
      process.exit(1);
    }
    
    console.log('✅ Notification sent successfully!');
    console.log('   Response:', JSON.stringify(data, null, 2));
    console.log('\n📱 Check your phone - you should receive the notification!');
  } catch (error) {
    console.error('❌ Failed to send notification:');
    if (error.name === 'AbortError') {
      console.error('   Request timeout. Is the backend running?');
      console.error('   URL:', API_URL);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('   Connection refused. Is the backend running?');
      console.error('   URL:', API_URL);
    } else {
      console.error('   Error:', error.message);
    }
    process.exit(1);
  }
}

sendTestNotification();

