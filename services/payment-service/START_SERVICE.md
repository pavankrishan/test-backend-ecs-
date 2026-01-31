# Starting the Payment Service

## Quick Start

To start the payment service, run:

```bash
cd kc-backend/services/payment-service
npm run dev
```

Or from the root directory:

```bash
cd kc-backend
pnpm --filter payment-service dev
```

## Environment Variables Required

Make sure you have the following environment variables set in your `.env` file (at the root of `kc-backend`):

```env
# Razorpay Payment Gateway
RAZORPAY_KEY_ID=rzp_test_RICqugAmLyLnKL
RAZORPAY_KEY_SECRET=pOadHSmJ0EY23pWDsW3WcBMc
PAYMENT_SESSION_TTL_MINUTES=30

# Payment Service Port
PAYMENT_SERVICE_PORT=3007

# Database (PostgreSQL)
POSTGRES_URL=postgres://user:password@localhost:5432/kodingcaravan
# OR individual settings:
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=kodingcaravan
```

## Verify Service is Running

Once started, you should see:
```
✅ Payment Service Running on port 3007
```

You can test the health endpoint:
```bash
curl http://localhost:3007/health
```

Or through the API Gateway:
```bash
curl http://localhost:3000/api/v1/payments/health
```

## Troubleshooting

### Port Already in Use
If you get `EADDRINUSE` error, either:
1. Stop the process using port 3007
2. Change `PAYMENT_SERVICE_PORT` in your `.env` file

### Database Connection Issues
Make sure PostgreSQL is running and the connection details in your `.env` are correct.

### Razorpay Credentials
If you get "Razorpay credentials not configured", make sure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set in your `.env` file.

