# Cloud MongoDB (Atlas) Configuration

## Current Setup

The system is configured to use **ONLY MongoDB Atlas** (cloud MongoDB). **Local MongoDB is NOT supported and has been completely removed.**

## Connection String

```
MONGO_URI=mongodb+srv://KodingCaravan:KodingcaravanMongo@cluster0.2mcuw5u.mongodb.net/?appName=Cluster0
```

## Configuration Files Updated

### 1. `env.template` / `.env`

The MongoDB connection string is set to use cloud Atlas:

```env
MONGO_URI=mongodb+srv://KodingCaravan:KodingcaravanMongo@cluster0.2mcuw5u.mongodb.net/?appName=Cluster0
MONGO_DB_NAME=kodingcaravan
```

**Note**: `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD` are not needed for cloud MongoDB.

### 2. `docker-compose.yml`

The local MongoDB service has been **completely removed**:

- ✅ MongoDB Docker container removed
- ✅ `mongo_data` volume removed
- ✅ All MongoDB dependencies removed from services
- ✅ Services connect directly to cloud MongoDB Atlas

## Benefits of Cloud MongoDB

✅ **No Local Container**: No need to run MongoDB in Docker  
✅ **Automatic Scaling**: Atlas handles scaling for 600k+ users  
✅ **High Availability**: Built-in replication and failover  
✅ **Automatic Backups**: Atlas provides automated backups  
✅ **Better Performance**: Optimized cloud infrastructure  
✅ **No Connection Spam**: Cloud handles connection management efficiently  
✅ **Production-Grade Security**: Network isolation and encryption  

## Connection Pooling

The connection code (`shared/databases/mongo/connection.ts`) is optimized for cloud:

- **maxPoolSize: 50** - Supports high traffic
- **minPoolSize: 5** - Maintains minimum connections
- **Connection Reuse** - Prevents duplicate connections
- **Automatic Retry** - Handles transient network issues

## Services Using MongoDB

All these services connect to cloud MongoDB Atlas:

1. **api-gateway** - Uses shared `connectMongo()` function
2. **course-service** - Uses shared `connectMongo()` with connection guards
3. **admin-service** - Uses shared `connectMongo()` function
4. **chat-service** - Uses shared `connectMongo()` with service-specific pooling
5. **analytics-service** - Uses shared `connectMongo()` with service-specific pooling
6. **notification-service** - Uses shared `connectMongo()` function

## Testing Connection

To verify MongoDB connection:

```bash
# Test MongoDB connection
node test-mongo-connection.js
```

Expected output:
```
✅ MongoDB connection successful!
Connected to: kodingcaravan
```

## Troubleshooting

### Connection Timeout

If you see connection timeout errors:

1. **Check Network Access**: Ensure your IP is whitelisted in MongoDB Atlas
   - Go to Atlas Dashboard → Network Access
   - Add your current IP or `0.0.0.0/0` for development (not recommended for production)

2. **Verify Credentials**: Check username and password in connection string

3. **Check Connection String**: Ensure it's correctly formatted

### Authentication Errors

If you see authentication errors:

1. **Verify Username/Password**: Check Atlas Database Access
2. **Check Database User Permissions**: Ensure user has read/write access
3. **URL Encoding**: Ensure special characters in password are URL-encoded

## Important: Cloud MongoDB Only

**This system is configured for CLOUD MongoDB ONLY.**

- ❌ Local MongoDB is **NOT supported**
- ❌ Local MongoDB service has been **completely removed** from docker-compose.yml
- ❌ No local MongoDB fallback options
- ✅ All services connect directly to MongoDB Atlas cloud

If you need local MongoDB for development, you must set up a separate MongoDB instance outside of this docker-compose setup.

## Security Best Practices

For production MongoDB Atlas:

1. **Network Access**: Whitelist only necessary IPs
2. **Database Users**: Use least-privilege principle
3. **Connection String**: Store in environment variables, never commit to git
4. **Encryption**: Enable TLS/SSL (already in connection string)
5. **Monitoring**: Enable Atlas monitoring and alerts

## Monitoring

MongoDB Atlas provides:
- Real-time performance metrics
- Query performance insights
- Connection pool monitoring
- Storage usage tracking
- Alert notifications

Access via: [MongoDB Atlas Dashboard](https://cloud.mongodb.com)

## Support

For MongoDB Atlas issues:
- Check [Atlas Documentation](https://docs.atlas.mongodb.com/)
- Review connection string format
- Verify network access settings
- Check Atlas status page

