# Port Assignment

## Booking Service Port: **3011**

The booking service has been configured to use **port 3011** to avoid conflicts with existing services.

## Existing Service Ports (3003-3010)

- **3003**: Student Service
- **3004**: Trainer Service  
- **3005**: Course Service
- **3006**: Notification Service
- **3007**: Payment Service
- **3008**: Chat Service
- **3009**: Analytics Service
- **3010**: Admin Service

## Booking Service

- **3011**: Booking Service (default)

## Usage

The port can be overridden using the `PORT` environment variable:

```bash
# Use default port 3011
pnpm start

# Or override with custom port
PORT=3012 pnpm start
```

## Health Check

```bash
curl http://localhost:3011/healthz
```

## API Base URL

All booking service endpoints are available at:

```
http://localhost:3011/api/v1/booking
```

