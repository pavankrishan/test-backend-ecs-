/**
 * Script to check why push notifications aren't being delivered
 * 
 * Usage:
 *   node check-push-notification.js <userId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

const userId = process.argv[2];

if (!userId) {
  console.error('❌ Error: User ID is required');
  console.log('\nUsage: node check-push-notification.js <userId>');
  process.exit(1);
}

async function checkPushNotification() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kodingcaravan';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Define DeviceToken schema
    const DeviceTokenSchema = new mongoose.Schema({}, { strict: false, collection: 'device_tokens' });
    const DeviceToken = mongoose.models.DeviceToken || mongoose.model('DeviceToken', DeviceTokenSchema);

    // Convert userId to ObjectId (handle UUID format)
    let userObjectId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userObjectId = new mongoose.Types.ObjectId(userId);
    } else {
      // Handle UUID format
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidPattern.test(userId)) {
        const hexString = userId.replace(/-/g, '').substring(0, 24);
        userObjectId = new mongoose.Types.ObjectId(hexString);
      } else {
        throw new Error('Invalid userId format');
      }
    }

    console.log(`🔍 Checking device tokens for user: ${userId}`);
    console.log(`   ObjectId: ${userObjectId}\n`);

    // Find device tokens
    const deviceTokens = await DeviceToken.find({
      userId: userObjectId,
      isActive: true,
    }).lean();

    if (deviceTokens.length === 0) {
      console.log('❌ No active device tokens found!');
      console.log('\n💡 Possible reasons:');
      console.log('   1. User hasn\'t logged in on the mobile app');
      console.log('   2. Device token registration failed');
      console.log('   3. Device tokens were deactivated');
      console.log('\n📱 To fix:');
      console.log('   1. Open the mobile app');
      console.log('   2. Make sure you\'re logged in');
      console.log('   3. Check app logs for "✅ Device token registered with backend successfully"');
      process.exit(1);
    }

    console.log(`✅ Found ${deviceTokens.length} active device token(s):\n`);

    deviceTokens.forEach((token, index) => {
      console.log(`📱 Device Token ${index + 1}:`);
      console.log(`   Token: ${token.token.substring(0, 30)}...`);
      console.log(`   Platform: ${token.platform || 'unknown'}`);
      console.log(`   Role: ${token.role || '❌ NOT SET (defaults to student)'}`);
      console.log(`   Device: ${token.deviceName || 'Unknown'}`);
      console.log(`   App Version: ${token.appVersion || 'Unknown'}`);
      console.log(`   Last Used: ${token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString() : 'Never'}`);
      console.log(`   Created: ${token.createdAt ? new Date(token.createdAt).toLocaleString() : 'Unknown'}`);
      console.log('');
    });

    // Check FCM service initialization
    console.log('🔍 Checking FCM Service Status:\n');
    const fcmInitialized = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL ? '✅ Configured' : '❌ Not configured';
    console.log(`   Service Account Email: ${fcmInitialized}`);
    console.log(`   Project ID: ${process.env.FIREBASE_PROJECT_ID || 'kodingcaravan-c1a5f'}`);
    
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL) {
      console.log('\n⚠️  FCM Service Account Email not set!');
      console.log('   Set FIREBASE_SERVICE_ACCOUNT_EMAIL in .env file');
    }

    // Summary
    console.log('\n📊 Summary:');
    console.log(`   ✅ Device tokens: ${deviceTokens.length}`);
    const tokensWithRole = deviceTokens.filter(t => t.role).length;
    console.log(`   ${tokensWithRole === deviceTokens.length ? '✅' : '⚠️ '} Tokens with role: ${tokensWithRole}/${deviceTokens.length}`);
    console.log(`   ${process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL ? '✅' : '❌'} FCM Service: ${process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL ? 'Configured' : 'Not configured'}`);

    if (tokensWithRole < deviceTokens.length) {
      console.log('\n⚠️  Some device tokens don\'t have a role set!');
      console.log('   These will default to "student" channel.');
      console.log('   Make sure the mobile app sends the role when registering tokens.');
    }

    await mongoose.disconnect();
    console.log('\n✅ Check complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('connect')) {
      console.error('\n💡 Make sure MongoDB is running and MONGODB_URI is correct in .env');
    }
    process.exit(1);
  }
}

checkPushNotification();

