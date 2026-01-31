# 📱 Msg91 SMS Integration

## Overview

Msg91 has been successfully integrated into the notification service, providing SMS capabilities for the Koding Caravan platform. This integration allows sending SMS notifications, OTP messages, and bulk SMS to users.

## ✅ Implementation Status

- ✅ Msg91 service created in notification service
- ✅ SMS sending methods added to notification service
- ✅ SMS API endpoints created
- ✅ Shared notification client updated with SMS methods
- ✅ Configuration support added

## 📦 Components

### 1. Msg91 Service (`msg91.service.ts`)

Located at: `kc-backend/services/notification-service/src/services/msg91.service.ts`

**Features:**
- Phone number normalization (Indian format: 91XXXXXXXXXX)
- SMS sending via Msg91 API v5
- OTP SMS support
- Bulk SMS support
- Error handling with fallback to local logging
- Development mode support (logs SMS locally when not configured)

### 2. Notification Service Integration

The `NotificationService` class now includes SMS methods:
- `sendSms()` - Send a single SMS
- `sendOtpSms()` - Send OTP SMS
- `sendBulkSms()` - Send SMS to multiple recipients
- `isSmsReady()` - Check if SMS service is configured

### 3. API Endpoints

**Base URL:** `/api/notifications/sms`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/notifications/sms` | Send a single SMS |
| POST | `/api/notifications/sms/otp` | Send OTP SMS |
| POST | `/api/notifications/sms/bulk` | Send bulk SMS |
| GET | `/api/notifications/sms/status` | Check SMS service status |

## 🔧 Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Msg91 Configuration
MSG91_AUTH_KEY=your-msg91-auth-key
MSG91_SENDER=KODING
MSG91_TEMPLATE_ID=your-template-id-optional
```

**Where to get credentials:**
1. Sign up at [Msg91](https://msg91.com/)
2. Get your Auth Key from the dashboard
3. Set up a sender ID (e.g., "KODING")
4. (Optional) Create a template and get Template ID for template-based messages

### Configuration in Code

The configuration is automatically loaded from environment variables in `notificationConfig.ts`:

```typescript
if (process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER) {
  config.msg91 = {
    authKey: process.env.MSG91_AUTH_KEY,
    sender: process.env.MSG91_SENDER,
    templateId: process.env.MSG91_TEMPLATE_ID || undefined,
  };
}
```

## 📝 Usage

### 1. Using the Shared Notification Client

```typescript
import { notificationClient } from '@kodingcaravan/shared/utils/notificationClient';

// Send a simple SMS
await notificationClient.sendSms(
  '9876543210',
  'Your session has been scheduled for tomorrow at 10 AM.'
);

// Send OTP SMS
await notificationClient.sendOtpSms(
  '9876543210',
  '123456'
);

// Send bulk SMS
await notificationClient.sendBulkSms([
  { phone: '9876543210', message: 'Message 1' },
  { phone: '9876543211', message: 'Message 2' },
]);
```

### 2. Direct API Calls

**Send SMS:**
```bash
curl -X POST http://localhost:3006/api/notifications/sms \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "message": "Your session has been scheduled."
  }'
```

**Send OTP SMS:**
```bash
curl -X POST http://localhost:3006/api/notifications/sms/otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9876543210",
    "otpCode": "123456"
  }'
```

**Send Bulk SMS:**
```bash
curl -X POST http://localhost:3006/api/notifications/sms/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": [
      { "phone": "9876543210", "message": "Message 1" },
      { "phone": "9876543211", "message": "Message 2" }
    ]
  }'
```

**Check Status:**
```bash
curl http://localhost:3006/api/notifications/sms/status
```

### 3. Using in Services

**Example: Send SMS when session is scheduled**

```typescript
import { notificationClient } from '@kodingcaravan/shared/utils/notificationClient';

// In your service
async function scheduleSession(studentId: string, phone: string) {
  // ... session scheduling logic ...
  
  // Send SMS notification
  await notificationClient.sendSms(
    phone,
    `Your session has been scheduled for ${date} at ${time}.`
  );
}
```

## 🔄 Phone Number Format

The service automatically normalizes phone numbers to Indian format (91XXXXXXXXXX):

- `9876543210` → `919876543210`
- `09876543210` → `919876543210`
- `+919876543210` → `919876543210`
- `919876543210` → `919876543210` (no change)

## 🛡️ Error Handling

The Msg91 service includes robust error handling:

1. **Not Configured:** If Msg91 credentials are missing, SMS is logged locally (development mode)
2. **API Errors:** Errors are caught and logged, but don't break the main flow
3. **Network Timeouts:** 10-second timeout with graceful fallback
4. **Non-blocking:** SMS failures don't throw errors, allowing the main business logic to continue

## 🧪 Testing

### Development Mode

When Msg91 is not configured, SMS messages are logged to the console:

```
[MSG91:DEV] SMS message for 9876543210: Your message here
```

### Production Mode

1. Set up Msg91 credentials in `.env`
2. Test with a real phone number
3. Check Msg91 dashboard for delivery status

### Test Endpoints

```bash
# Test SMS service status
curl http://localhost:3006/api/notifications/sms/status

# Test sending SMS (replace with your test number)
curl -X POST http://localhost:3006/api/notifications/sms \
  -H "Content-Type: application/json" \
  -d '{"phone": "YOUR_TEST_NUMBER", "message": "Test message"}'
```

## 📊 Integration with Existing Services

### Auth Services

The auth services (student-auth-service, trainer-auth-service) already have their own Msg91 integration for OTP. The notification service integration is separate and can be used for general SMS notifications.

### Notification Flow

```
Service → NotificationClient → Notification Service → Msg91 Service → Msg91 API
```

## 🚀 Deployment

1. **Install Dependencies:**
   ```bash
   cd kc-backend/services/notification-service
   pnpm install
   ```

2. **Set Environment Variables:**
   ```env
   MSG91_AUTH_KEY=your-key
   MSG91_SENDER=KODING
   MSG91_TEMPLATE_ID=your-template-id
   ```

3. **Build and Start:**
   ```bash
   pnpm build
   pnpm start
   ```

4. **Verify:**
   - Check service health: `GET /health`
   - Check SMS status: `GET /api/notifications/sms/status`

## 📚 API Reference

### Send SMS Request

```typescript
POST /api/notifications/sms
Content-Type: application/json

{
  "phone": "9876543210",
  "message": "Your message here",
  "templateId": "optional-template-id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "SMS sent successfully",
  "data": {
    "success": true,
    "provider": "msg91",
    "messageId": "msg-id-123"
  }
}
```

### Send OTP SMS Request

```typescript
POST /api/notifications/sms/otp
Content-Type: application/json

{
  "phone": "9876543210",
  "otpCode": "123456",
  "message": "Optional custom message"
}
```

### Send Bulk SMS Request

```typescript
POST /api/notifications/sms/bulk
Content-Type: application/json

{
  "recipients": [
    { "phone": "9876543210", "message": "Message 1" },
    { "phone": "9876543211", "message": "Message 2" }
  ]
}
```

## 🔍 Monitoring

- Check service logs for SMS sending status
- Monitor Msg91 dashboard for delivery reports
- Check `/api/notifications/sms/status` endpoint for service health

## 📝 Notes

- SMS sending is non-blocking - failures won't break main business logic
- Phone numbers are automatically normalized to Indian format
- Development mode logs SMS locally when Msg91 is not configured
- Template-based messages are supported if template ID is provided
- Bulk SMS sends individually for better error handling per recipient

## 🔗 Related Files

- `kc-backend/services/notification-service/src/services/msg91.service.ts`
- `kc-backend/services/notification-service/src/services/notification.service.ts`
- `kc-backend/services/notification-service/src/controllers/notification.controller.ts`
- `kc-backend/services/notification-service/src/routes/notification.routes.ts`
- `kc-backend/shared/utils/notificationClient.ts`
- `kc-backend/services/notification-service/src/config/notificationConfig.ts`

---

**Last Updated:** December 2024  
**Status:** ✅ Complete and Ready for Use

