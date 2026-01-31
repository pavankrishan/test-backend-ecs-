# How to Run Diagnostic Scripts

## Quick Start (PowerShell)

### Option 1: Set Environment Variable in PowerShell

```powershell
# Set POSTGRES_URL for current session
$env:POSTGRES_URL = "postgresql://user:password@host:port/database"

# Then run the script
cd kc-backend
node diagnose-purchase-allocation.js
```

### Option 2: Create .env File

Create a `.env` file (or `.env.production`, `.env.development`) in the `kc-backend` directory:

```env
POSTGRES_URL=postgresql://user:password@host:port/database
```

The scripts will automatically load from `.env` files.

### Option 3: Use Individual Variables

If you don't have a connection string, set individual variables:

```powershell
$env:POSTGRES_HOST = "localhost"
$env:POSTGRES_PORT = "5432"
$env:POSTGRES_USER = "postgres"
$env:POSTGRES_PASSWORD = "postgres"
$env:POSTGRES_DB = "kodingcaravan"
```

---

## Running Diagnostic Script

### See Recent Purchases

```powershell
cd kc-backend
node diagnose-purchase-allocation.js
```

### Check Specific Purchase

```powershell
cd kc-backend
node diagnose-purchase-allocation.js <studentId> <courseId>
```

**Example:**
```powershell
node diagnose-purchase-allocation.js 809556c1-e184-4b85-8fd6-a5f1c8014bf6 9e16d892-4324-4568-be60-163aa1665683
```

---

## Running Manual Trigger Script

### Trigger Allocation for Existing Purchase

```powershell
cd kc-backend
node manual-trigger-allocation.js <studentId> <courseId>
```

**Example:**
```powershell
node manual-trigger-allocation.js 809556c1-e184-4b85-8fd6-a5f1c8014bf6 9e16d892-4324-4568-be60-163aa1665683
```

---

## Environment Variable Examples

### Local Development (Docker)

```powershell
$env:POSTGRES_URL = "postgresql://postgres:postgres@localhost:5432/kodingcaravan"
```

### Cloud Database (Render)

```powershell
$env:POSTGRES_URL = "postgresql://user:password@dpg-xxxxx-a.oregon-postgres.render.com/database_name"
```

### With SSL (Cloud)

```powershell
$env:POSTGRES_URL = "postgresql://user:password@host:port/database?sslmode=require"
```

---

## Troubleshooting

### Error: "POSTGRES_URL not set"

1. **Check if .env file exists:**
   ```powershell
   ls kc-backend\.env*
   ```

2. **Create .env file:**
   ```powershell
   # In kc-backend directory
   echo "POSTGRES_URL=your_connection_string" > .env
   ```

3. **Or set in PowerShell:**
   ```powershell
   $env:POSTGRES_URL = "your_connection_string"
   ```

### Error: Connection refused

- Check if PostgreSQL is running
- Verify host, port, and credentials
- Check firewall/network settings

### Error: Database does not exist

- Verify database name in connection string
- Check if database was created

---

## Scripts Overview

### diagnose-purchase-allocation.js

**Purpose:** Diagnose why allocation wasn't triggered after purchase

**Checks:**
- ✅ Payment status
- ✅ Purchase record
- ✅ Processed events (PURCHASE_CONFIRMED, PURCHASE_CREATED)
- ✅ Allocation status
- ✅ Sessions status

**Output:** Shows where the flow breaks and what needs to be fixed

---

### manual-trigger-allocation.js

**Purpose:** Manually trigger trainer allocation for existing purchase

**What it does:**
1. Finds purchase record
2. Extracts metadata (timeSlot, startDate, etc.)
3. Calls admin-service API to trigger allocation
4. Creates sessions automatically

**Use when:**
- Purchase exists but allocation is missing
- Events were not processed by workers
- Need to manually trigger allocation

---

## Next Steps

1. **Run diagnostic** to identify the issue
2. **Check worker logs** if events are not processed
3. **Use manual trigger** as a quick fix
4. **Fix root cause** (workers, Kafka, etc.)

