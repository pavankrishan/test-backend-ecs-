/**
 * MongoDB TTL Indexes Migration
 * 
 * Adds TTL indexes to MongoDB collections for automatic data expiration.
 * 
 * Usage: node migrations/022-add-mongodb-ttl-indexes.js
 * 
 * This migration adds TTL indexes to:
 * 1. notifications collection (90 days)
 * 2. device_tokens collection (30 days)
 * 3. analytics collection (1 year)
 * 4. messages collection (90 days - archive old messages)
 */

// Load environment variables
require('dotenv').config();

const { MongoClient } = require('mongodb');

/**
 * Build MongoDB connection string
 */
function buildConnectionString() {
  // Priority 1: Use MONGODB_URL or MONGO_URI
  const url = process.env.MONGODB_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
  
  if (url) {
    return url;
  }
  
  // Priority 2: Build from individual environment variables
  const host = process.env.MONGODB_HOST || process.env.MONGO_HOST || 'localhost';
  const port = process.env.MONGODB_PORT || process.env.MONGO_PORT || '27017';
  const user = process.env.MONGODB_USER || process.env.MONGO_USER || '';
  const password = process.env.MONGODB_PASSWORD || process.env.MONGO_PASSWORD || '';
  const database = process.env.MONGODB_DB_NAME || process.env.MONGO_DB || 'kodingcaravan';
  
  if (user && password) {
    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    return `mongodb://${encodedUser}:${encodedPassword}@${host}:${port}/${database}`;
  }
  
  return `mongodb://${host}:${port}/${database}`;
}

const connectionString = buildConnectionString();

if (!connectionString) {
  console.error('❌ MongoDB connection string not found!');
  console.error('   Please set MONGODB_URL or MONGODB_HOST, MONGODB_USER, MONGODB_PASSWORD, MONGODB_DB_NAME');
  process.exit(1);
}

// Extract host for display (hide password)
const hostDisplay = connectionString.split('@')[1]?.split('/')[0] || 'hidden';

console.log('🔗 MongoDB Configuration:');
console.log(`   Host: ${hostDisplay}`);
console.log(`   Database: ${process.env.MONGODB_DB_NAME || process.env.MONGO_DB || 'kodingcaravan'}\n`);

async function applyTTLIndexes() {
  let client;
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    client = new MongoClient(connectionString);
    await client.connect();
    
    console.log('✅ MongoDB connection successful!\n');
    
    const db = client.db();
    
    console.log('📊 Applying TTL indexes...\n');
    
    // 1. Notifications Collection - 90 days TTL
    console.log('1. Adding TTL index to notifications collection (90 days)...');
    try {
      await db.collection('notifications').createIndex(
        { createdAt: 1 },
        { 
          expireAfterSeconds: 90 * 24 * 60 * 60, // 90 days
          name: 'notifications_ttl_index'
        }
      );
      console.log('   ✅ TTL index created on notifications.createdAt (90 days)\n');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists, skipping\n');
      } else {
        throw error;
      }
    }
    
    // 2. Device Tokens Collection - 30 days TTL
    console.log('2. Adding TTL index to device_tokens collection (30 days)...');
    try {
      await db.collection('device_tokens').createIndex(
        { updatedAt: 1 },
        { 
          expireAfterSeconds: 30 * 24 * 60 * 60, // 30 days
          name: 'device_tokens_ttl_index'
        }
      );
      console.log('   ✅ TTL index created on device_tokens.updatedAt (30 days)\n');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists, skipping\n');
      } else {
        throw error;
      }
    }
    
    // 3. Analytics Collection - 1 year TTL
    console.log('3. Adding TTL index to analytics collection (1 year)...');
    try {
      await db.collection('analytics').createIndex(
        { timestamp: 1 },
        { 
          expireAfterSeconds: 365 * 24 * 60 * 60, // 1 year
          name: 'analytics_ttl_index'
        }
      );
      console.log('   ✅ TTL index created on analytics.timestamp (1 year)\n');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists, skipping\n');
      } else {
        throw error;
      }
    }
    
    // 4. Messages Collection - 90 days TTL (archive old messages)
    console.log('4. Adding TTL index to messages collection (90 days)...');
    try {
      await db.collection('messages').createIndex(
        { createdAt: 1 },
        { 
          expireAfterSeconds: 90 * 24 * 60 * 60, // 90 days
          name: 'messages_ttl_index'
        }
      );
      console.log('   ✅ TTL index created on messages.createdAt (90 days)\n');
    } catch (error) {
      if (error.code === 85) {
        console.log('   ⚠️  Index already exists, skipping\n');
      } else {
        throw error;
      }
    }
    
    // Verify indexes
    console.log('📋 Verifying TTL indexes...\n');
    const indexes = await db.collection('notifications').indexes();
    const ttlIndexes = indexes.filter(idx => idx.expireAfterSeconds);
    
    console.log('✅ TTL Indexes Summary:');
    console.log(`   - notifications: ${90 * 24 * 60 * 60}s (90 days)`);
    console.log(`   - device_tokens: ${30 * 24 * 60 * 60}s (30 days)`);
    console.log(`   - analytics: ${365 * 24 * 60 * 60}s (1 year)`);
    console.log(`   - messages: ${90 * 24 * 60 * 60}s (90 days)\n`);
    
    console.log('✅ All MongoDB TTL indexes applied successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Run migration
applyTTLIndexes().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
