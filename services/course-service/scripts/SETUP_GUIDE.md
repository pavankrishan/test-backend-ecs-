# Robotics Course Creation - Setup Guide

## Database Connection Issue

If you're getting `password authentication failed for user "postgres"`, follow these steps:

### Step 1: Verify PostgreSQL is Running

```powershell
# Check if PostgreSQL service is running
Get-Service -Name postgresql*
```

If not running, start it:
```powershell
Start-Service postgresql-x64-XX  # Replace XX with your version
```

### Step 2: Check Your .env File

Your `kc-backend/.env` file should have:

```env
# Option 1: Full connection string
POSTGRES_URI=postgresql://postgres:YOUR_PASSWORD@localhost:5432/kc_database

# Option 2: Individual variables
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_actual_password_here
POSTGRES_DB=kc_database
```

### Step 3: Find Your PostgreSQL Password

If you forgot your PostgreSQL password:

**Option A: Reset via pgAdmin**
1. Open pgAdmin
2. Right-click on PostgreSQL server → Properties → Connection
3. Update password

**Option B: Reset via Command Line**
```powershell
# Windows: Edit pg_hba.conf to allow local connections without password temporarily
# Then reset password in psql
```

**Option C: Use Windows Authentication**
If you have Windows authentication enabled, you might not need a password.

### Step 4: Test Connection

```powershell
cd kc-backend\services\course-service
npm run check-db
```

### Step 5: Create the Course

Once connection works:

```powershell
npm run create-robotics-course
```

## Alternative: Create Course via API

If you prefer to create the course through the API after the service is running:

1. Start the course service
2. Use the API endpoints to create phases, levels, and sessions
3. Or use the script once database is configured

## Quick Fix: Update .env

1. Open `kc-backend/.env`
2. Find `POSTGRES_PASSWORD=` or `POSTGRES_URI=`
3. Update with your correct PostgreSQL password
4. Save the file
5. Run the script again

