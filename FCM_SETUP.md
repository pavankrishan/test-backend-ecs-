# Firebase Cloud Messaging (FCM) Setup Guide

This guide explains how to set up and configure Firebase Cloud Messaging (FCM) for push notifications in the Koding Caravan application.

## Prerequisites

1. A Firebase project with Cloud Messaging enabled
2. Firebase Admin SDK service account credentials
3. Expo project configured for push notifications

## Backend Setup

### 1. Get Firebase Service Account Credentials

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key**
5. Download the JSON file (keep it secure!)

### 2. Configure Environment Variables

Add one of the following to your `.env` file in `kc-backend/`:

**Option 1: Service Account File Path**
```env
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json
```

**Option 2: Service Account JSON String**
```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
```

**Option 3: Individual Environment Variables**
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> **Note:** When using `FIREBASE_PRIVATE_KEY`, make sure to include the newlines (`\n`) in the string.

### 3. Verify Installation

The notification service will automatically initialize Firebase Admin SDK on startup. Check the logs for:
- `✅ Firebase Admin initialized from ...` (success)
- `⚠️  Firebase Admin not initialized: Missing configuration` (needs configuration)

## Mobile App Setup

### 1. Configure Expo for Push Notifications

The app is already configured with `expo-notifications` plugin in `app.json` and `app.config.js`.

### 2. Get Expo Push Token

The `usePushNotifications` hook automatically:
- Requests notification permissions
- Gets the Expo push token
- Registers the token with the backend

### 3. Use the Hook

```typescript
import { usePushNotifications } from '@/services/notifications/usePushNotifications';

function MyComponent() {
  const { expoPushToken, notification, isRegistered, error } = usePushNotifications();

  // Token is automatically registered with backend when user is logged in
  // Handle incoming notifications
  useEffect(() => {
    if (notification) {
      console.log('Received notification:', notification);
      // Navigate or show UI based on notification data
    }
  }, [notification]);

  return (
    <View>
      {error && <Text>Error: {error}</Text>}
      {isRegistered && <Text>Push notifications enabled!</Text>}
    </View>
  );
}
```

## API Endpoints

### Device Token Management

- `POST /api/v1/device-tokens/register` - Register a device token
- `GET /api/v1/device-tokens/tokens` - Get user's device tokens
- `POST /api/v1/device-tokens/deactivate` - Deactivate a device token
- `DELETE /api/v1/device-tokens/token` - Delete a device token

### Notifications

- `GET /api/v1/notifications` - Get user notifications
- `GET /api/v1/notifications/unread-count` - Get unread count
- `POST /api/v1/notifications` - Create notification (sends push automatically)
- `POST /api/v1/notifications/bulk` - Create bulk notifications (sends push automatically)
- `PATCH /api/v1/notifications/:id/read` - Mark as read
- `PATCH /api/v1/notifications/mark-all-read` - Mark all as read
- `DELETE /api/v1/notifications/:id` - Delete notification

## How It Works

1. **User logs in** → Mobile app requests push notification permissions
2. **Token obtained** → Expo provides a push token
3. **Token registered** → Mobile app sends token to backend via `/api/v1/device-tokens/register`
4. **Notification created** → Backend creates notification in database
5. **Push sent** → Backend automatically sends push notification via FCM to all user's active device tokens
6. **User receives** → Mobile app receives notification and displays it

## Testing

### Test Push Notification

You can test push notifications using the Firebase Console or by creating a notification via API:

```bash
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "userId": "USER_ID",
    "title": "Test Notification",
    "message": "This is a test push notification",
    "type": "system"
  }'
```

### Test Device Token Registration

```bash
curl -X POST http://localhost:3000/api/v1/device-tokens/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "ios",
    "deviceName": "iPhone 14",
    "appVersion": "1.0.0"
  }'
```

## Troubleshooting

### Backend Issues

1. **Firebase not initialized**
   - Check environment variables are set correctly
   - Verify service account JSON is valid
   - Check logs for specific error messages

2. **Push notifications not sending**
   - Verify Firebase Admin SDK is initialized (check logs)
   - Check device tokens are registered and active
   - Verify user has active device tokens in database

### Mobile App Issues

1. **Permissions denied**
   - User must grant notification permissions
   - Check device settings for app permissions

2. **Token not registering**
   - Check user is logged in
   - Verify API endpoint is accessible
   - Check network connectivity

3. **Notifications not received**
   - Verify token is registered in backend
   - Check notification permissions are granted
   - Ensure app is not in background notification restrictions

## Security Notes

- **Never commit** service account JSON files to version control
- Use environment variables or secure secret management
- Device tokens are user-specific and should be protected
- Invalid tokens are automatically deactivated

## Next Steps

- Configure notification channels for Android
- Add notification categories for iOS
- Implement notification actions/buttons
- Add deep linking based on notification data
- Set up notification scheduling

