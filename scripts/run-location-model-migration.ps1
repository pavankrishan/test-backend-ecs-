# PowerShell script to run Enterprise Location Model Migration (009)
# Alternative to ts-node for Windows PowerShell

Write-Host "🚀 Starting Enterprise Location Model Migration (009)...`n" -ForegroundColor Green

# Load environment variables from .env file
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
    Write-Host "✅ Loaded environment variables from .env`n" -ForegroundColor Green
} else {
    Write-Host "⚠️  .env file not found, using environment variables`n" -ForegroundColor Yellow
}

# Get database connection string
$postgresUrl = $env:POSTGRES_URL
if (-not $postgresUrl) {
    $postgresUrl = $env:POSTGRES_URI
}
if (-not $postgresUrl) {
    $postgresUrl = $env:DATABASE_URL
}

if (-not $postgresUrl) {
    # Build from individual variables
    $host = if ($env:POSTGRES_HOST) { $env:POSTGRES_HOST } else { "localhost" }
    $port = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { "5432" }
    $user = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
    $password = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "postgres" }
    $database = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "postgres" }
    $ssl = if ($env:POSTGRES_SSL -eq "true") { "?sslmode=require" } else { "" }
    
    $encodedUser = [System.Web.HttpUtility]::UrlEncode($user)
    $encodedPassword = [System.Web.HttpUtility]::UrlEncode($password)
    $postgresUrl = "postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}${ssl}"
}

if (-not $postgresUrl) {
    Write-Host "❌ Database connection string not found!`n" -ForegroundColor Red
    Write-Host "   Please set POSTGRES_URL or POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB`n" -ForegroundColor Red
    exit 1
}

Write-Host "📡 Connecting to database..." -ForegroundColor Cyan
$hostPart = if ($postgresUrl -match '@([^/]+)') { $matches[1] } else { "hidden" }
Write-Host "   Host: $hostPart`n" -ForegroundColor Cyan

# Read migration SQL file
$migrationPath = Join-Path $PSScriptRoot "..\migrations\009-enterprise-location-model.sql"
if (-not (Test-Path $migrationPath)) {
    Write-Host "❌ Migration file not found: $migrationPath`n" -ForegroundColor Red
    exit 1
}

Write-Host "📄 Reading migration file: $migrationPath`n" -ForegroundColor Cyan
$migrationSQL = Get-Content $migrationPath -Raw

# Use psql to run the migration
Write-Host "📝 Executing migration SQL...`n" -ForegroundColor Cyan

# Extract connection details for psql
if ($postgresUrl -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)') {
    $dbUser = $matches[1]
    $dbPassword = $matches[2]
    $dbHost = $matches[3]
    $dbPort = $matches[4]
    $dbName = $matches[5]
    
    # Set PGPASSWORD environment variable for psql
    $env:PGPASSWORD = $dbPassword
    
    # Run migration using psql
    $tempFile = [System.IO.Path]::GetTempFileName()
    $migrationSQL | Out-File -FilePath $tempFile -Encoding UTF8
    
    try {
        $psqlPath = "psql"
        # Try to find psql in common locations
        if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
            $possiblePaths = @(
                "C:\Program Files\PostgreSQL\*\bin\psql.exe",
                "C:\Program Files (x86)\PostgreSQL\*\bin\psql.exe",
                "$env:LOCALAPPDATA\Programs\PostgreSQL\*\bin\psql.exe"
            )
            
            $found = $false
            foreach ($path in $possiblePaths) {
                $resolved = Resolve-Path $path -ErrorAction SilentlyContinue
                if ($resolved) {
                    $psqlPath = $resolved[0].Path
                    $found = $true
                    break
                }
            }
            
            if (-not $found) {
                Write-Host "❌ psql not found. Please install PostgreSQL client tools or use Node.js version.`n" -ForegroundColor Red
                Write-Host "   Alternative: Use 'npx ts-node scripts/run-location-model-migration.ts'`n" -ForegroundColor Yellow
                exit 1
            }
        }
        
        Write-Host "   Using psql: $psqlPath`n" -ForegroundColor Cyan
        
        $arguments = @(
            "-h", $dbHost,
            "-p", $dbPort,
            "-U", $dbUser,
            "-d", $dbName,
            "-f", $tempFile
        )
        
        & $psqlPath $arguments
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "`n✅ Migration completed successfully!`n" -ForegroundColor Green
            
            # Verify tables
            Write-Host "🔍 Verifying tables...`n" -ForegroundColor Cyan
            $tables = @("cities", "pincodes", "trainer_addresses", "trainer_base_locations")
            
            foreach ($table in $tables) {
                $checkQuery = "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$table');"
                $checkFile = [System.IO.Path]::GetTempFileName()
                $checkQuery | Out-File -FilePath $checkFile -Encoding UTF8
                
                $checkArgs = @(
                    "-h", $dbHost,
                    "-p", $dbPort,
                    "-U", $dbUser,
                    "-d", $dbName,
                    "-t", "-c", $checkQuery
                )
                
                $result = & $psqlPath $checkArgs 2>&1
                if ($result -match 't') {
                    Write-Host "   ✅ Table '$table' exists" -ForegroundColor Green
                } else {
                    Write-Host "   ❌ Table '$table' NOT found" -ForegroundColor Red
                }
                
                Remove-Item $checkFile -ErrorAction SilentlyContinue
            }
            
            Write-Host "`n🎉 Migration verification complete!`n" -ForegroundColor Green
        } else {
            Write-Host "`n❌ Migration failed! Exit code: $LASTEXITCODE`n" -ForegroundColor Red
            exit 1
        }
    } finally {
        Remove-Item $tempFile -ErrorAction SilentlyContinue
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "❌ Invalid database connection string format`n" -ForegroundColor Red
    exit 1
}

