/**
 * Test FCM Service Initialization
 * This script tests if FCM service can initialize without errors
 */

require('dotenv').config();

const { GoogleAuth } = require('google-auth-library');

async function testFCMInit() {
  console.log('\n🧪 Testing FCM Service Initialization...\n');
  console.log('==========================================\n');

  // Check environment variables
  console.log('1️⃣  Checking environment variables...');
  const projectId = process.env.FIREBASE_PROJECT_ID || 'kodingcaravan-c1a5f';
  const serviceAccountEmail = process.env.FIREBASE_SERVICE_ACCOUNT_EMAIL;

  if (!serviceAccountEmail) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_EMAIL not found in .env');
    console.log('\n💡 Add to kc-backend/.env:');
    console.log('   FIREBASE_SERVICE_ACCOUNT_EMAIL=firebase-adminsdk-...@kodingcaravan-c1a5f.iam.gserviceaccount.com');
    console.log('\n   Get it from: Firebase Console → Project Settings → Cloud Messaging → Service account');
    process.exit(1);
  }

  console.log(`   ✅ FIREBASE_PROJECT_ID: ${projectId}`);
  console.log(`   ✅ FIREBASE_SERVICE_ACCOUNT_EMAIL: ${serviceAccountEmail}`);

  // Test Google Auth initialization
  console.log('\n2️⃣  Testing Google Auth initialization...');
  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
      projectId: projectId,
    });

    console.log('   ✅ GoogleAuth created successfully');

    // Test getting access token
    console.log('\n3️⃣  Testing access token retrieval...');
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (tokenResponse.token) {
      console.log('   ✅ Access token retrieved successfully!');
      console.log(`   Token preview: ${tokenResponse.token.substring(0, 20)}...`);
    } else {
      console.error('   ❌ Failed to get access token');
      console.log('\n💡 SOLUTION: Set up Application Default Credentials');
      console.log('   Run: gcloud auth application-default login');
      console.log('   Or run: .\\install-gcloud.ps1');
      process.exit(1);
    }

    console.log('\n✅ FCM Service initialization test PASSED!');
    console.log('\n🚀 Your backend should be able to send notifications now!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart your backend: pnpm dev');
    console.log('   2. Check logs for: "✅ FCM Service initialized with HTTP v1 API"');
    console.log('   3. Test notifications: node test-notification.js YOUR_USER_ID');
    console.log('');

  } catch (error) {
    console.error('\n❌ FCM Service initialization test FAILED!');
    console.error(`   Error: ${error.message}`);

    if (error.message.includes('Could not load the default credentials')) {
      console.log('\n💡 SOLUTION: Set up Application Default Credentials');
      console.log('   Option 1: Run the setup script:');
      console.log('      .\\install-gcloud.ps1');
      console.log('\n   Option 2: Manual setup:');
      console.log('      1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install');
      console.log('      2. Run: gcloud auth login');
      console.log('      3. Run: gcloud auth application-default login');
      console.log('      4. Run: gcloud config set project kodingcaravan-c1a5f');
    } else if (error.message.includes('ENOENT') || error.message.includes('not found')) {
      console.log('\n💡 SOLUTION: Install gcloud CLI');
      console.log('   Download from: https://cloud.google.com/sdk/docs/install');
      console.log('   Or run: .\\install-gcloud.ps1');
    }

    console.log('\n📄 See: kc-backend/FCM_V1_SETUP.md for full instructions\n');
    process.exit(1);
  }
}

testFCMInit().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});

