# Public Pincode API Endpoints

## Overview

Public API endpoints for pincode lookup during trainer application. These endpoints are available without authentication and are used for auto-fill functionality in the application form.

---

## ✅ Endpoints Created

### 1. Trainer Auth Service (Public)
**Base URL:** `/api/v1/trainers/auth`

**Endpoint:** `GET /api/v1/trainers/auth/pincodes/:pincode`

**Purpose:** Resolve pincode to city information for auto-fill during application

**Authentication:** Not required (public endpoint)

**Example:**
```bash
curl http://localhost:3000/api/v1/trainers/auth/pincodes/110001
```

**Response (Success):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Pincode resolved successfully",
  "data": {
    "pincode": "110001",
    "cityId": "uuid-here",
    "cityName": "New Delhi",
    "state": "Delhi",
    "country": "India",
  }
}
```

**Response (Not Found):**
```json
{
  "success": true,
  "statusCode": 404,
  "message": "Pincode not found",
  "data": null
}
```

**Response (Error):**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Pincode must be 6 digits"
}
```

---

### 2. Admin Service (Admin Only)
**Base URL:** `/api/v1/admin`

**Endpoints:**
- `GET /api/v1/admin/pincodes/:pincode` - Resolve pincode
- `GET /api/v1/admin/cities?state=:state` - Get cities by state
- `GET /api/v1/admin/states` - Get all states

**Authentication:** Required (admin only)

---

## 🎯 Frontend Integration

### Example: Pincode Auto-fill in Application Form

```typescript
// In trainer application form (React Native/Expo)
const handlePincodeChange = async (pincode: string) => {
  // Validate format
  if (pincode.length !== 6 || !/^[0-9]{6}$/.test(pincode)) {
    return;
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/trainers/auth/pincodes/${pincode}`
    );
    const result = await response.json();

    if (result.success && result.data) {
      // Auto-fill city, state, country
      setCity(result.data.cityName);
      setState(result.data.state);
      setCountry(result.data.country);
      setCityId(result.data.cityId);
      
      // Show success message
      Alert.alert('Success', 'City information auto-filled');
    } else {
      // Pincode not found
      Alert.alert('Not Found', 'Pincode not found in our database');
    }
  } catch (error) {
    console.error('Failed to resolve pincode:', error);
    Alert.alert('Error', 'Failed to lookup pincode');
  }
};
```

### React Native Example

```typescript
import { useState } from 'react';
import { TextInput, Alert } from 'react-native';

function TrainerApplicationForm() {
  const [pincode, setPincode] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');

  const handlePincodeBlur = async () => {
    if (pincode.length === 6) {
      try {
        const response = await fetch(
          `http://localhost:3000/api/v1/trainers/auth/pincodes/${pincode}`
        );
        const result = await response.json();

        if (result.success && result.data) {
          setCity(result.data.cityName);
          setState(result.data.state);
          setCountry(result.data.country);
        }
      } catch (error) {
        console.error('Pincode lookup failed:', error);
      }
    }
  };

  return (
    <>
      <TextInput
        placeholder="Pincode (6 digits)"
        value={pincode}
        onChangeText={setPincode}
        onBlur={handlePincodeBlur}
        maxLength={6}
        keyboardType="numeric"
      />
      <TextInput
        placeholder="City"
        value={city}
        editable={false}
      />
      <TextInput
        placeholder="State"
        value={state}
        editable={false}
      />
    </>
  );
}
```

---

## 🔒 Security Considerations

### Public Endpoint Security

1. **Rate Limiting:** Consider adding rate limiting to prevent abuse
2. **Input Validation:** Pincode format is validated (6 digits only)
3. **No Sensitive Data:** Only returns public city information
4. **CORS:** Ensure CORS is properly configured for frontend access

### Recommended Rate Limits

```typescript
// Add to routes
import { rateLimit } from 'express-rate-limit';

const pincodeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many pincode lookup requests, please try again later',
});

router.get('/pincodes/:pincode', pincodeRateLimiter, TrainerAuthController.resolvePincode);
```

---

## 📊 API Response Format

All endpoints follow the standard response format:

```typescript
interface SuccessResponse<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
}

interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error?: any;
}
```

---

## 🧪 Testing

### Test with cURL

```bash
# Valid pincode
curl http://localhost:3000/api/v1/trainers/auth/pincodes/110001

# Invalid format
curl http://localhost:3000/api/v1/trainers/auth/pincodes/abc123

# Not found
curl http://localhost:3000/api/v1/trainers/auth/pincodes/999999
```

### Test with Postman

1. Create GET request
2. URL: `http://localhost:3000/api/v1/trainers/auth/pincodes/110001`
3. No authentication headers needed
4. Check response

---

## 📋 Implementation Checklist

- [x] Pincode service created in trainer-auth-service
- [x] Controller method added
- [x] Route registered
- [x] Public endpoint (no auth required)
- [x] Error handling
- [x] Input validation
- [ ] Rate limiting (recommended)
- [ ] Frontend integration
- [ ] Testing

---

## 🚀 Next Steps

1. **Add Rate Limiting** (recommended)
2. **Frontend Integration**
   - Update application form
   - Add pincode input field
   - Implement auto-fill on blur/change
3. **Testing**
   - Test with various pincodes
   - Test error cases
   - Test rate limiting
4. **Monitoring**
   - Monitor API usage
   - Track lookup success rate
   - Log failed lookups

---

## 📚 Related Documentation

- **Migration:** `009-enterprise-location-model.sql`
- **Implementation Guide:** `009-LOCATION_MODEL_GUIDE.md`
- **Supporting Services:** `009-SUPPORTING_SERVICES_CREATED.md`
- **Approval Flow:** `009-APPROVAL_FLOW_QUICK_REFERENCE.md`

---

## ✅ Status

Public pincode lookup endpoint is **ready for use**! 🎉

**Endpoint:** `GET /api/v1/trainers/auth/pincodes/:pincode`

