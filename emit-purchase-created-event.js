/**
 * Script to emit PURCHASE_CREATED event for an existing purchase
 * This triggers trainer allocation for purchases that were created manually
 * 
 * Usage: node emit-purchase-created-event.js <studentId> <courseId>
 */

const { createPostgresPool } = require('./shared/dist');
const { getKafkaEventBus } = require('./shared/dist/events/kafkaEventBus.js');

async function emitPurchaseCreatedEvent(studentId, courseId) {
  const pool = createPostgresPool({ max: 5 });
  const kafkaBus = getKafkaEventBus();
  
  try {
    await kafkaBus.connect();
    console.log('✅ Connected to Kafka');
    
    // Find the purchase record
    const purchaseResult = await pool.query(
      `SELECT id, student_id, course_id, purchase_tier, metadata, created_at
       FROM student_course_purchases
       WHERE student_id = $1 AND course_id = $2 AND is_active = true
       ORDER BY created_at DESC
       LIMIT 1`,
      [studentId, courseId]
    );
    
    if (purchaseResult.rows.length === 0) {
      console.error('❌ No active purchase found for student:', studentId, 'course:', courseId);
      process.exit(1);
    }
    
    const purchase = purchaseResult.rows[0];
    const purchaseId = purchase.id;
    const purchaseTier = purchase.purchase_tier || 30;
    const metadata = purchase.metadata 
      ? (typeof purchase.metadata === 'string' ? JSON.parse(purchase.metadata) : purchase.metadata)
      : {};
    
    console.log('📦 Found purchase:', {
      purchaseId,
      studentId: purchase.student_id,
      courseId: purchase.course_id,
      purchaseTier,
      metadataKeys: Object.keys(metadata),
    });
    
    // Create PURCHASE_CREATED event
    const purchaseCreatedEvent = {
      type: 'PURCHASE_CREATED',
      timestamp: Date.now(),
      userId: studentId,
      role: 'student',
      purchaseId,
      studentId,
      courseId,
      purchaseTier,
      metadata,
    };
    
    // Emit to Kafka
    const correlationId = purchaseId; // Use purchase ID as correlation ID
    await kafkaBus.emit(purchaseCreatedEvent, {
      eventId: `purchase-created-${purchaseId}-${Date.now()}`,
      correlationId,
      source: 'manual-script',
      version: '1.0.0',
    });
    
    console.log('✅ PURCHASE_CREATED event emitted successfully!');
    console.log('   Event ID:', `purchase-created-${purchaseId}-${Date.now()}`);
    console.log('   Correlation ID:', correlationId);
    console.log('   Purchase ID:', purchaseId);
    console.log('\n📋 The allocation worker should now process this event and allocate a trainer.');
    
  } catch (error) {
    console.error('❌ Error emitting PURCHASE_CREATED event:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
    await kafkaBus.disconnect();
    process.exit(0);
  }
}

// Get command line arguments
const studentId = process.argv[2];
const courseId = process.argv[3];

if (!studentId || !courseId) {
  console.error('Usage: node emit-purchase-created-event.js <studentId> <courseId>');
  console.error('Example: node emit-purchase-created-event.js 401ca863-4543-4b3e-9bc6-c8ad49a77a03 9e16d892-4324-4568-be60-163aa1665683');
  process.exit(1);
}

emitPurchaseCreatedEvent(studentId, courseId);
