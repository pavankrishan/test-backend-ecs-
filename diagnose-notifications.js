/**
 * Diagnostic script to check notification setup
 *
 * Usage:
 *   node diagnose-notifications.js <userId>     — full diagnostic for one user
 *   node diagnose-notifications.js list-recent  — list last 20 notifications in DB (to see which userId has "Session Scheduled")
 */

// Load environment variables (try multiple methods)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available, try loading .env manually
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=:#]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    });
  }
}

const mongoose = require('mongoose');
const { Types } = require('mongoose');

// Define schemas
const DeviceTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
  deviceName: String,
  appVersion: String,
  isActive: { type: Boolean, default: true, index: true },
  lastUsedAt: Date,
}, { timestamps: true, collection: 'device_tokens' });

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  title: String,
  message: String,
  type: String,
  read: Boolean,
}, { timestamps: true, collection: 'notifications' });

const DeviceToken = mongoose.models.DeviceToken || mongoose.model('DeviceToken', DeviceTokenSchema);
const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);

const arg = process.argv[2];

if (!arg) {
  console.error('❌ Error: userId or list-recent is required');
  console.log('\nUsage: node diagnose-notifications.js <userId>');
  console.log('       node diagnose-notifications.js list-recent');
  process.exit(1);
}

const isListRecent = arg === 'list-recent' || arg === '--list-recent';
const userId = isListRecent ? null : arg;

async function listRecent() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || process.env.DATABASE_URL || 'mongodb://localhost:27017/kodingcaravan';
  const dbName = process.env.MONGO_DB_NAME || process.env.MONGODB_DB_NAME || 'kodingcaravan';
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    dbName,
  });
  console.log(`   Using database: ${dbName}\n`);
  const limit = 20;
  const notifications = await Notification.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  console.log(`\n📋 Last ${notifications.length} notifications in MongoDB (any user):\n`);
  if (notifications.length === 0) {
    console.log('   No notifications in DB yet.\n');
    await mongoose.disconnect();
    return;
  }
  notifications.forEach((n, i) => {
    const uid = n.userId ? (n.userId.toString ? n.userId.toString() : String(n.userId)) : '?';
    console.log(`   ${i + 1}. userId: ${uid}`);
    console.log(`      title: ${n.title || '(none)'}`);
    console.log(`      createdAt: ${n.createdAt}`);
    console.log('');
  });
  console.log('💡 Run full diagnostic with a userId from above: node diagnose-notifications.js <userId>\n');
  await mongoose.disconnect();
}

async function diagnose() {
  console.log('🔍 Notification System Diagnostic\n');
  console.log('='.repeat(50));
  
  try {
    // 1. Check MongoDB connection
    // Try multiple environment variable names (cloud services use different names)
    const mongoUri = process.env.MONGO_URI 
      || process.env.MONGODB_URI 
      || process.env.MONGODB_CONNECTION_STRING
      || process.env.DATABASE_URL
      || 'mongodb://localhost:27017/kodingcaravan';
    const dbName = process.env.MONGO_DB_NAME || process.env.MONGODB_DB_NAME || 'kodingcaravan';
    
    console.log(`\n1️⃣  Connecting to MongoDB...`);
    const maskedUri = mongoUri.replace(/(:\/\/)([^:]+):([^@]+)@/, '$1***:***@');
    console.log(`   URI: ${maskedUri}`);
    console.log(`   Database: ${dbName}`);
    console.log(`   Using: ${process.env.MONGO_URI ? 'MONGO_URI' : process.env.MONGODB_URI ? 'MONGODB_URI' : process.env.MONGODB_CONNECTION_STRING ? 'MONGODB_CONNECTION_STRING' : process.env.DATABASE_URL ? 'DATABASE_URL' : 'default'}`);
    
    await mongoose.connect(mongoUri, { 
      serverSelectionTimeoutMS: 10000, // 10 seconds for cloud
      connectTimeoutMS: 10000,
      dbName,
    });
    console.log('   ✅ Connected to MongoDB\n');
    
    // 2. Convert UUID to ObjectId
    console.log('2️⃣  Converting User ID...');
    let userObjectId;
    if (userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const hexString = userId.replace(/-/g, '').substring(0, 24);
      const paddedHex = hexString.padEnd(24, '0');
      userObjectId = new Types.ObjectId(paddedHex);
      console.log(`   ✅ UUID converted to ObjectId: ${userObjectId}\n`);
    } else if (Types.ObjectId.isValid(userId)) {
      userObjectId = new Types.ObjectId(userId);
      console.log(`   ✅ Valid ObjectId: ${userObjectId}\n`);
    } else {
      console.log(`   ❌ Invalid user ID format\n`);
      process.exit(1);
    }
    
    // 3. Check device tokens
    console.log('3️⃣  Checking Device Tokens...');
    const tokens = await DeviceToken.find({ userId: userObjectId, isActive: true }).lean();
    const allTokens = await DeviceToken.find({ userId: userObjectId }).lean();
    
    if (tokens.length === 0) {
      console.log('   ❌ No active device tokens found!');
      console.log(`   ℹ️  Total tokens (including inactive): ${allTokens.length}`);
      console.log('\n   💡 SOLUTION:');
      console.log('      1. Open the mobile app');
      console.log('      2. Log in with this user account');
      console.log('      3. Check app logs for: "✅ Device token registered with backend successfully"');
      console.log('      4. Check backend logs for device token registration\n');
    } else {
      console.log(`   ✅ Found ${tokens.length} active device token(s):\n`);
      tokens.forEach((token, index) => {
        console.log(`   Token ${index + 1}:`);
        console.log(`     - Platform: ${token.platform}`);
        console.log(`     - Device: ${token.deviceName || 'Unknown'}`);
        console.log(`     - Token: ${token.token.substring(0, 30)}...`);
        console.log(`     - Created: ${token.createdAt}`);
        console.log('');
      });
    }
    
    // 4. Check recent notifications
    console.log('4️⃣  Checking Recent Notifications...');
    const recentNotifications = await Notification.find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    
    if (recentNotifications.length === 0) {
      console.log('   ⚠️  No notifications found for this user (in-app list will be empty until notifications are created)\n');
    } else {
      console.log(`   ✅ Found ${recentNotifications.length} recent notification(s):\n`);
      recentNotifications.forEach((notif, index) => {
        console.log(`   Notification ${index + 1}:`);
        console.log(`     - Title: ${notif.title}`);
        console.log(`     - Type: ${notif.type}`);
        console.log(`     - Read: ${notif.read ? 'Yes' : 'No'}`);
        console.log(`     - Created: ${notif.createdAt}`);
        console.log('');
      });
    }
    
    // 5. Check Firebase configuration
    console.log('5️⃣  Checking Firebase Configuration...');
    const firebaseConfig = {
      FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? 'Set (hidden)' : undefined,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
      FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? 'Set (hidden)' : undefined,
    };
    
    const hasFirebaseConfig = Object.values(firebaseConfig).some(v => v !== undefined);
    
    if (!hasFirebaseConfig) {
      console.log('   ❌ Firebase configuration not found!');
      console.log('\n   💡 SOLUTION:');
      console.log('      Add one of these to your .env file:');
      console.log('      1. FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json');
      console.log('      2. FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}');
      console.log('      3. FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
      console.log('\n      See kc-backend/FCM_SETUP.md for details\n');
    } else {
      console.log('   ✅ Firebase environment variables found');
      if (firebaseConfig.FIREBASE_SERVICE_ACCOUNT_PATH) {
        console.log(`     - Using service account file: ${firebaseConfig.FIREBASE_SERVICE_ACCOUNT_PATH}`);
      } else if (firebaseConfig.FIREBASE_SERVICE_ACCOUNT_JSON) {
        console.log('     - Using service account JSON from env');
      } else {
        console.log(`     - Using individual env vars (Project: ${firebaseConfig.FIREBASE_PROJECT_ID})`);
      }
      console.log('\n   ⚠️  Check backend logs to verify Firebase Admin SDK initialized');
      console.log('      Look for: "✅ Firebase Admin initialized from..."\n');
    }
    
    // 6. Check notification-service reachability (worker uses this to create in-app notifications)
    console.log('6️⃣  Checking Notification Service (worker → in-app list)...');
    const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL
      || process.env.NOTIFICATION_SERVICE_INTERNAL_URL
      || 'http://localhost:3006';
    const healthUrl = `${notificationServiceUrl.replace(/\/$/, '')}/health`;
    let notificationServiceReachable = false;
    try {
      const http = require(healthUrl.startsWith('https') ? 'https' : 'http');
      const res = await new Promise((resolve, reject) => {
        const req = http.get(healthUrl, { timeout: 5000 }, resolve);
        req.on('error', reject);
      });
      const ok = res && res.statusCode === 200;
      if (ok) {
        notificationServiceReachable = true;
        console.log(`   ✅ Notification service reachable at ${notificationServiceUrl}`);
        console.log('      (Worker uses this to store notifications so in-app list shows them)\n');
      } else {
        console.log(`   ⚠️  Notification service returned ${res?.statusCode || 'no response'} at ${healthUrl}\n`);
      }
    } catch (err) {
      console.log(`   ❌ Cannot reach notification service at ${healthUrl}`);
      console.log(`      Error: ${err.message || err}`);
      console.log('\n   💡 SOLUTION:');
      console.log('      - If using Docker: ensure notification-service is running and NOTIFICATION_SERVICE_URL=http://notification-service:3006 for the worker');
      console.log('      - If running locally: start notification-service (port 3006) or set NOTIFICATION_SERVICE_URL\n');
    }

    // 7. Check notification-worker / Kafka config (needed for push + in-app list)
    console.log('7️⃣  Checking Notification Worker / Kafka config...');
    const kafkaBrokers = process.env.KAFKA_BROKERS;
    const workerServiceUrl = process.env.NOTIFICATION_SERVICE_URL || process.env.NOTIFICATION_SERVICE_INTERNAL_URL;
    if (!kafkaBrokers) {
      console.log('   ⚠️  KAFKA_BROKERS not set — notification-worker will not consume events');
      console.log('      Session-scheduled (and other) notifications need the worker to run and consume from Kafka\n');
    } else {
      console.log(`   ✅ KAFKA_BROKERS set (${kafkaBrokers.split(',')[0]}...)`);
      if (workerServiceUrl) {
        console.log(`   ✅ NOTIFICATION_SERVICE_URL/INTERNAL set — worker can call notification-service\n`);
      } else {
        console.log('   ⚠️  NOTIFICATION_SERVICE_URL not set for worker — worker may fall back to MongoDB-only insert\n');
      }
    }

    // 8. Summary and recommendations
    console.log('='.repeat(50));
    console.log('\n📋 SUMMARY & RECOMMENDATIONS:\n');
    
    const issues = [];
    const recommendations = [];
    
    if (tokens.length === 0) {
      issues.push('No device tokens registered');
      recommendations.push('Log in to the mobile app to register device token');
    }
    
    if (!hasFirebaseConfig) {
      issues.push('Firebase configuration missing');
      recommendations.push('Configure Firebase credentials in .env file');
    }

    if (!notificationServiceReachable) {
      issues.push('Notification service not reachable (in-app list may be empty)');
      recommendations.push('Start notification-service and ensure notification-worker can reach it (NOTIFICATION_SERVICE_URL)');
    }

    if (!kafkaBrokers) {
      issues.push('KAFKA_BROKERS not set — notification-worker cannot process events');
      recommendations.push('Set KAFKA_BROKERS and run notification-worker so push + in-app notifications are created');
    }

    if (kafkaBrokers && !workerServiceUrl) {
      recommendations.push('Set NOTIFICATION_SERVICE_URL for notification-worker (e.g. http://localhost:3006 or http://notification-service:3006 in Docker) so in-app list gets notifications');
    }
    
    if (issues.length === 0) {
      console.log('✅ All checks passed! Notifications should work (push + in-app list).');
      console.log('\n💡 If push works but in-app list is empty:');
      console.log('   1. Run this diagnostic from the same env as the worker (same NOTIFICATION_SERVICE_URL)');
      console.log('   2. Check notification-worker logs for "Notification created via notification-service" (good) or "storing in MongoDB only" (fallback)');
      console.log('   3. Ensure app sends userId in GET /api/v1/notifications (same user as the one who received the push)\n');
    } else {
      console.log('❌ Issues found:');
      issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
      console.log('\n💡 Recommendations:');
      recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 MongoDB connection failed. Make sure MongoDB is running.');
    }
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

if (isListRecent) {
  listRecent().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
  });
} else {
  diagnose();
}

