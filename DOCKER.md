# Docker Setup for KodingCaravan Backend

This guide explains how to run the KodingCaravan backend using Docker.

**Architecture**: Each service has its own Dockerfile following strict microservice isolation. See [DOCKER_ARCHITECTURE.md](./DOCKER_ARCHITECTURE.md) for detailed architecture principles.

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- A `.env` file in the `kc-backend` directory (copy from `env.template`)

## Quick Start

1. **Create your `.env` file** (if you haven't already):
   ```bash
   cp env.template .env
   # Edit .env with your configuration
   ```

2. **Start all services** (databases + backend services):
   ```bash
   docker-compose up -d
   ```

3. **View logs**:
   ```bash
   # All services
   docker-compose logs -f
   
   # Specific service
   docker-compose logs -f api-gateway
   ```

4. **Stop all services**:
   ```bash
   docker-compose down
   ```

## Services

The docker-compose setup includes:

### Infrastructure Services
- **PostgreSQL** (port 5432) - Primary database
- **MongoDB** (port 27017) - Document database
- **Redis** (port 6379) - Caching and sessions
- **Kafka** (port 9092) - Message queue
- **Zookeeper** - Kafka coordination
- **MinIO** (ports 9000, 9001) - S3-compatible storage

### Backend Services
- **api-gateway** (port 3000) - API Gateway
- **student-auth-service** (port 3001) - Student authentication
- **trainer-auth-service** (port 3002) - Trainer authentication
- **student-service** (port 3003) - Student management
- **trainer-service** (port 3004) - Trainer management
- **course-service** (port 3005) - Course management
- **notification-service** (port 3006) - Notifications
- **payment-service** (port 3007) - Payment processing
- **chat-service** (port 3008) - Chat functionality
- **analytics-service** (port 3009) - Analytics
- **admin-service** (port 3010) - Admin operations
- **booking-service** (port 3011) - Booking management

## Building Docker Images

### Build a single service:

```bash
# From kc-backend directory
docker build -f services/api-gateway/Dockerfile -t kodingcaravan-api-gateway:latest .
```

### Build all services:

```bash
docker-compose build
```

### Generate Dockerfiles (if adding new service):

```bash
node scripts/generate-dockerfiles.js
```

## Running Individual Services

You can run a specific service using the built image:

```bash
docker run -d \
  --name api-gateway \
  --env-file .env \
  -e POSTGRES_HOST=postgres \
  -e REDIS_HOST=redis \
  -p 3000:3000 \
  kodingcaravan-api-gateway:latest
```

Each service has its own image and runs independently.

## Environment Variables

All services use environment variables from the `.env` file. Key variables:

- `NODE_ENV` - Set to `production` for Docker
- `POSTGRES_HOST` - Set to `postgres` (Docker service name)
- `MONGO_URI` - Set to `mongodb://mongodb:27017`
- `REDIS_HOST` - Set to `redis` (Docker service name)
- `KAFKA_BROKERS` - Set to `kafka:9092` (Docker service name)

## Development vs Production

### Development
For local development, you may prefer running services directly:
```bash
pnpm dev
```

### Production
For production deployment, use Docker:
```bash
docker-compose up -d
```

## Troubleshooting

### Services won't start
1. Check if ports are already in use:
   ```bash
   # Windows
   netstat -ano | findstr :3000
   
   # Linux/Mac
   lsof -i :3000
   ```

2. Check service logs:
   ```bash
   docker-compose logs <service-name>
   ```

### Database connection issues
- Ensure database services are healthy:
  ```bash
  docker-compose ps
  ```
- Check database logs:
  ```bash
  docker-compose logs postgres
  ```

### Rebuild after code changes
```bash
docker-compose build --no-cache
docker-compose up -d
```

## Volumes

Data is persisted in Docker volumes:
- `postgres_data` - PostgreSQL data
- `mongo_data` - MongoDB data
- `redis_data` - Redis data
- `minio_data` - MinIO data

To remove all data:
```bash
docker-compose down -v
```

## Network

All services run on the `kodingcaravan-network` bridge network, allowing them to communicate using service names as hostnames.

