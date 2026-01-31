// Quick script to emit PURCHASE_CONFIRMED event
// Run inside payment-service container

const eventJson = JSON.stringify({
  type: "PURCHASE_CONFIRMED",
  timestamp: Date.now(),
  userId: "809556c1-e184-4b85-8fd6-a5f1c8014bf6",
  role: "student",
  paymentId: "d654acf9-18d0-4876-acce-cab9cecfca35",
  studentId: "809556c1-e184-4b85-8fd6-a5f1c8014bf6",
  courseId: "9e16d892-4324-4568-be60-163aa1665683",
  amountCents: 0,
  metadata: {},
  _metadata: {
    eventId: `purchase-confirmed-${Date.now()}`,
    correlationId: "d654acf9-18d0-4876-acce-cab9cecfca35",
    source: "manual-fix",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  }
});

console.log(eventJson);

