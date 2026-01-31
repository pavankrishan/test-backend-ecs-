/**
 * Test MongoDB Connection
 * Run with: node test-mongo-connection.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

console.log('Testing MongoDB Connection...\n');
console.log('MONGO_URI:', MONGO_URI ? MONGO_URI.replace(/:[^:@]+@/, ':****@') : 'NOT SET');
console.log('MONGO_DB_NAME:', process.env.MONGO_DB_NAME || 'NOT SET');
console.log('\nAttempting connection...\n');

mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  maxPoolSize: 10,
  retryWrites: true,
  w: 'majority',
})
  .then(() => {
    console.log('✅ MongoDB connection successful!');
    console.log('Connected to:', mongoose.connection.name);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ MongoDB connection failed!');
    console.error('Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  });

