# Koding Caravan Helm Charts

Production-ready Helm charts for deploying Koding Caravan microservices to Kubernetes.

## Structure

- `base/` - Base chart with common deployment configurations
- `api-gateway/` - API Gateway service chart
- `student-service/` - Student service chart (example)

## Installation

### Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3.x
- kubectl configured

### Install Base Chart Dependencies

```bash
cd deployment/helm
helm dependency update api-gateway
helm dependency update student-service
```

### Install Services

```bash
# Install API Gateway
helm install api-gateway ./api-gateway \
  --namespace kodingcaravan \
  --create-namespace \
  --set env.JWT_SECRET=<your-secret> \
  --set env.JWT_REFRESH_SECRET=<your-refresh-secret>

# Install Student Service
helm install student-service ./student-service \
  --namespace kodingcaravan \
  --set database.postgres.password=<db-password>
```

### Upgrade Services

```bash
helm upgrade api-gateway ./api-gateway \
  --namespace kodingcaravan \
  --set image.tag=v1.1.0
```

### Uninstall

```bash
helm uninstall api-gateway --namespace kodingcaravan
helm uninstall student-service --namespace kodingcaravan
```

## Customization

Each service chart inherits from the base chart. Override values in service-specific `values.yaml` or via `--set` flags.

## Secrets Management

Store sensitive values in Kubernetes Secrets:

```bash
kubectl create secret generic api-gateway-secrets \
  --from-literal=jwt-secret=<secret> \
  --from-literal=jwt-refresh-secret=<refresh-secret> \
  --namespace kodingcaravan
```

Then reference in values.yaml:

```yaml
envFrom:
  - secretRef:
      name: api-gateway-secrets
```

## Monitoring & Observability

The charts include:
- Health checks (liveness/readiness probes)
- Resource limits and requests
- Horizontal Pod Autoscaling
- Prometheus-ready metrics endpoints

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Deploy to Kubernetes
  uses: helm/action@v1.0.0
  with:
    chart: ./deployment/helm/api-gateway
    release: api-gateway
    namespace: kodingcaravan
```

