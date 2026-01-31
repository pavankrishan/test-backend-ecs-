# Koding Caravan Backend

> EdTech Mobile App Backend - Production-Ready Microservices Architecture

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8%2B-orange)](https://pnpm.io/)
[![Nx](https://img.shields.io/badge/Nx-17-purple)](https://nx.dev/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Ready-blue)](https://kubernetes.io/)

## 🎯 Overview

A modern, scalable microservices backend for an EdTech mobile application. Built with TypeScript, Express, and designed for production deployment on Kubernetes.

### Key Features

- 🏗️ **Microservices Architecture**: Modular, scalable service design
- 🔐 **Type-Safe Configuration**: Zod-validated environment configs
- 📝 **OpenAPI Validation**: Request/response validation at API gateway
- 🚀 **Production Ready**: Helm charts for Kubernetes deployment
- ⚡ **Developer Experience**: pnpm workspaces + Nx for fast builds
- 🔄 **Event-Driven**: Kafka integration for async communication
- 💾 **Multi-Database**: PostgreSQL, MongoDB, Redis support

## 🏗️ Architecture

```
┌─────────────────┐
│   API Gateway   │
│   (Port 3000)   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼───┐
│Student│ │Course│
│Service│ │Service│
└───────┘ └──────┘
    │         │
    └────┬────┘
         │
    ┌────▼────┐
    │  Kafka  │
    │ EventBus│
    └─────────┘
```

### Services

- **API Gateway**: Single entry point, routing, authentication
- **Student Service**: Student management and profiles
- **Trainer Service**: Trainer management
- **Course Service**: Course content and assignments
- **Chat Service**: Real-time messaging
- **Notification Service**: Email, push notifications
- **Payment Service**: Payment processing
- **Analytics Service**: Analytics and reporting
- **Admin Service**: Admin dashboard and management

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Docker & Docker Compose

### Installation

```bash
# Clone repository
git clone <repository-url>
cd koding-caravan-mapp-be

# Install dependencies
pnpm install


#Create File Name shared/config/global.d.ts and Paste

import type { Logger } from "winston";

declare global {
  var logger: Logger;
}

export {};



# Copy environment template
cp env.template .env
# Edit .env with your configuration

# Start infrastructure
docker-compose up -d

# Build shared package
pnpm --filter @kodingcaravan/shared build

# Start all services
pnpm dev
```

For detailed setup instructions, see:
- **[GETTING_STARTED.md](./GETTING_STARTED.md)** - Step-by-step guide for new developers
- **[SETUP.md](./SETUP.md)** - Comprehensive setup and configuration guide

## 📁 Project Structure

```
├── shared/              # Shared utilities and types
│   ├── config/         # Configuration loaders (Zod)
│   ├── databases/      # DB connection utilities
│   ├── middlewares/    # Express middlewares
│   ├── utils/          # Utility functions
│   └── types/          # TypeScript definitions
│
├── services/           # Microservices
│   ├── api-gateway/    # API Gateway
│   ├── student-service/
│   ├── course-service/
│   └── ...
│
├── deployment/         # Deployment configs
│   └── helm/         # Kubernetes Helm charts
│
└── scripts/           # Utility scripts
```

## 🛠️ Development

### Using Nx (Recommended)

```bash
# Build all services
pnpm build

# Run in development mode
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint

# Run specific service
nx serve api-gateway
```

### Service-Specific

```bash
cd services/api-gateway
pnpm install
pnpm dev
```

## 🔧 Configuration

All services use a centralized, type-safe configuration system with Zod validation:

```typescript
import { loadServiceConfig } from '@kodingcaravan/shared';

const config = loadServiceConfig('my-service', {
  requirePostgres: true,
  requireRedis: true,
  requireJWT: true,
});
```

Environment variables are validated at startup. See `env.template` for all available options.

## 🚢 Deployment

### Using Helm (Kubernetes)

```bash
cd deployment/helm

# Install API Gateway
helm install api-gateway ./api-gateway \
  --namespace kodingcaravan \
  --create-namespace
```

See [deployment/helm/README.md](./deployment/helm/README.md) for details.

### Docker Compose (Local Only)

```bash
docker-compose up -d
```

## 📚 Documentation

- **[GETTING_STARTED.md](./GETTING_STARTED.md)**: Step-by-step guide for new developers
- **[SETUP.md](./SETUP.md)**: Comprehensive setup guide
- **[IMPROVEMENTS_SUMMARY.md](./IMPROVEMENTS_SUMMARY.md)**: Recent improvements
- **[docs/architecture.md](./docs/architecture.md)**: System architecture
- **[docs/api-specs.md](./docs/api-specs.md)**: API documentation
- **[docs/deployment.md](./docs/deployment.md)**: Deployment guide

## 🔒 Security

- JWT-based authentication
- Environment variable validation
- Rate limiting
- CORS configuration
- Pod security contexts (Kubernetes)
- Secrets management via Kubernetes Secrets

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run service-specific tests
nx test api-gateway
```

## 📊 Monitoring

- Health check endpoints: `GET /health`
- Structured logging (Winston)
- Prometheus metrics (when configured)
- Distributed tracing ready

## 🤝 Contributing

1. Create feature branch
2. Make changes
3. Ensure tests pass
4. Submit pull request

See [IMPROVEMENTS_SUMMARY.md](./IMPROVEMENTS_SUMMARY.md) for architectural patterns.

## 📝 License

ISC

## 🆘 Support

For issues or questions:
1. Check documentation in `docs/`
2. Review `SETUP.md` for common issues
3. Open an issue on the repository

---

**Built with ❤️ for Koding Caravan**

