// Script to manually emit PURCHASE_CONFIRMED event for a payment
// Usage: node fix-missing-purchase.js <paymentId>

const { Pool } = require('pg');
const { Kafka } = require('kafkajs');

const paymentId = process.argv[2] || 'd654acf9-18d0-4876-acce-cab9cecfca35';
const studentId = '809556c1-e184-4b85-8fd6-a5f1c8014bf6';
const courseId = '9e16d892-4324-4568-be60-163aa1665683';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'kodingcaravan',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
});

const kafka = new Kafka({
  clientId: 'fix-missing-purchase-script',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();

async function emitPurchaseConfirmed() {
  try {
    // Get payment details
    const paymentResult = await pool.query(
      'SELECT id, student_id, amount_cents, metadata FROM payments WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      console.error('Payment not found:', paymentId);
      process.exit(1);
    }

    const payment = paymentResult.rows[0];
    console.log('Found payment:', payment);

    // Check if event already processed
    const processedCheck = await pool.query(
      'SELECT 1 FROM processed_events WHERE correlation_id = $1 AND event_type = $2',
      [paymentId, 'PURCHASE_CONFIRMED']
    );

    if (processedCheck.rows.length > 0) {
      console.log('Event already processed, skipping...');
      process.exit(0);
    }

    // Create event
    const eventId = `purchase-confirmed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const event = {
      type: 'PURCHASE_CONFIRMED',
      timestamp: Date.now(),
      userId: studentId,
      role: 'student',
      paymentId: paymentId,
      studentId: studentId,
      courseId: courseId,
      amountCents: payment.amount_cents,
      metadata: payment.metadata || {},
    };

    // Mark as processed in database (idempotency)
    await pool.query(
      `INSERT INTO processed_events (event_id, event_type, correlation_id, payload, source, version, processed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (correlation_id, event_type) DO NOTHING`,
      [
        eventId,
        'PURCHASE_CONFIRMED',
        paymentId,
        JSON.stringify(event),
        'fix-missing-purchase-script',
        '1.0.0',
      ]
    );

    // Connect producer
    await producer.connect();
    console.log('Kafka producer connected');

    // Emit event to Kafka
    await producer.send({
      topic: 'purchase-confirmed',
      messages: [
        {
          key: paymentId, // Partition by payment ID
          value: JSON.stringify({
            ...event,
            _metadata: {
              eventId,
              correlationId: paymentId,
              source: 'fix-missing-purchase-script',
              version: '1.0.0',
              timestamp: new Date().toISOString(),
            },
          }),
        },
      ],
    });

    console.log('✅ PURCHASE_CONFIRMED event emitted successfully!');
    console.log('Event ID:', eventId);
    console.log('Payment ID:', paymentId);
    console.log('Student ID:', studentId);
    console.log('Course ID:', courseId);

    await producer.disconnect();
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

emitPurchaseConfirmed();

