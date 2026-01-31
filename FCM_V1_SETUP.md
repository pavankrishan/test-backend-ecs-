# FCM HTTP v1 API Setup

The **notification-service** sends push notifications via **FCM HTTP v1 API**. Configure FCM using **one** of the options below. The service tries them in this order: credentials file → env vars → Application Default Credentials.

**Important:** `FIREBASE_PROJECT_ID` must match your mobile app’s Firebase project (e.g. `mapskc` from `kc-mobileapp/google-services.json`, or `kodingcaravan-c1a5f`).

See also: `kc-backend/services/notification-service/.env.example`

---

## Option 1: Service Account JSON File (recommended for production)

1. In [Firebase Console](https://console.firebase.google.com/) → your project → **Project Settings** (gear) → **Service accounts**.
2. Click **Generate new private key** and save the JSON file securely.
3. In `kc-backend/.env`:

```env
FIREBASE_PROJECT_ID=mapskc
GOOGLE_APPLICATION_CREDENTIALS=C:/path/to/your-service-account-key.json
```

Use an absolute path. On Docker, mount the file and set the path inside the container.

---

## Option 2: Credentials from Environment (Docker / CI)

Use when you can’t mount a file (e.g. Docker, serverless). Put the **private key** and **client email** from the service account JSON into env.

Add to `kc-backend/.env`:

```env
FIREBASE_PROJECT_ID=mapskc
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_LINES\n-----END PRIVATE KEY-----\n"
```

- Get `client_email` and `private_key` from the same JSON you’d use for Option 1.
- Keep the quotes and use `\n` for newlines in `FIREBASE_PRIVATE_KEY`.

---

## Option 3: Application Default Credentials (no key file)

Uses **FCM HTTP v1 API** with OAuth2 (no service account JSON if you use gcloud).

### Get Service Account Email

1. [Firebase Console](https://console.firebase.google.com/) → your project (e.g. **mapskc** or **kodingcaravan-c1a5f**).
2. **Project Settings** (gear) → **Cloud Messaging** → **Service account**.
3. Copy the **Service Account Email**.

### Configure env

Add to `kc-backend/.env`:

```env
FIREBASE_PROJECT_ID=mapskc
FIREBASE_SERVICE_ACCOUNT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
```

### Set up gcloud Application Default Credentials

1. Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (or `winget install Google.CloudSDK` on Windows).
2. Log in and set ADC:

   ```bash
   gcloud auth login
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

`google-auth-library` will then use these credentials automatically.

## How It Works

The FCM service (in **notification-service**) will:

1. Try **GOOGLE_APPLICATION_CREDENTIALS** (path to JSON) first.
2. If not set or invalid, try **FIREBASE_PRIVATE_KEY** + **FIREBASE_CLIENT_EMAIL** (or **FIREBASE_SERVICE_ACCOUNT_EMAIL**).
3. Otherwise use **Application Default Credentials** (gcloud or GCP metadata).
4. Send notifications via FCM HTTP v1 API: `https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`.

## Install & Run

```bash
cd kc-backend
pnpm install
pnpm dev
```

Check logs for one of:

- ✅ `FCM: Initialized with GOOGLE_APPLICATION_CREDENTIALS`
- ✅ `FCM: Initialized with FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL`
- ✅ `FCM: Initialized with Application Default Credentials`

## Test Notifications

After the notification-service is running, trigger a notification (e.g. from admin or mobile app) or call the notification API with a valid `userId` that has a registered device token.

## Running Without FCM (Optional)

To run the notification-service **without** FCM (e.g. in Docker when Firebase isn't set up yet), set:

```env
FCM_OPTIONAL=true
```

or `SKIP_FCM=true`. The service will start; push notifications will be skipped until FCM credentials are configured. Docker Compose sets `FCM_OPTIONAL=true` by default so the stack can start without Firebase.

## Troubleshooting

### "FCM not configured"
- Set one of: **GOOGLE_APPLICATION_CREDENTIALS**, or **FIREBASE_PRIVATE_KEY** + **FIREBASE_CLIENT_EMAIL**, or **FIREBASE_SERVICE_ACCOUNT_EMAIL** + gcloud ADC.
- See `kc-backend/services/notification-service/.env.example`.

### "Failed to get access token"
- For Option 1: ensure the JSON path is correct and the file is readable.
- For Option 2: ensure **FIREBASE_PRIVATE_KEY** has real newlines (use `\n` in env) and is quoted.
- For Option 3: run `gcloud auth application-default login` and set the correct project.

### "FCM Service not initialized"
- Check notification-service logs for the exact error.
- Ensure **FIREBASE_PROJECT_ID** matches your Firebase project (e.g. `mapskc` for the mobile app).

## Benefits of FCM v1 API

✅ **Flexible auth** – JSON file, env vars, or gcloud ADC  
✅ **OAuth2 tokens** – Secured, auto-refreshed  
✅ **Modern API** – Latest FCM features  
✅ **Better errors** – Clearer failure messages  

