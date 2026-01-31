# Getting Started Guide - Backend Setup

This guide will help you set up and run the Koding Caravan backend on your local machine after cloning the repository.

## 📋 Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** >= 18.0.0 ([Download](https://nodejs.org/))
- **pnpm** >= 8.0.0 ([Installation Guide](https://pnpm.io/installation))
- **Docker** & **Docker Compose** ([Download](https://www.docker.com/products/docker-desktop))
- **Git** (for cloning the repository)

### Verify Prerequisites

```bash
# Check Node.js version
node --version  # Should be >= 18.0.0

# Check pnpm version
pnpm --version  # Should be >= 8.0.0

# Check Docker
docker --version
docker-compose --version
```

## 🚀 Step-by-Step Setup

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd React-Expo-set/kc-backend
```

### Step 2: Install Dependencies

Install pnpm globally if you haven't already:

```bash
npm install -g pnpm
```

Install all project dependencies (this will install dependencies for the root workspace and all services):

```bash
pnpm install
```

**Note:** This may take a few minutes as it installs dependencies for all microservices.

### Step 3: Configure Environment Variables

Copy the environment template file to create your `.env` file:

```bash
cp env.template .env
```

Open `.env` in your text editor and configure the following critical settings:

#### Required Configuration

1. **JWT Secrets** (must be at least 32 characters):
   ```env
   JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters-long
   JWT_REFRESH_SECRET=your-super-secret-refresh-key-minimum-32-characters-long
   ```

2. **Database Passwords**:
   ```env
   POSTGRES_PASSWORD=postgres
   ```

3. **Redis Configuration**:
   - The template includes an Upstash Redis URL (cloud Redis) which should work out of the box
   - For local Redis, comment out `REDIS_URL` and use:
     ```env
     REDIS_HOST=localhost
     REDIS_PORT=6379
     REDIS_PASSWORD=
     ```

#### Optional Configuration

- **AWS S3** (if using file uploads): Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
- **SMTP** (for email notifications): Configure email service credentials
- **Razorpay** (for payments): Update payment gateway keys if needed

### Step 4: Start Infrastructure Services

Start all required infrastructure services (PostgreSQL, MongoDB, Redis, Kafka, MinIO) using Docker Compose:

```bash
docker-compose up -d
```

This command will:
- Start PostgreSQL database on port 5432
- Start MongoDB on port 27017
- Start Redis on port 6379
- Start Kafka and Zookeeper on port 9092
- Start MinIO (S3-compatible storage) on ports 9000 and 9001

#### Verify Infrastructure is Running

```bash
# Check status of all containers
docker-compose ps

# Check logs if needed
docker-compose logs postgres
docker-compose logs mongodb
docker-compose logs redis
```

All services should show as "healthy" or "Up" status.

### Step 5: Build Shared Package

The shared package must be built before starting any services, as all services depend on it:

```bash
pnpm --filter @kodingcaravan/shared build
```

This compiles the shared TypeScript code that contains utilities, types, database connections, and middleware used by all microservices.

### Step 6: Start All Backend Services

Start all microservices in development mode:

```bash
pnpm dev
```

This command will:
- Build the shared package if not already built
- Start all 11 microservices in parallel:
  - API Gateway (port 3000)
  - Student Auth Service (port 3001)
  - Trainer Auth Service (port 3002)
  - Student Service (port 3003)
  - Trainer Service (port 3004)
  - Course Service (port 3005)
  - Notification Service (port 3006)
  - Payment Service (port 3007)
  - Chat Service (port 3008)
  - Analytics Service (port 3009)
  - Admin Service (port 3010)

**Note:** The first startup may take a minute or two as TypeScript compiles all services.

### Step 7: Verify Services are Running

After starting services, verify they're running correctly:

```bash
# Check service health endpoints
pnpm check-services
```

Or manually check the API Gateway:

```bash
# Using curl
curl http://localhost:3000/health

# Or open in browser
# http://localhost:3000/health
```

## 🎯 Quick Start Summary

Here's the complete sequence of commands:

```bash
# 1. Navigate to backend directory
cd kc-backend

# 2. Install dependencies
pnpm install

# 3. Setup environment
cp env.template .env
# Edit .env with your configuration

# 4. Start infrastructure
docker-compose up -d

# 5. Build shared package
pnpm --filter @kodingcaravan/shared build

# 6. Start all services
pnpm dev
```

## 🛠️ Running Individual Services

If you want to run a specific service instead of all services:

```bash
# Using pnpm filter
pnpm --filter @kodingcaravan/api-gateway dev

# Using Nx
nx serve api-gateway
nx serve student-service
nx serve course-service
# ... etc
```

## 📊 Service Ports

| Service | Port | Health Check |
|---------|------|--------------|
| API Gateway | 3000 | http://localhost:3000/health |
| Student Auth Service | 3001 | http://localhost:3001/health |
| Trainer Auth Service | 3002 | http://localhost:3002/health |
| Student Service | 3003 | http://localhost:3003/health |
| Trainer Service | 3004 | http://localhost:3004/health |
| Course Service | 3005 | http://localhost:3005/health |
| Notification Service | 3006 | http://localhost:3006/health |
| Payment Service | 3007 | http://localhost:3007/health |
| Chat Service | 3008 | http://localhost:3008/health |
| Analytics Service | 3009 | http://localhost:3009/health |
| Admin Service | 3010 | http://localhost:3010/health |

## 🔧 Common Issues & Troubleshooting

### Issue: Port Already in Use

**Error:** `EADDRINUSE: address already in use`

**Solution:**
- Find and stop the process using the port:
  ```bash
  # Windows PowerShell
  netstat -ano | findstr :3000
  taskkill /PID <PID> /F
  
  # Linux/Mac
  lsof -ti:3000 | xargs kill -9
  ```
- Or change the port in `.env` file

### Issue: Docker Services Not Starting

**Error:** Docker containers fail to start

**Solution:**
```bash
# Check Docker is running
docker ps

# Check logs
docker-compose logs

# Restart services
docker-compose down
docker-compose up -d
```

### Issue: Database Connection Failed

**Error:** `ECONNREFUSED` or database connection errors

**Solution:**
1. Verify Docker services are running: `docker-compose ps`
2. Check database credentials in `.env`
3. Wait a few seconds for databases to fully initialize
4. Test connection:
   ```bash
   # PostgreSQL
   docker-compose exec postgres pg_isready
   
   # MongoDB
   docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"
   
   # Redis
   docker-compose exec redis redis-cli ping
   ```

### Issue: Shared Package Build Fails

**Error:** TypeScript compilation errors in shared package

**Solution:**
```bash
# Clean and rebuild
cd shared
rm -rf dist node_modules
cd ..
pnpm install
pnpm --filter @kodingcaravan/shared build
```

### Issue: pnpm Command Not Found

**Solution:**
```bash
# Install pnpm globally
npm install -g pnpm

# Or use npx
npx pnpm install
```

### Issue: Services Start But API Calls Fail

**Solution:**
1. Check that API Gateway is running: `curl http://localhost:3000/health`
2. Verify all required services are running: `pnpm check-services`
3. Check service logs for errors
4. Ensure environment variables are correctly set in `.env`

## 📚 Next Steps

Once your backend is running:

1. **Test API Endpoints**: Use Postman or curl to test API endpoints
   - See `POSTMAN_EXAMPLES/` directory in the mobile app folder for examples
   - API Gateway is accessible at `http://localhost:3000`

2. **Review Documentation**:
   - [SETUP.md](./SETUP.md) - Detailed setup guide
   - [docs/architecture.md](./docs/architecture.md) - System architecture
   - [docs/api-specs.md](./docs/api-specs.md) - API documentation

3. **Database Setup** (Optional):
   ```bash
   # Run migrations
   ./scripts/migrate.sh
   
   # Seed database
   ./scripts/seed-db.sh
   ```

4. **Connect Mobile App**: Update the mobile app's API base URL to `http://localhost:3000`

## 🛑 Stopping Services

To stop all services:

```bash
# Stop backend services (Ctrl+C in the terminal running pnpm dev)

# Stop infrastructure
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

## 📞 Need Help?

- Check existing documentation in `docs/` directory
- Review [SETUP.md](./SETUP.md) for detailed configuration
- Check service logs for specific error messages
- Verify all prerequisites are installed correctly

---

**Happy Coding! 🚀**

