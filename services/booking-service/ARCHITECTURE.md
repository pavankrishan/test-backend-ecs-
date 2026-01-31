# Booking Service Architecture

## System Overview

The Booking Service is a microservice responsible for managing home tutoring bookings, trainer assignments, and service area operations for Koding Caravan.

## Core Components

### 1. Data Models Layer

#### City Model
- **Purpose**: Manages city-level service activation
- **Key Fields**: `name`, `state`, `isActive`, `franchiseId`
- **Business Rule**: Only HQ can activate cities. If inactive, service is unavailable.

#### Cluster Model
- **Purpose**: Internal operational areas within cities (2-3 km radius)
- **Key Fields**: `cityId`, `centerLatitude`, `centerLongitude`, `radiusKm`
- **Business Rule**: Franchise owns all clusters in their city. Clusters are for operational organization only.

#### SessionBooking Model
- **Purpose**: Represents a confirmed booking for home tutoring
- **Key Fields**: `studentId`, `courseId`, `address`, `latitude`, `longitude`, `timeslot`, `mode`, `groupSize`, `sessionCount`, `trainerId`
- **Business Rules**:
  - Fixed daily time and location
  - Session duration: 40 minutes
  - Modes: 1on1, 1on2, 1on3
  - Session packages: 10, 20, or 30 sessions

#### PreBooking Model
- **Purpose**: Stores pre-booking demand for trainer requirement calculation
- **Key Fields**: Similar to SessionBooking but without trainer assignment
- **Business Rule**: Used for demand forecasting

#### ScheduleSlot Model
- **Purpose**: Prevents double-booking by tracking trainer schedule
- **Key Fields**: `trainerId`, `date`, `timeslot`, `status`, `bookingId`
- **Business Rule**: One booking per trainer per timeslot

#### AttendanceRecord Model
- **Purpose**: Tracks daily attendance for sessions
- **Key Fields**: `bookingId`, `sessionId`, `date`, `status`
- **Business Rule**: Links to booking and session for tracking

### 2. Services Layer

#### ServiceAreaService
**Responsibilities:**
- City activation checks
- Cluster detection from coordinates
- Service availability determination
- Trainer radius filtering (5km max)

**Key Methods:**
- `checkServiceAvailability()`: Main entry point for availability checks
- `findNearestCluster()`: Finds nearest cluster to a location

#### TrainerAssignmentService
**Responsibilities:**
- Trainer candidate filtering
- Distance-based prioritization
- Timeslot conflict detection
- Trainer selection algorithm
- Schedule slot locking

**Key Methods:**
- `getAvailableTrainers()`: Filters trainers by distance and availability
- `selectBestTrainer()`: Priority algorithm (3km > 3-5km, least load)
- `assignTrainer()`: Assigns trainer and locks schedule

#### DemandCalculatorService
**Responsibilities:**
- Pre-booking aggregation
- Trainer requirement calculation
- Cluster and timeslot breakdown
- Buffer calculation (30%)

**Key Methods:**
- `calculateTrainerDemand()`: Main calculation method
- Groups by city → cluster → timeslot
- Returns trainer requirement summary

### 3. Controllers Layer

#### BookingController
Handles HTTP requests and responses:
- Input validation
- Service orchestration
- Response formatting
- Error handling

### 4. Utilities

#### Distance Calculation (Haversine)
- `calculateDistance()`: Great-circle distance in km
- `isWithinRadius()`: Boolean radius check
- `filterByDistance()`: Filter and sort by distance

## Data Flow

### Service Availability Check Flow
```
1. Client Request (lat, lng, course, timeslot)
   ↓
2. ServiceAreaService.checkServiceAvailability()
   ↓
3. Detect City (reverse geocoding)
   ↓
4. Check City Activation
   ↓
5. Find Nearest Cluster
   ↓
6. Get Available Trainers (from trainer-service)
   ↓
7. Filter by 5km Radius
   ↓
8. Return Availability Result
```

### Trainer Assignment Flow
```
1. Client Request (bookingId)
   ↓
2. TrainerAssignmentService.assignTrainer()
   ↓
3. Get Booking Details
   ↓
4. Detect/Update Cluster
   ↓
5. Get Trainer Candidates (from trainer-service)
   ↓
6. Filter by Distance (5km)
   ↓
7. Check Timeslot Conflicts
   ↓
8. Select Best Trainer (priority algorithm)
   ↓
9. Lock Schedule Slots (transaction)
   ↓
10. Update Booking Status
   ↓
11. Return Assignment Result
```

### Pre-Booking Demand Calculation Flow
```
1. Client Request (city name)
   ↓
2. DemandCalculatorService.calculateTrainerDemand()
   ↓
3. Get All Pending Pre-Bookings
   ↓
4. Group by City → Cluster → Timeslot
   ↓
5. Count Bookings (not students)
   ↓
6. Calculate Trainers Needed = Number of Bookings
   ↓
7. Add 30% Buffer
   ↓
8. Return Summary
```

## Algorithm Details

### Trainer Selection Priority Algorithm

```typescript
1. Filter trainers within 5km radius
2. Check timeslot conflicts (exclude if conflict)
3. Priority 1: Trainers within 3km
   - Sort by current load (ascending)
   - Select trainer with least load
4. Priority 2: Trainers 3-5km
   - Sort by current load (ascending)
   - Select trainer with least load
5. Return selected trainer
```

### Distance Calculation (Haversine Formula)

```typescript
a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlng/2)
c = 2 × atan2(√a, √(1−a))
distance = R × c

Where:
- R = Earth's radius (6371 km)
- lat1, lng1 = First point coordinates
- lat2, lng2 = Second point coordinates
```

### Pre-Booking Demand Algorithm

```typescript
1. Get all pending pre-bookings
2. Group by city
3. For each city:
   a. Group by cluster
   b. Group by timeslot
   c. Count bookings (not students)
   d. trainersNeeded = numberOfBookings
   e. Add 30% buffer
4. Return breakdown by cluster and timeslot
```

## Database Schema

### Tables
- `cities`: City management
- `clusters`: Cluster definitions
- `session_bookings`: Confirmed bookings
- `pre_bookings`: Pre-booking demand
- `schedule_slots`: Trainer schedule tracking
- `attendance_records`: Daily attendance

### Indexes
- Location indexes on `(latitude, longitude)`
- Foreign key indexes
- Status indexes for filtering
- Composite indexes for common queries

## Integration Points

### External Services

1. **Trainer Service**
   - Fetch trainer locations
   - Get trainer active status
   - Get trainer current load

2. **Course Service**
   - Validate course availability
   - Get course details

3. **Student Service**
   - Get student addresses
   - Get student course purchases

4. **Geocoding Service** (Future)
   - Reverse geocoding (coordinates → city)
   - Address validation

## Error Handling

### Service Availability
- City not found → "Service not available"
- City inactive → "Service not available in this city yet"
- No trainers → "Coming Soon in your area"
- Trainers available → "Service Available"

### Trainer Assignment
- No booking → 400 Bad Request
- Already assigned → Return existing assignment
- No trainers → 400 Bad Request with message
- Assignment success → 200 OK with assignment details

## Performance Considerations

1. **Caching**: Cache city/cluster data (Redis)
2. **Indexing**: Proper indexes on location and status fields
3. **Batch Operations**: Batch schedule slot creation
4. **Connection Pooling**: Use PostgreSQL connection pool
5. **Query Optimization**: Use prepared statements

## Security Considerations

1. **Input Validation**: Validate all inputs
2. **SQL Injection**: Use parameterized queries
3. **Rate Limiting**: Limit API requests
4. **Authentication**: Integrate with auth service
5. **Authorization**: Check user permissions

## Scalability

1. **Horizontal Scaling**: Stateless service design
2. **Database Sharding**: Shard by city if needed
3. **Caching Layer**: Redis for frequently accessed data
4. **Message Queue**: Use queue for async operations
5. **CDN**: Cache static responses

## Monitoring

1. **Metrics**: Track API response times, error rates
2. **Logging**: Structured logging for debugging
3. **Alerting**: Alert on high error rates
4. **Tracing**: Distributed tracing for request flow
5. **Health Checks**: `/healthz` endpoint

## Future Enhancements

1. **PostGIS Integration**: Better spatial queries
2. **Real-time Updates**: WebSocket for live updates
3. **Machine Learning**: Predict trainer demand
4. **Optimization**: Route optimization for trainers
5. **Analytics**: Booking analytics dashboard

