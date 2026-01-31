# Course Purchase Flows Analysis

## Overview
Yes, there are **2 different flows** for creating course purchases in the codebase:

1. **Payment Service Flow** (Automatic - triggered after payment)
2. **Course Service Flow** (Direct API endpoint)

## Flow 1: Payment Service → Course Service (Automatic)

### Path
```
Payment Confirmation → Payment Service → Course Service API
```

### Location
- **File**: `kc-backend/services/payment-service/src/services/payment.service.ts`
- **Function**: `createCoursePurchase()`
- **Called from**: `confirmPayment()` after successful payment

### Flow Details
1. **Trigger**: When payment is confirmed successfully
2. **Process**:
   - Payment service extracts `purchaseTier` or `sessionCount` from payment metadata
   - Makes HTTP POST request to course-service: `/api/v1/purchases`
   - Includes metadata with payment details
   - Handles retries if creation fails

3. **Code Location**:
```typescript
// In payment.service.ts, line ~257
async function createCoursePurchase(
  studentId: string, 
  courseId: string, 
  paymentMetadata?: Record<string, unknown>
): Promise<void> {
  const courseServiceUrl = process.env.COURSE_SERVICE_URL || 
    `http://${process.env.SERVICES_HOST || 'localhost'}:${process.env.COURSE_SERVICE_PORT || 3005}`;
  
  const purchaseUrl = `${courseServiceUrl}/api/v1/purchases`;
  
  const response = await httpPost(purchaseUrl, {
    studentId: studentId,
    courseId: courseId,
    purchaseTier: validTier,
    expiryDate: paymentMetadata?.expiryDate || undefined,
    metadata: purchaseMetadata,
  }, { timeout: 10000 });
}
```

### When Used
- **Primary flow**: After successful payment confirmation
- **Automatic**: Triggered automatically, no manual intervention needed
- **Includes**: Full payment metadata (timeSlot, date, isSundayOnly, etc.)

---

## Flow 2: Course Service Direct API (Manual/Direct)

### Path
```
Client/Frontend → Course Service API → Database
```

### Location
- **File**: `kc-backend/services/course-service/src/controllers/courseStructure.controller.ts`
- **Endpoint**: `POST /api/v1/purchases`
- **Service**: `CourseStructureService.createPurchase()`

### Flow Details
1. **Trigger**: Direct API call from frontend or admin
2. **Process**:
   - Receives purchase data directly
   - Creates purchase record in database
   - Initializes student access based on purchase tier

3. **Code Location**:
```typescript
// In courseStructure.controller.ts
createPurchase = async (req: Request, res: Response) => {
  const data: CreatePurchaseInput = {
    studentId: req.body.studentId,
    courseId: req.body.courseId,
    purchaseTier: req.body.purchaseTier,
    expiryDate: req.body.expiryDate,
    metadata: req.body.metadata,
  };
  const purchase = await this.courseStructureService.createPurchase(data);
  return successResponse(res, {
    statusCode: 201,
    message: 'Purchase created successfully',
    data: purchase,
  });
};
```

### When Used
- **Manual creation**: Admin scripts, testing, manual fixes
- **Direct access**: When bypassing payment flow
- **Scripts**: `createCoursePurchase.ts` uses this endpoint

---

## Comparison

| Aspect | Flow 1 (Payment Service) | Flow 2 (Course Service Direct) |
|--------|-------------------------|-------------------------------|
| **Trigger** | Automatic (after payment) | Manual/Direct API call |
| **Source** | Payment confirmation | Frontend/Admin/Scripts |
| **Metadata** | Full payment metadata | Provided in request |
| **Use Case** | Normal purchase flow | Manual fixes, testing |
| **Error Handling** | Retry queue | Direct error response |
| **Idempotency** | Handles 409 conflicts | Standard create |

---

## Potential Issues

### 1. **Duplicate Creation Risk**
If both flows are triggered for the same purchase:
- Payment service creates purchase automatically
- If frontend also calls course service directly → duplicate purchase
- **Mitigation**: Course service deactivates existing purchases before creating new one

### 2. **Metadata Consistency**
- Payment service flow includes full payment metadata
- Direct API call might miss some metadata fields
- **Impact**: Sunday-only sessions, time slots might not be set correctly

### 3. **Race Conditions**
- If payment service and direct API are called simultaneously
- Both might try to create purchase
- **Mitigation**: Database constraints and deactivation logic

---

## Recommendations

### 1. **Consolidate to Single Flow**
- Make payment service flow the **primary** flow
- Use direct API only for:
  - Admin fixes
  - Testing
  - Manual corrections

### 2. **Add Idempotency**
- Both flows should check for existing active purchase
- Return existing purchase if found (idempotent)

### 3. **Metadata Validation**
- Ensure both flows accept and store the same metadata structure
- Validate required fields (isSundayOnly, sessionDuration, timeSlot)

### 4. **Documentation**
- Clearly document which flow to use when
- Add comments in code explaining the two flows

---

## Current Status

✅ **Both flows are functional**
✅ **Both create purchases correctly**
⚠️ **Need to ensure metadata consistency**
⚠️ **Should document when to use which flow**

---

## Files Involved

1. **Payment Service Flow**:
   - `kc-backend/services/payment-service/src/services/payment.service.ts`
   - Function: `createCoursePurchase()` (line ~257)
   - Called from: `confirmPayment()` (line ~162)

2. **Course Service Flow**:
   - `kc-backend/services/course-service/src/controllers/courseStructure.controller.ts`
   - Method: `createPurchase()` 
   - Service: `kc-backend/services/course-service/src/services/courseStructure.service.ts`
   - Method: `createPurchase()` (line ~431)

3. **Routes**:
   - `kc-backend/services/course-service/src/routes/courseStructure.routes.ts`
   - Route: `POST /api/v1/purchases` (line 35)

