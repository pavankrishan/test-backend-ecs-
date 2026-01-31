# 🚀 Render Deployment Guide for Koding Caravan Backend

This guide will help you deploy the Koding Caravan backend to Render.

## 📋 Prerequisites

1. A Render account (sign up at https://render.com)
2. Your backend code pushed to a Git repository (GitHub, GitLab, or Bitbucket)
3. Cloud database credentials (PostgreSQL, MongoDB, Redis)

## 🎯 Quick Deployment Steps

### Option 1: Using render.yaml (Recommended)

1. **Connect your repository to Render**
   - Go to Render Dashboard → New → Blueprint
   - Connect your Git repository
   - Render will automatically detect `render.yaml`

2. **Configure Environment Variables**
   After the service is created, go to Environment tab and add:

   **Required Variables:**
   ```bash
   # JWT Secrets (generate strong random strings, min 32 chars)
   JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
   JWT_ACCESS_SECRET=your-access-secret-minimum-32-characters
   JWT_REFRESH_SECRET=your-refresh-secret-minimum-32-characters
   
   # Database URLs
   POSTGRES_URL=postgresql://user:password@host:5432/database?sslmode=require
   MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/database
   REDIS_URL=rediss://default:password@host:6379
   
   # CORS (add your frontend URLs, comma-separated)
   CORS_ORIGIN=https://your-frontend.com,https://www.your-frontend.com
   
   # Optional: Payment Gateway
   RAZORPAY_KEY_ID=your-razorpay-key
   RAZORPAY_KEY_SECRET=your-razorpay-secret
   
   # Optional: Google Maps API
   GOOGLE_MAPS_API_KEY=your-google-maps-api-key
   
   # Optional: Firebase (for push notifications)
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_PRIVATE_KEY=your-private-key
   FIREBASE_CLIENT_EMAIL=your-client-email
   ```

3. **Deploy**
   - Render will automatically deploy when you push to your main branch
   - Or manually trigger a deploy from the Render dashboard

### Option 2: Manual Setup

1. **Create a Web Service**
   - Go to Render Dashboard → New → Web Service
   - Connect your Git repository
   - Select the `kc-backend` directory as root directory

2. **Configure Build Settings**
   ```
   Build Command:
   npm install -g pnpm@8.15.0 && pnpm install --frozen-lockfile && pnpm --filter @kodingcaravan/shared build && pnpm build
   
   Start Command:
   node scripts/start-production.js
   ```

3. **Set Environment Variables** (same as Option 1)

4. **Deploy**

## 🔧 Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for JWT signing (min 32 chars) | `your-super-secret-jwt-key-minimum-32-characters-long` |
| `JWT_ACCESS_SECRET` | Secret for access tokens | `your-access-secret-minimum-32-characters` |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens | `your-refresh-secret-minimum-32-characters` |
| `POSTGRES_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/db` |
| `REDIS_URL` | Redis connection string | `rediss://default:pass@host:6379` |
| `CORS_ORIGIN` | Allowed frontend origins | `https://your-app.com,https://www.your-app.com` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `LOG_LEVEL` | Logging level | `info` |
| `RAZORPAY_KEY_ID` | Razorpay API key | - |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret | - |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key | - |
| `FIREBASE_PROJECT_ID` | Firebase project ID | - |
| `FIREBASE_PRIVATE_KEY` | Firebase private key | - |
| `FIREBASE_CLIENT_EMAIL` | Firebase client email | - |
| `SMTP_HOST` | SMTP server host | - |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASS` | SMTP password | - |

## 🗄️ Database Setup

### PostgreSQL

You can use:
- **Render Managed PostgreSQL**: Create from Render dashboard
- **External PostgreSQL**: Supabase, Neon, AWS RDS, etc.

**Connection String Format:**
```
postgresql://username:password@host:5432/database?sslmode=require
```

### MongoDB

You can use:
- **MongoDB Atlas**: Recommended (free tier available)
- **Render Managed MongoDB**: If available

**Connection String Format:**
```
mongodb+srv://username:password@cluster.mongodb.net/database
```

### Redis

You can use:
- **Render Managed Redis**: Create from Render dashboard
- **Upstash**: Recommended for production (free tier available)
- **Redis Cloud**: Alternative option

**Connection String Format:**
```
rediss://default:password@host:6379
```

## 🔍 Health Check

The API Gateway exposes a health check endpoint:

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "api-gateway"
}
```

## 🚨 Troubleshooting

### Build Fails

1. **Check pnpm version**: Ensure `pnpm@8.15.0` is installed
2. **Check Node version**: Render uses Node 18+ by default
3. **Check build logs**: Look for TypeScript compilation errors

### Services Not Starting

1. **Check environment variables**: Ensure all required variables are set
2. **Check database connectivity**: Verify database URLs are correct
3. **Check logs**: View service logs in Render dashboard

### Database Connection Errors

1. **SSL Mode**: Ensure `?sslmode=require` is in PostgreSQL URL
2. **Firewall**: Whitelist Render's IP addresses in your database
3. **Credentials**: Double-check username and password

### CORS Errors

1. **Add frontend URL**: Add your frontend URL to `CORS_ORIGIN`
2. **Format**: Use comma-separated values: `https://app1.com,https://app2.com`
3. **Wildcard**: You can use `*` for development (not recommended for production)

## 📊 Service Architecture

All services run on the same Render instance:

- **API Gateway** (Port 3000) - Public entry point
- **Student Auth Service** (Port 3001)
- **Trainer Auth Service** (Port 3002)
- **Student Service** (Port 3003)
- **Trainer Service** (Port 3004)
- **Course Service** (Port 3005)
- **Notification Service** (Port 3006)
- **Payment Service** (Port 3007)
- **Chat Service** (Port 3008)
- **Analytics Service** (Port 3009)
- **Admin Service** (Port 3010)

The API Gateway proxies requests to the appropriate service based on the route.

## 🔄 Deployment Workflow

1. **Push to main branch** → Automatic deployment
2. **Render builds** → Installs dependencies, builds all services
3. **Render starts** → All services start in parallel
4. **Health check** → Render monitors `/health` endpoint

## 💰 Cost Optimization

- **Starter Plan**: Good for development/testing ($7/month)
- **Standard Plan**: Recommended for production ($25/month)
- **Pro Plan**: For high traffic ($85/month)

**Tips:**
- Use external databases (Supabase, MongoDB Atlas free tiers)
- Use Upstash Redis (free tier available)
- Monitor resource usage in Render dashboard

## 🔐 Security Best Practices

1. **Never commit `.env` files** to Git
2. **Use strong JWT secrets** (minimum 32 characters, random)
3. **Enable SSL/TLS** for all database connections
4. **Restrict CORS** to specific domains
5. **Rotate secrets** regularly
6. **Use environment variables** for all sensitive data

## 📞 Support

If you encounter issues:

1. Check Render logs: Dashboard → Your Service → Logs
2. Check service health: `GET /health`
3. Review environment variables
4. Check database connectivity

## 🎉 Success!

Once deployed, your API will be available at:
```
https://your-service-name.onrender.com
```

Test it:
```bash
curl https://your-service-name.onrender.com/health
```

Happy deploying! 🚀

