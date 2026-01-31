# Push Notification Debugging Guide

## Issue: Notifications appear in-app but not on device

### Checklist

1. **Check Backend Logs** when sending a notification:
   ```
   Look for these log messages:
   - "📤 Attempting to send push notification to user..."
   - "📱 Found X active device token(s) for user..."
   - "📱 Sending notification to X trainer/student device(s) using channel: ..."
   - "✅ Sent push notification to X device(s)"
   - "❌ Failed to send..." (if errors occur)
   ```

2. **Verify FCM Service is Initialized**:
   - Check backend startup logs for: "✅ FCM Service initialized with HTTP v1 API"
   - If you see "⚠️ FCM Service Account Email not configured", set `FIREBASE_SERVICE_ACCOUNT_EMAIL` in `.env`

3. **Check Device Token Registration**:
   - Open mobile app and check logs for: "✅ Device token registered with backend successfully"
   - Verify the token includes the `role` field (student or trainer)

4. **Verify Notification Channels Exist**:
   - On Android, notification channels must exist before FCM can display notifications
   - Channels are created when the app starts (in `usePushNotifications` hook)
   - If the app was never opened after the role-aware update, channels might not exist

### Common Issues

#### Issue 1: FCM Service Not Initialized
**Symptoms**: Backend logs show "⚠️ FCM Service not initialized, skipping push notification"

**Solution**:
1. Set `FIREBASE_SERVICE_ACCOUNT_EMAIL` in backend `.env`
2. Run `gcloud auth application-default login`
3. Restart backend service

#### Issue 2: No Device Tokens Found
**Symptoms**: Backend logs show "⚠️ No device tokens found for user..."

**Solution**:
1. Make sure user is logged in on mobile app
2. Check mobile app logs for device token registration
3. Verify the user ID matches between app and backend

#### Issue 3: Device Tokens Don't Have Role
**Symptoms**: Notifications sent but using wrong channel

**Solution**:
1. Re-login on mobile app to re-register device token with role
2. Check device token in database has `role` field set

#### Issue 4: Notification Channels Don't Exist
**Symptoms**: FCM sends successfully but notification doesn't appear

**Solution**:
1. Open the mobile app (this creates the channels)
2. Close and reopen the app to ensure channels are created
3. Check Android notification settings to see if channels exist

### Testing Steps

1. **Send a test notification**:
   ```bash
   node test-notification.js <userId> "Test" "Testing push notification"
   ```

2. **Check backend logs** for the messages listed above

3. **Check mobile device**:
   - If app is open: Check if notification appears in notification panel
   - If app is closed: Check if notification appears when received
   - Check Android notification settings for the app

4. **Verify channels exist**:
   - Open Android Settings → Apps → Your App → Notifications
   - You should see "Student Notifications" and "Trainer Notifications" channels

### Next Steps

If notifications still don't appear:
1. Check backend logs for FCM API errors
2. Verify FCM credentials are correct
3. Check if device token is valid (not expired/invalid)
4. Ensure notification permissions are granted on device

