# Quick Start Guide - Build and Run All Services

## Prerequisites

1. **Docker Desktop must be running**
   - Open Docker Desktop application
   - Wait for it to fully start (whale icon in system tray should be steady)

2. **Environment variables are configured**
   - `.env` file is present in `kc-backend` directory
   - All required variables are set (POSTGRES_URL, MONGO_URI, etc.)

## Build and Run All Services

### Option 1: Using PowerShell Script (Recommended)

```powershell
cd c:\Users\PC\Desktop\React-Expo-set\kc-backend
.\build-and-run.ps1
```

### Option 2: Manual Commands

#### Step 1: Build All Services
```powershell
cd c:\Users\PC\Desktop\React-Expo-set\kc-backend
docker compose build --parallel
```

#### Step 2: Start All Services
```powershell
# Start in foreground (see logs)
docker compose up

# OR start in background (detached mode)
docker compose up -d
```

#### Step 3: View Logs (if running in detached mode)
```powershell
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f allocation-worker
docker compose logs -f api-gateway
docker compose logs -f course-service
```

#### Step 4: Stop All Services
```powershell
# Stop services
docker compose down

# Stop and remove volumes (cleanup)
docker compose down -v
```

## Service Ports

Once services are running, they will be available at:

- **API Gateway**: http://localhost:3000
- **Student Auth**: http://localhost:3001
- **Trainer Auth**: http://localhost:3002
- **Student Service**: http://localhost:3003
- **Trainer Service**: http://localhost:3004
- **Course Service**: http://localhost:3005
- **Notification Service**: http://localhost:3006
- **Payment Service**: http://localhost:3007
- **Chat Service**: http://localhost:3008
- **Analytics Service**: http://localhost:3009
- **Admin Service**: http://localhost:3010
- **Booking Service**: http://localhost:3011

## Troubleshooting

### Docker Not Running
```
Error: Access is denied
```
**Solution**: Start Docker Desktop and wait for it to fully initialize.

### Build Fails
```
Error: POSTGRES_URL not found
```
**Solution**: This should NOT happen anymore after the fix. If it does, check that:
- `.env` file exists in `kc-backend` directory
- Build is not trying to access runtime env vars (should only need them at runtime)

### Port Already in Use
```
Error: Port 3000 is already in use
```
**Solution**: 
- Stop the service using that port
- Or change the port in `.env` file

### Services Won't Start
```
Error: Missing POSTGRES_URL
```
**Solution**: 
- Check `.env` file has `POSTGRES_URL` set
- Services should fail at runtime (not build time) if POSTGRES_URL is missing

## Useful Commands

```powershell
# Check running containers
docker compose ps

# Restart a specific service
docker compose restart allocation-worker

# View service status
docker compose ps

# Check service health
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
```

## Service Dependencies

Services start in this order:
1. **Infrastructure**: Zookeeper → Kafka → Kafka Init
2. **Core Services**: API Gateway, Auth Services
3. **Business Services**: Student, Trainer, Course, etc.
4. **Workers**: Purchase Worker, Allocation Worker, Session Worker, Cache Worker

Workers depend on:
- Kafka (for event consumption)
- Admin Service (allocation-worker needs it)
