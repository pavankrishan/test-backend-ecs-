/**
 * Script to check FCM Service status
 * 
 * Usage:
 *   node check-fcm-status.js
 */

require('dotenv').config();

console.log('\n🔍 Checking FCM Service Configuration:\n');

// Check environment variables
const projectId = process.env.FIREBASE_PROJECT_ID || 'kodingcaravan-c1a5f';
const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
const googleAppCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;

console.log('📋 Environment Variables:');
console.log(`   FIREBASE_PROJECT_ID: ${projectId}`);
console.log(`   FIREBASE_SERVICE_ACCOUNT_EMAIL: ${serviceAccountEmail || '❌ NOT SET'}`);
console.log(`   GOOGLE_APPLICATION_CREDENTIALS: ${googleAppCreds || 'Not set (using gcloud default)'}`);

if (!serviceAccountEmail) {
  console.log('\n❌ FCM Service Account Email is not configured!');
  console.log('\n💡 To fix:');
  console.log('   1. Go to Firebase Console → Project Settings → Cloud Messaging');
  console.log('   2. Copy the Service Account Email');
  console.log('   3. Add to .env: FIREBASE_SERVICE_ACCOUNT_EMAIL=<your-service-account-email>');
  console.log('   4. Restart the backend service');
  process.exit(1);
}

console.log('\n✅ FCM Service Account Email is configured');

// Check if gcloud is installed and configured
const { execSync } = require('child_process');
let gcloudInstalled = false;
let gcloudConfigured = false;

try {
  execSync('gcloud --version', { stdio: 'ignore' });
  gcloudInstalled = true;
  console.log('\n✅ gcloud CLI is installed');
  
  try {
    const authList = execSync('gcloud auth application-default print-access-token', { 
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    if (authList.trim()) {
      gcloudConfigured = true;
      console.log('✅ Application Default Credentials are configured');
    }
  } catch (e) {
    console.log('❌ Application Default Credentials are NOT configured');
    console.log('\n💡 To fix:');
    console.log('   Run: gcloud auth application-default login');
    console.log('   Then: gcloud config set project kodingcaravan-c1a5f');
  }
} catch (e) {
  console.log('\n⚠️  gcloud CLI is not installed');
  console.log('   FCM will use GOOGLE_APPLICATION_CREDENTIALS if set');
}

if (!gcloudConfigured && !googleAppCreds) {
  console.log('\n⚠️  WARNING: No authentication method configured!');
  console.log('   FCM Service will not be able to send notifications.');
  console.log('\n💡 Solutions:');
  console.log('   Option 1: Install gcloud and run: gcloud auth application-default login');
  console.log('   Option 2: Set GOOGLE_APPLICATION_CREDENTIALS to service account JSON file path');
}

console.log('\n📊 Summary:');
console.log(`   Service Account Email: ${serviceAccountEmail ? '✅' : '❌'}`);
console.log(`   gcloud CLI: ${gcloudInstalled ? '✅' : '❌'}`);
console.log(`   Application Default Credentials: ${gcloudConfigured ? '✅' : '❌'}`);
console.log(`   Service Account JSON: ${googleAppCreds ? '✅' : '❌'}`);

if (serviceAccountEmail && (gcloudConfigured || googleAppCreds)) {
  console.log('\n✅ FCM Service should be able to initialize!');
  console.log('   Check backend startup logs for: "✅ FCM Service initialized with HTTP v1 API"');
} else {
  console.log('\n❌ FCM Service will NOT be able to initialize!');
  console.log('   Fix the issues above and restart the backend service.');
}

console.log('');

