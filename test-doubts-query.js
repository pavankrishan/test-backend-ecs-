require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');

// Define the Doubt Schema (must match the backend model)
const DoubtSchema = new mongoose.Schema({
  studentId: { type: String, required: true, index: true },
  trainerId: { type: String },
  subject: { type: String, required: true },
  topic: { type: String, required: true },
  question: { type: String, required: true },
  type: { type: String, enum: ['text', 'image', 'voice'], default: 'text' },
  attachments: [{ type: String }],
  status: { type: String, enum: ['pending', 'in_progress', 'answered', 'closed'], default: 'pending', index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'doubts', timestamps: true });

const Doubt = mongoose.model('Doubt', DoubtSchema);

async function testDoubtsQuery(studentId) {
  console.log('\n🧪 Testing MongoDB Doubts Query\n');
  console.log('='.repeat(60));
  console.log(`Student ID: ${studentId}\n`);

  try {
    // Get MongoDB URI from environment or command line
    const mongoUri = process.argv[3] || // Allow passing URI as 3rd argument
                     process.env.MONGO_URI || 
                     process.env.MONGODB_URI || 
                     process.env.MONGODB_CONNECTION_STRING || 
                     process.env.DATABASE_URL || 
                     'mongodb+srv://trilineum_user_db:trilineumcorp@cluster0.rwge3sb.mongodb.net/kodingcaravan?retryWrites=true&w=majority&appName=Cluster0';
    
    const maskedUri = mongoUri.replace(/(:\/\/)([^:]+):([^@]+)@/, '$1***:***@');
    console.log(`1️⃣  Connecting to MongoDB...`);
    console.log(`   URI: ${maskedUri}\n`);

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
    });
    
    console.log('   ✅ Connected successfully!\n');

    console.log(`2️⃣  Testing query: { studentId: "${studentId}" }\n`);
    
    // Test 1: Simple find
    const startTime = Date.now();
    const doubts = await Doubt.find({ studentId: studentId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .maxTimeMS(5000)
      .exec();
    const duration = Date.now() - startTime;

    console.log(`   ✅ Query executed in ${duration}ms`);
    console.log(`   ✅ Found ${doubts.length} doubts\n`);

    if (doubts.length === 0) {
      console.log('   ⚠️  No doubts found for this student ID.\n');
      
      // Test: Check if ANY doubts exist in collection
      const totalDoubts = await Doubt.countDocuments({}).maxTimeMS(5000).exec();
      console.log(`   📊 Total doubts in collection: ${totalDoubts}`);
      
      // Test: Check with different query
      const sampleDoubt = await Doubt.findOne({}).lean().maxTimeMS(5000).exec();
      if (sampleDoubt) {
        console.log(`   📋 Sample doubt studentId: ${sampleDoubt.studentId}`);
        console.log(`   📋 Sample doubt _id: ${sampleDoubt._id}`);
        console.log(`   ⚠️  Querying studentId "${studentId}" but sample has "${sampleDoubt.studentId}"`);
      }
    } else {
      console.log('   📋 Doubts found:\n');
      doubts.forEach((doubt, index) => {
        console.log(`   Doubt ${index + 1}:`);
        console.log(`     _id: ${doubt._id}`);
        console.log(`     studentId: ${doubt.studentId}`);
        console.log(`     subject: ${doubt.subject}`);
        console.log(`     topic: ${doubt.topic}`);
        console.log(`     status: ${doubt.status}`);
        console.log(`     createdAt: ${doubt.createdAt}`);
        console.log(`     question (first 100 chars): ${doubt.question.substring(0, 100)}...\n`);
      });
    }

    // Test 2: Count documents
    const countStart = Date.now();
    const count = await Doubt.countDocuments({ studentId: studentId })
      .maxTimeMS(5000)
      .exec();
    const countDuration = Date.now() - countStart;
    console.log(`3️⃣  Count query: ${count} doubts (${countDuration}ms)\n`);

    // Test 3: Check indexes
    console.log('4️⃣  Checking indexes...\n');
    const indexes = await Doubt.collection.getIndexes();
    console.log('   Indexes:', JSON.stringify(indexes, null, 2));
    console.log();

    console.log('✅ All tests completed successfully!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.name === 'MongoServerSelectionError') {
      console.error('   → MongoDB server selection failed. Check connection string and network.');
    } else if (error.name === 'MongoNetworkTimeoutError') {
      console.error('   → MongoDB network timeout. Check connection string and network.');
    } else if (error.message.includes('buffering timed out')) {
      console.error('   → MongoDB buffering timeout. Connection is not ready.');
    }
    if (error.stack) {
      console.error('   Stack:', error.stack.split('\n').slice(0, 5).join('\n'));
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

const studentId = process.argv[2] || 'e723e949-436e-459c-8962-833a7e3ed509';
testDoubtsQuery(studentId);
