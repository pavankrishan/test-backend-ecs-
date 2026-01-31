# ⚡ Quick Start: Deploy to Render in 5 Minutes

## Step 1: Prepare Your Repository

1. **Commit the deployment files** (if not already committed):
   ```bash
   git add render.yaml scripts/start-production.js RENDER_DEPLOYMENT.md
   git commit -m "Add Render deployment configuration"
   git push
   ```

## Step 2: Create Render Service

### Option A: Using Blueprint (render.yaml) - Recommended

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Blueprint**
3. Connect your Git repository
4. Render will detect `render.yaml` automatically
5. Click **Apply**

### Option B: Manual Setup

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Web Service**
3. Connect your Git repository
4. Configure:
   - **Name**: `kc-backend-api-gateway`
   - **Root Directory**: `kc-backend`
   - **Environment**: `Node`
   - **Build Command**: 
     ```
     npm install -g pnpm@8.15.0 && pnpm install --frozen-lockfile && pnpm --filter @kodingcaravan/shared build && pnpm build
     ```
   - **Start Command**: 
     ```
     node scripts/start-production.js
     ```

## Step 3: Set Environment Variables

Go to your service → **Environment** tab and add:

### Required (Minimum to start):

```bash
# JWT Secrets (generate random strings, min 32 chars each)
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long-here
JWT_ACCESS_SECRET=your-access-secret-minimum-32-characters-long-here
JWT_REFRESH_SECRET=your-refresh-secret-minimum-32-characters-long-here

# Database URLs
POSTGRES_URL=postgresql://user:password@host:5432/database?sslmode=require
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/database
REDIS_URL=rediss://default:password@host:6379

# CORS (your frontend URL)
CORS_ORIGIN=https://your-frontend.com
```

### Optional (Add as needed):

```bash
# Payment Gateway
RAZORPAY_KEY_ID=your-key
RAZORPAY_KEY_SECRET=your-secret

# Google Maps
GOOGLE_MAPS_API_KEY=your-key

# Firebase (Push Notifications)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-email
```

## Step 4: Deploy

1. Click **Manual Deploy** → **Deploy latest commit**
2. Wait for build to complete (5-10 minutes first time)
3. Check logs for any errors

## Step 5: Verify

Test your deployment:

```bash
# Health check
curl https://your-service-name.onrender.com/health

# Should return:
# {"status":"ok","timestamp":"...","service":"api-gateway"}
```

## 🎉 Done!

Your backend is now live at:
```
https://your-service-name.onrender.com
```

## 🔧 Troubleshooting

### Build Fails
- Check that `pnpm@8.15.0` is installed
- Verify all dependencies are in `package.json`
- Check build logs for TypeScript errors

### Services Not Starting
- Verify all environment variables are set
- Check database connection strings
- Review service logs in Render dashboard

### Database Connection Errors
- Ensure SSL is enabled (`?sslmode=require` for PostgreSQL)
- Whitelist Render IPs in your database firewall
- Double-check credentials

## 📚 Next Steps

- See [RENDER_DEPLOYMENT.md](./RENDER_DEPLOYMENT.md) for detailed documentation
- Set up database migrations
- Configure monitoring and alerts
- Set up CI/CD for automatic deployments

