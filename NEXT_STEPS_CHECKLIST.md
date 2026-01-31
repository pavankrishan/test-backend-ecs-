# ✅ Next Steps Checklist - Backend

Quick checklist to track progress on backend improvements.

---

## 🔴 CRITICAL (Do First)

### Trainer Service Integration
- [ ] Fix `franchiseId` mapping in `booking.controller.ts:592`
- [ ] Optimize N+1 API calls (use bulk endpoint or cache)
- [ ] Add retry logic for trainer service calls
- [ ] Add error handling and fallback behavior

### Zone UNIQUE Constraint
- [ ] Verify partial unique indexes exist in database
- [ ] Create migration script if indexes missing
- [ ] Test duplicate zone names (company vs franchise)

### Transaction Safety
- [ ] Verify `client` is passed to `checkAvailability()` in all cases
- [ ] Test concurrent assignment scenarios
- [ ] Add database locking if needed

### Certificate Generation
- [ ] Remove certificate generation from assignment flow
- [ ] Create background job for certificate generation
- [ ] Test certificate generation after 30 sessions completed

### Error Logging
- [ ] Install logging library (Winston/Pino)
- [ ] Install Sentry for error tracking
- [ ] Add structured logging to all services
- [ ] Add request/response logging middleware

---

## 🟡 HIGH PRIORITY (Do Next)

### Input Validation
- [ ] Install `express-validator` or `zod`
- [ ] Add validation middleware
- [ ] Validate UUIDs, dates, coordinates, enums
- [ ] Test validation with invalid inputs

### Race Condition Fix
- [ ] Add unique constraint on `schedule_slots (trainer_id, date, timeslot)`
- [ ] Add `SELECT FOR UPDATE` in availability check
- [ ] Handle constraint violations gracefully

### Zone Query Optimization
- [ ] Refactor zone distance query to use CTE
- [ ] Add spatial index if possible
- [ ] Benchmark query performance

### Certificate Number Generation
- [ ] Replace `Math.random()` with `crypto.randomBytes()`
- [ ] Add unique constraint on certificate_number
- [ ] Test collision resistance

---

## 🟢 MEDIUM PRIORITY

### Performance Optimization
- [ ] Batch availability checks (fix N+1)
- [ ] Cache trainer data
- [ ] Cache zone lookups

### Testing
- [ ] Install Jest and testing dependencies
- [ ] Write unit tests for services
- [ ] Write integration tests for assignment flow
- [ ] Write edge case tests
- [ ] Target 20%+ code coverage

### Documentation
- [ ] Complete OpenAPI/Swagger spec
- [ ] Add Swagger UI endpoint
- [ ] Document all API endpoints
- [ ] Add request/response examples

### Security
- [ ] Add authentication middleware
- [ ] Add role-based authorization
- [ ] Add permission checks
- [ ] Security audit

---

## 🔵 LOW PRIORITY

### Infrastructure
- [ ] Set up database migration system
- [ ] Add health check endpoints
- [ ] Set up monitoring dashboard
- [ ] Add rate limiting

### Features
- [ ] Timezone handling
- [ ] Caching strategy (Redis)
- [ ] Background job queue
- [ ] API versioning

---

## 📝 Notes

- **Start Date:** ___________
- **Target Completion:** ___________
- **Current Phase:** ___________

---

**Last Updated:** ___________

