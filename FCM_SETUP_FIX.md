# FCM Push Notification Setup Fix

## Problem
Push notifications are not being sent to mobile devices because FCM Service is not initialized.

## Root Cause
Application Default Credentials are not configured for Google Cloud authentication.

## Solution (Choose One)

### Option 1: Use gcloud CLI (Recommended)

1. **Complete the browser authentication** (if browser opened):
   - Complete the login in your browser
   - Grant all required permissions

2. **Set the project**:
   ```bash
   gcloud config set project kodingcaravan-c1a5f
   ```

3. **Verify credentials**:
   ```bash
   gcloud auth application-default print-access-token
   ```
   Should return an access token (long string)

4. **Restart backend service**

### Option 2: Use Service Account JSON File

1. **Download service account key**:
   - Go to Firebase Console → Project Settings → Service Accounts
   - Click "Generate New Private Key"
   - Save the JSON file (e.g., `firebase-service-account.json`)

2. **Add to backend `.env`**:
   ```env
   GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
   ```
   (Use full path if file is in different location)

3. **Restart backend service**

## Verify Fix

After setting up credentials, check backend startup logs for:
```
✅ FCM Service initialized with HTTP v1 API
   Project ID: kodingcaravan-c1a5f
   Service Account: firebase-adminsdk-fbsvc@kodingcaravan-c1a5f.iam.gserviceaccount.com
   Using: Application Default Credentials
```

## Test

Send a test notification:
```bash
node test-notification.js <userId> "Test" "Testing push notification"
```

Check backend logs for:
```
📤 Attempting to send push notification to user...
📱 Found X active device token(s) for user...
📱 Sending notification to X trainer/student device(s) using channel: ...
✅ Sent push notification to X device(s)
```

## Troubleshooting

If you still see "⚠️ FCM Service not initialized":
1. Check `.env` file has `FIREBASE_SERVICE_ACCOUNT_EMAIL` set
2. Verify credentials are configured (run `node check-fcm-status.js`)
3. Check backend startup logs for FCM initialization errors
4. Restart backend service after fixing credentials

