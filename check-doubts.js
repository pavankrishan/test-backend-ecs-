/**
 * Check doubts in MongoDB for a specific student
 * Usage: node check-doubts.js <studentId>
 */

require('dotenv').config();
const mongoose = require('mongoose');

const studentId = process.argv[2] || 'e723e949-436e-459c-8962-833a7e3ed509';

if (!studentId) {
  console.error('❌ Please provide a student ID');
  console.log('Usage: node check-doubts.js <studentId>');
  process.exit(1);
}

async function checkDoubts() {
  console.log('🔍 Checking Doubts in MongoDB\n');
  console.log('='.repeat(60));
  
  try {
    // Connect to MongoDB - use MONGO_URI from env
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017/kodingcaravan';
    console.log(`\n1️⃣  Connecting to MongoDB...`);
    const maskedUri = mongoUri.replace(/(:\/\/)([^:]+):([^@]+)@/, '$1***:***@');
    console.log(`   URI: ${maskedUri}`);
    
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    console.log('   ✅ Connected to MongoDB\n');
    
    // Get the doubts collection
    const db = mongoose.connection.db;
    const doubtsCollection = db.collection('doubts');
    
    console.log(`2️⃣  Searching for doubts for student: ${studentId}\n`);
    
    // Count total doubts for this student
    const totalCount = await doubtsCollection.countDocuments({ studentId });
    console.log(`   📊 Total doubts found: ${totalCount}\n`);
    
    if (totalCount === 0) {
      console.log('   ⚠️  No doubts found for this student\n');
      
      // Check if collection exists and has any data
      const allDoubtsCount = await doubtsCollection.countDocuments({});
      console.log(`   📊 Total doubts in collection: ${allDoubtsCount}\n`);
      
      if (allDoubtsCount > 0) {
        // Get a sample doubt to see the structure
        const sampleDoubt = await doubtsCollection.findOne({});
        console.log('   📝 Sample doubt structure:');
        console.log('      StudentId:', sampleDoubt?.studentId);
        console.log('      Subject:', sampleDoubt?.subject);
        console.log('      Status:', sampleDoubt?.status);
        console.log('      Created:', sampleDoubt?.createdAt);
        console.log('');
        
        // Check if there are doubts with similar IDs
        console.log('   🔍 Searching for doubts with similar studentId...');
        const similarDoubts = await doubtsCollection.find({
          studentId: { $regex: studentId.substring(0, 8), $options: 'i' }
        }).limit(5).toArray();
        
        if (similarDoubts.length > 0) {
          console.log(`   Found ${similarDoubts.length} doubts with similar IDs:`);
          similarDoubts.forEach((d, i) => {
            console.log(`      ${i + 1}. studentId: ${d.studentId}, subject: ${d.subject}, status: ${d.status}`);
          });
        }
      }
    } else {
      // Get all doubts for this student
      const doubts = await doubtsCollection.find({ studentId })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
      
      console.log(`   ✅ Found ${doubts.length} doubt(s):\n`);
      
      doubts.forEach((doubt, index) => {
        console.log(`   ${index + 1}. Doubt ID: ${doubt._id}`);
        console.log(`      Subject: ${doubt.subject || 'N/A'}`);
        console.log(`      Topic: ${doubt.topic || 'N/A'}`);
        console.log(`      Status: ${doubt.status || 'N/A'}`);
        console.log(`      StudentId: ${doubt.studentId}`);
        console.log(`      TrainerId: ${doubt.trainerId || 'Not assigned'}`);
        console.log(`      Created: ${doubt.createdAt || 'N/A'}`);
        console.log(`      Updated: ${doubt.updatedAt || 'N/A'}`);
        console.log(`      Question (preview): ${(doubt.question || '').substring(0, 100)}${doubt.question?.length > 100 ? '...' : ''}`);
        console.log('');
      });
      
      // Group by status
      const statusCounts = await doubtsCollection.aggregate([
        { $match: { studentId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      
      console.log('   📊 Doubts by status:');
      statusCounts.forEach(stat => {
        console.log(`      ${stat._id}: ${stat.count}`);
      });
      console.log('');
    }
    
    // Close connection
    await mongoose.connection.close();
    console.log('✅ Connection closed\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

checkDoubts();