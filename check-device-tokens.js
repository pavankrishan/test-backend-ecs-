/**
 * Check device tokens for a user
 * 
 * Usage:
 *   node check-device-tokens.js <userId>
 * 
 * Make sure to set MONGO_URI environment variable or it will use default
 */

// Load environment variables from .env file
require('dotenv').config();

const mongoose = require('mongoose');
const { Types } = require('mongoose');

// Define DeviceToken schema inline (simplified version)
const DeviceTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  token: { type: String, required: true, unique: true },
  platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
  deviceName: String,
  appVersion: String,
  isActive: { type: Boolean, default: true, index: true },
  lastUsedAt: Date,
}, { timestamps: true, collection: 'device_tokens' });

const DeviceToken = mongoose.models.DeviceToken || mongoose.model('DeviceToken', DeviceTokenSchema);

const userId = process.argv[2];

if (!userId) {
  console.error('❌ Error: User ID is required');
  console.log('\nUsage: node check-device-tokens.js <userId>');
  process.exit(1);
}

async function checkDeviceTokens() {
  try {
    // Connect to MongoDB - use MONGO_URI from env or default
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || process.env.DATABASE_URL || 'mongodb://localhost:27017/kodingcaravan';
    console.log(`🔌 Connecting to MongoDB: ${mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}...\n`);
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000, // 5 second timeout
    });
    console.log('✅ Connected to MongoDB\n');
    
    // Convert UUID to ObjectId (same logic as in service)
    let userObjectId;
    if (userId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const hexString = userId.replace(/-/g, '').substring(0, 24);
      const paddedHex = hexString.padEnd(24, '0');
      userObjectId = new Types.ObjectId(paddedHex);
    } else if (Types.ObjectId.isValid(userId)) {
      userObjectId = new Types.ObjectId(userId);
    } else {
      console.error('❌ Invalid user ID format');
      process.exit(1);
    }
    
    console.log(`🔍 Searching for device tokens for user: ${userId}`);
    console.log(`   Converted ObjectId: ${userObjectId}\n`);
    
    // Find active tokens
    const tokens = await DeviceToken.find({
      userId: userObjectId,
      isActive: true
    }).lean();
    
    if (tokens.length === 0) {
      console.log('❌ No active device tokens found for this user!');
      console.log('\n💡 Possible reasons:');
      console.log('  1. User is not logged in to the app');
      console.log('  2. Device token registration failed');
      console.log('  3. User ID mismatch (UUID conversion issue)');
      console.log('\n📋 To fix:');
      console.log('  1. Make sure user is logged in to the app');
      console.log('  2. Check app logs for: "✅ Device token registered with backend successfully"');
      console.log('  3. Check backend logs for device token registration');
      
      // Check for inactive tokens
      const allTokens = await DeviceToken.find({
        userId: userObjectId
      }).lean();
      
      if (allTokens.length > 0) {
        console.log(`\nℹ️  Found ${allTokens.length} inactive token(s) for this user`);
      }
    } else {
      console.log(`✅ Found ${tokens.length} active device token(s):\n`);
      tokens.forEach((token, index) => {
        console.log(`Token ${index + 1}:`);
        console.log(`  - Token: ${token.token.substring(0, 20)}...`);
        console.log(`  - Platform: ${token.platform}`);
        console.log(`  - Device: ${token.deviceName || 'Unknown'}`);
        console.log(`  - Active: ${token.isActive}`);
        console.log(`  - Last Used: ${token.lastUsedAt || 'Never'}`);
        console.log(`  - Created: ${token.createdAt}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('ObjectId')) {
      console.error('\n💡 The user ID might not be converting correctly to ObjectId');
    } else if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 MongoDB connection failed. Make sure:');
      console.error('  1. MongoDB is running');
      console.error('  2. MONGO_URI environment variable is set correctly');
      console.error('  3. Connection string is valid');
    }
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('\n✅ Disconnected from MongoDB');
    }
  }
}

checkDeviceTokens();

