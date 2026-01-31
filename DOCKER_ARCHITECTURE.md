# Docker Architecture - Production Grade

## Architecture Principles

This Docker setup follows **strict microservice isolation** principles:

### ✅ ONE SERVICE = ONE DOCKER IMAGE

- Each microservice has its own `Dockerfile` in `services/<service-name>/Dockerfile`
- No image contains more than one service
- Runtime selection of service inside a container is **FORBIDDEN**

### ✅ MONOREPO IS FOR BUILD ONLY

- pnpm workspace and monorepo exist **ONLY** to:
  - Share code via `@kodingcaravan/shared`
  - Coordinate builds
- Runtime containers **MUST NOT** contain:
  - Other services' code
  - Workspace logic
  - Start-service scripts
  - Flags to choose service

### ✅ RUNTIME CONTAINER RULES

**Runtime image MUST contain:**
- Node.js 18 (Alpine)
- Compiled JavaScript (`dist/`)
- Production dependencies **ONLY** for that service
- `@kodingcaravan/shared` as a local file dependency

**Runtime image MUST NOT contain:**
- pnpm
- nx
- TypeScript source files
- Other services' code
- Build tools
- Dev dependencies

### ✅ BUILD RULES

**Multi-stage build is REQUIRED:**
1. **Base**: Node.js + pnpm setup
2. **Deps**: Install all dependencies (dev + prod)
3. **Builder**: Build `@kodingcaravan/shared` first, then build target service
4. **Runtime**: Minimal production image

**Build process:**
- Build `@kodingcaravan/shared` first (required by all services)
- Build **ONLY** the target service
- Copy **ONLY**:
  - `shared/dist`
  - `service/dist`
  - `service/package.json`

### ✅ DEPENDENCY RULES

- `pnpm install` may be used **ONLY** in build stages
- Runtime stage uses `npm install` (no pnpm)
- Dependencies are scoped to the single service
- `workspace:*` is replaced with `file:../shared` at runtime

### ✅ DEPLOYMENT SAFETY

- Each service can be:
  - Built independently
  - Deployed independently
  - Scaled independently
- No change in one service affects another
- No shared runtime state between services

## File Structure

```
kc-backend/
├── services/
│   ├── Dockerfile.template          # Template for generating service Dockerfiles
│   ├── api-gateway/
│   │   └── Dockerfile              # Service-specific Dockerfile
│   ├── student-service/
│   │   └── Dockerfile              # Service-specific Dockerfile
│   └── ...                         # Other services
├── docker-compose.yml              # Orchestration (uses individual Dockerfiles)
├── scripts/
│   └── generate-dockerfiles.js    # Script to generate all Dockerfiles
└── DOCKER_ARCHITECTURE.md          # This file
```

## Dockerfile Structure

Each service Dockerfile follows this structure:

```dockerfile
# Stage 1: Base (Node.js + pnpm)
FROM node:18-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Stage 2: Dependencies
FROM base AS deps
# Copy workspace config + shared + service package.json
# Install all dependencies

# Stage 3: Builder
FROM base AS builder
# Copy source code
# Build shared first
# Build service

# Stage 4: Runtime
FROM node:18-alpine AS runtime
# Copy built artifacts
# Install production deps with npm
# Replace workspace:* with file:../shared
# Run as non-root user
CMD ["node", "dist/index.js"]
```

## Building Services

### Build a single service:

```bash
# From kc-backend directory
docker build -f services/api-gateway/Dockerfile -t kodingcaravan-api-gateway:latest .
```

### Build all services:

```bash
docker-compose build
```

### Build and run:

```bash
docker-compose up -d
```

## Generating Dockerfiles

If you add a new service, generate its Dockerfile:

```bash
node scripts/generate-dockerfiles.js
```

This script:
1. Reads `services/Dockerfile.template`
2. Replaces placeholders (`<SERVICE_NAME>`, `<SERVICE_PACKAGE>`, `<SERVICE_PORT>`)
3. Writes `services/<service-name>/Dockerfile`

## Service Isolation Verification

To verify a service image contains only that service:

```bash
# Inspect image contents
docker run --rm --entrypoint sh kodingcaravan-api-gateway:latest -c "ls -la /app"

# Should show:
# - /app/shared/     (shared package only)
# - /app/service/     (this service only)
# - No other services
```

## Production Deployment

### Image Tags

Tag images with version numbers:

```bash
docker build -f services/api-gateway/Dockerfile -t kodingcaravan-api-gateway:v1.0.0 .
```

### Registry Push

```bash
docker tag kodingcaravan-api-gateway:v1.0.0 registry.example.com/kodingcaravan-api-gateway:v1.0.0
docker push registry.example.com/kodingcaravan-api-gateway:v1.0.0
```

### Independent Deployment

Each service can be deployed independently:

```bash
# Deploy only api-gateway
docker-compose up -d api-gateway

# Scale a service
docker-compose up -d --scale api-gateway=3
```

## Security

- All services run as non-root user (`nodejs:1001`)
- Minimal base image (Alpine Linux)
- No build tools in runtime
- Production dependencies only
- Health checks configured

## Troubleshooting

### Service won't start

1. Check logs:
   ```bash
   docker-compose logs <service-name>
   ```

2. Verify shared package is accessible:
   ```bash
   docker run --rm --entrypoint sh <image> -c "ls -la /app/shared/dist"
   ```

3. Check Node.js can resolve `@kodingcaravan/shared`:
   ```bash
   docker run --rm --entrypoint node <image> -e "require('@kodingcaravan/shared')"
   ```

### Build fails

1. Ensure `pnpm-lock.yaml` is up to date
2. Check workspace configuration
3. Verify service package.json exists

### Runtime dependency errors

1. Verify `workspace:*` was replaced with `file:../shared`
2. Check shared package has production deps installed
3. Verify service package.json dependencies

## Forbidden Patterns

❌ **DO NOT:**
- Use one Dockerfile for all services
- Use `start-service` or similar runtime scripts
- Choose service via CMD arguments
- Copy all services into one image
- Use pnpm in runtime stage
- Include workspace resolution in runtime

✅ **DO:**
- One Dockerfile per service
- Direct `node dist/index.js` command
- Minimal runtime image
- Independent service builds
- Production-grade isolation

## Success Criteria

✅ Each service can be built, deployed, and scaled independently  
✅ No runtime container contains more than one service  
✅ Architecture purity is maintained  
✅ Safe for production launch  

