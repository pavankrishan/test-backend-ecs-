# Koding Caravan Backend Setup Guide

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Docker & Docker Compose (for local development)
- Kubernetes cluster (for production deployment)

## Quick Start

### 1. Install Dependencies

```bash
# Install pnpm globally if not already installed
npm install -g pnpm

# Install all dependencies (workspace root + all services)
pnpm install
```

### 2. Environment Configuration

```bash
# Copy environment template
cp env.template .env

# Edit .env with your configuration values
# Pay special attention to:
# - JWT secrets (must be at least 32 characters)
# - Database passwords
# - AWS credentials (if using S3)
```

### 3. Start Infrastructure (Docker Compose)

```bash
# Start databases, Redis, Kafka, and MinIO
docker-compose up -d

# Wait for services to be healthy (check logs)
docker-compose ps
```

### 4. Build Shared Package

```bash
# Build shared package first (dependency for all services)
pnpm --filter @kodingcaravan/shared build
```

### 5. Run Services

```bash
# Development mode - run all services in parallel
pnpm dev

# Or run individual services
pnpm --filter @kodingcaravan/api-gateway dev
pnpm --filter @kodingcaravan/student-service dev
```

## Development Workflow

### Using Nx

```bash
# Build all services
pnpm build

# Type check all services
pnpm typecheck

# Lint all services
pnpm lint

# Run specific service
nx serve api-gateway
```

### Service-Specific Scripts

Each service has its own package.json with scripts:

```bash
cd services/api-gateway
pnpm install
pnpm dev
```

## Project Structure

```
├── shared/                    # Shared package (utilities, types, configs)
│   ├── config/               # Configuration loaders with Zod validation
│   ├── databases/            # Database connection utilities
│   ├── middlewares/          # Express middlewares (auth, rate limiting, validation)
│   ├── utils/                # Utility functions
│   └── types/                # TypeScript type definitions
│
├── services/                  # Microservices
│   ├── api-gateway/          # API Gateway (entry point)
│   ├── student-service/      # Student management
│   ├── trainer-service/      # Trainer management
│   ├── course-service/       # Course management
│   ├── chat-service/         # Chat/messaging
│   ├── notification-service/ # Notifications
│   ├── payment-service/      # Payments
│   └── ...                   # Other services
│
├── deployment/                # Deployment configurations
│   └── helm/                 # Kubernetes Helm charts
│
└── scripts/                   # Utility scripts
```

## Configuration

### Shared Configuration System

All services use the centralized config loader with Zod validation:

```typescript
import { loadServiceConfig } from '@kodingcaravan/shared';

const config = loadServiceConfig('my-service', {
  requirePostgres: true,
  requireRedis: true,
  requireJWT: true,
});
```

### Environment Variables

- Root `.env` file contains shared configuration
- Service-specific overrides can be added via `.env.local`
- All required variables are validated at startup using Zod

## Database Setup

### PostgreSQL Migrations

```bash
# Run migrations
./scripts/migrate.sh

# Or manually
cd services/student-service
npx typeorm migration:run
```

### MongoDB Collections

MongoDB collections are created automatically by Mongoose models.

### Seed Data

```bash
./scripts/seed-db.sh
```

## Testing

```bash
# Run all tests
pnpm test

# Run tests for specific service
nx test api-gateway
```

## Production Deployment

### Using Helm Charts

```bash
cd deployment/helm

# Install dependencies
helm dependency update api-gateway

# Deploy to Kubernetes
helm install api-gateway ./api-gateway \
  --namespace kodingcaravan \
  --create-namespace \
  --set env.JWT_SECRET=<your-secret>
```

See `deployment/helm/README.md` for detailed deployment instructions.

### Docker Build

```bash
# Build service image
docker build -t kodingcaravan/api-gateway:latest \
  -f services/api-gateway/Dockerfile .
```

## Monitoring & Observability

### Health Checks

All services expose health check endpoints:
- `GET /health` - Basic health check

### Logging

Logs are structured JSON using Winston:
```typescript
import { logger } from '@kodingcaravan/shared';
logger.info('Service started', { port: 3000 });
```

### Metrics

Prometheus metrics available at `/metrics` (when configured).

## Troubleshooting

### Port Conflicts

If ports are already in use, modify service ports in `.env` or docker-compose.yml.

### Database Connection Issues

1. Ensure Docker services are running: `docker-compose ps`
2. Check connection strings in `.env`
3. Verify network connectivity: `docker-compose exec postgres pg_isready`

### Dependency Installation Issues

```bash
# Clean install
rm -rf node_modules **/node_modules pnpm-lock.yaml
pnpm install
```

## Next Steps

1. Review `docs/architecture.md` for system architecture
2. Check `docs/api-specs.md` for API documentation
3. See `docs/deployment.md` for deployment best practices

## Support

For issues or questions, please refer to the documentation or contact the development team.

