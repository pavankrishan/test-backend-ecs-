# Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install Dependencies
```bash
cd kc-backend/services/booking-service
pnpm install
```

### Step 2: Set Environment Variables
```bash
# Create .env file or export variables
export DATABASE_URL="postgresql://user:password@localhost:5432/kodingcaravan"
export PORT=3011
```

### Step 3: Start the Service
```bash
# Development mode
pnpm dev

# Or production mode
pnpm build && pnpm start
```

### Step 4: Test It Works
```bash
curl http://localhost:3011/healthz
# Should return: {"status":"ok","service":"booking"}
```

## ✅ What's Included

- ✅ 6 Data Models (City, Cluster, Booking, PreBooking, ScheduleSlot, Attendance)
- ✅ 3 Core Services (ServiceArea, TrainerAssignment, DemandCalculator)
- ✅ 7 API Endpoints (all documented)
- ✅ Complete Business Logic (all rules implemented)
- ✅ Distance Calculation (Haversine formula)
- ✅ Trainer Assignment Algorithm (priority-based)
- ✅ Pre-Booking Demand Calculator (with 30% buffer)

## 📝 Next Steps

1. **Seed Data**: Create cities and clusters (see SETUP.md)
2. **Integrate Trainer Service**: Update `src/utils/trainerIntegration.ts`
3. **Add Geocoding**: Update `src/services/serviceArea.service.ts` detectCity method
4. **Add Authentication**: Add auth middleware to routes
5. **Add Validation**: Add input validation (Zod schemas)

## 🔗 API Endpoints

All endpoints are under `/api/v1/booking`:

- `POST /check-service-availability` - Check if service available
- `POST /create-booking` - Create a booking
- `POST /create-prebooking` - Create pre-booking
- `GET /trainer-demand?city=Ongole` - Get trainer requirements
- `POST /assign-trainer` - Assign trainer to booking
- `GET /trainer-schedule/:trainerId` - Get trainer schedule
- `POST /trainer-attendance` - Record attendance

See EXAMPLES.md for detailed request/response examples.

## 📚 Documentation

- **README.md** - Complete service documentation
- **ARCHITECTURE.md** - System architecture
- **EXAMPLES.md** - API examples with JSON
- **SETUP.md** - Detailed setup instructions
- **IMPLEMENTATION_SUMMARY.md** - Implementation details

## 🎯 Key Features

✅ City → Cluster → Trainer hierarchy  
✅ 5km trainer radius with priority  
✅ Schedule conflict prevention  
✅ Multi-mode support (1on1, 1on2, 1on3)  
✅ Demand forecasting  
✅ Attendance tracking  

## 🐛 Troubleshooting

**Database connection failed?**
- Check DATABASE_URL is correct
- Ensure PostgreSQL is running
- Check network/firewall settings

**Port already in use?**
- Change PORT in environment variables (default is 3011)
- Or kill process using the port

**Missing dependencies?**
- Run `pnpm install` again
- Check node version (requires Node 18+)

## 💡 Tips

- Use `pnpm dev` for development (auto-reload)
- Check logs for detailed error messages
- All tables auto-create on first run
- Service is stateless - can scale horizontally

