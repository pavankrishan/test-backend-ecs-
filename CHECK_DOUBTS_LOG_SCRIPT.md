# How to Check Doubts Logs for User e723e949-436e-459c-8962-833a7e3ed509

## Current Status
- ✅ Frontend fixes applied: Course fetching fallback logic
- ✅ Backend fixes applied: MongoDB reconnection + enhanced logging
- ✅ Service running: `kodingcaravan-chat-service`
- ✅ MongoDB connected: `ac-bf0fqhp-shard-00-00.rwge3sb.mongodb.net`

## Steps to Check Logs

### 1. Monitor Real-time Logs (while frontend makes request)
```bash
cd kc-backend
docker logs kodingcaravan-chat-service --tail 100 -f | grep -E "listDoubts|Query|e723e949|MongoDB"
```

Or in PowerShell:
```powershell
cd kc-backend
docker logs kodingcaravan-chat-service --tail 100 -f | Select-String -Pattern "listDoubts|Query|e723e949|MongoDB"
```

### 2. Check Recent Logs for User
```bash
docker logs kodingcaravan-chat-service --tail 200 --since 10m | grep "e723e949"
```

### 3. Check All Doubt-Related Logs
```bash
docker logs kodingcaravan-chat-service --tail 500 | grep -E "DoubtService|DoubtController|listDoubts"
```

### 4. Expected Log Messages

When a doubt query is made, you should see:

```
[DoubtController] listDoubts request: {
  query: { studentId: 'e723e949-436e-459c-8962-833a7e3ed509' },
  parsedFilters: { studentId: 'e723e949-436e-459c-8962-833a7e3ed509' }
}
[DoubtService] Cache miss for listDoubts, querying MongoDB...
[DoubtService] listDoubts query: {
  studentIdValue: 'e723e949-436e-459c-8962-833a7e3ed509',
  studentIdType: 'string',
  studentIdLength: 36,
  query: { studentId: 'e723e949-436e-459c-8962-833a7e3ed509' },
  ...
}
[DoubtService] Query executed successfully: {
  queryUsed: '{"studentId":"e723e949-436e-459c-8962-833a7e3ed509"}',
  itemsReturned: X,
  totalReturned: X,
  sampleItem: { _id: ..., studentId: ..., status: ..., subject: ... },
  allStudentIds: [...]
}
[DoubtService] listDoubts results: {
  itemsCount: X,
  total: X,
  page: 1,
  limit: 20,
  firstItem: { _id: ..., studentId: ..., status: ..., subject: ... }
}
[DoubtController] listDoubts service result: { itemsCount: X, total: X, page: 1, limit: 20 }
[DoubtController] listDoubts formatted items: { formattedCount: X, firstItem: {...} }
```

### 5. Check MongoDB Connection Status
```bash
docker logs kodingcaravan-chat-service --tail 50 | grep -E "MongoDB|Connected|Disconnected|readyState"
```

Expected:
```
✅ MongoDB connected for Chat Service
[MongoDB] Connection details: {
  readyState: 1,
  host: 'ac-bf0fqhp-shard-00-00.rwge3sb.mongodb.net',
  ...
}
```

### 6. Check for Errors
```bash
docker logs kodingcaravan-chat-service --tail 500 | grep -i -E "error|timeout|failed|disconnected|buffering"
```

### 7. Direct MongoDB Query (if accessible)

If you have MongoDB connection string, you can query directly:

```javascript
// Connect to MongoDB
db.doubts.find({ 
  studentId: "e723e949-436e-459c-8962-833a7e3ed509" 
}).pretty()

// Count doubts
db.doubts.countDocuments({ 
  studentId: "e723e949-436e-459c-8962-833a7e3ed509" 
})

// Get all student IDs in doubts collection (to verify format)
db.doubts.distinct("studentId")
```

### 8. Test API Endpoint Directly

Using curl (if API Gateway is accessible):
```bash
curl -X GET "http://localhost:3000/api/v1/doubts?studentId=e723e949-436e-459c-8962-833a7e3ed509" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Using PowerShell:
```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/v1/doubts?studentId=e723e949-436e-459c-8962-833a7e3ed509" `
  -Method GET `
  -Headers @{ "Authorization" = "Bearer YOUR_TOKEN" }
```

## Troubleshooting

### If no logs appear:
1. Check if frontend is making requests (check frontend console)
2. Check if API Gateway is routing to chat-service
3. Verify chat-service is accessible on port 3008

### If queries timeout:
1. Check MongoDB connection: `docker logs kodingcaravan-chat-service | grep MongoDB`
2. Verify MONGO_URI is correct in .env
3. Check MongoDB Atlas connection limits

### If studentId doesn't match:
1. Check format: Should be UUID format (36 chars with dashes)
2. Check MongoDB collection: `db.doubts.find().limit(1).pretty()` to see format
3. Verify no whitespace or encoding issues

## Next Steps

1. ✅ Monitor logs while frontend makes request
2. ⏳ Check if doubts are returned correctly
3. ⏳ Verify query execution time (should be < 200ms)
4. ⏳ Confirm MongoDB connection stability
