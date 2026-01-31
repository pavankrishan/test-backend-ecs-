# Payment Service Overview

This document captures the current scope of the payment microservice and outlines potential future enhancements.

## Implemented Capabilities

- **Service bootstrap & configuration**
  - Express application with JSON body handling and global error middleware.
  - Automatic database bootstrap (`initializePaymentTables`) that provisions `payments`, `coin_wallets`, and `coin_transactions` tables plus supporting indexes/extensions.
  - Configurable startup via `PAYMENT_SERVICE_PORT`, `PAYMENT_SESSION_TTL_MINUTES`, `COIN_REWARD_COURSE_COMPLETION`, and `COIN_REWARD_REFERRAL` environment variables.
- **Payment lifecycle**
  - `/api/v1/payments` routes backed by Zod validation.
  - Mock payment session creation with generated provider payment IDs, payment URLs, and expirations.
  - Persistence of payment records (`initiated` → terminal statuses) with idempotent confirmation checks.
  - Student payment history listing with pagination.
- **Coin wallet platform**
  - Automatic wallet provisioning and balance management with optimistic checks to prevent negative balances.
  - Idempotent coin transactions keyed by `(student_id, type, reference_id)` to avoid duplicate rewards.
  - Reward flows:
    - Course completion (`/coins/course-completion`) using configurable coin grants.
    - Referral rewards (`/coins/referral`) with override support.
    - Manual adjustments (`/coins/adjust`) for admin operations.
    - Coin redemption (`/coins/redeem`) with balance validation.
  - Wallet and transaction retrieval endpoints with numeric-safe serialization for `BIGINT` and `INTEGER` values.

## Future Enhancements

- **Real payment integrations**
  - Replace the mock gateway with providers such as Razorpay, Stripe, or PayPal, including webhook processing and signature verification.
  - Support multi-currency pricing, exchange rates, and localized payment methods.
- **Coin ecosystem improvements**
  - Configurable coin valuation rules (per course tier, referral tier, streak bonuses).
  - Voucher/redemption catalog and inventory tracking for spending coins.
  - Scheduled jobs for coin expiration, reminders, and audit summaries.
- **Observability & resilience**
  - Structured logging around payment/coin events and integration retries.
  - Metrics (success rates, coin issuance) with dashboards and alerting.
- **Access control & tooling**
  - Admin APIs/UI for manual grants, refunds, and transaction investigations.
  - Role-based authorization guards and rate limits per endpoint.
- **Testing & quality**
  - Unit tests covering service logic and transactional helpers.
  - Contract/integration tests verifying API behaviour with mocked providers and databases.

## Getting Started

```bash
# Install workspace dependencies (from repo root)
pnpm install

# Start the service in watch mode
pnpm --filter @kodingcaravan/payment-service dev
```

Ensure PostgreSQL is reachable with the credentials exposed via the shared workspace environment variables before launching the service.

