# Debug script to start Admin Service and capture errors
Write-Host "Starting Admin Service in debug mode..." -ForegroundColor Cyan
Write-Host ""

$servicePath = "C:\Users\PC\Desktop\React-Expo-set\kc-backend\services\admin-service"

if (-not (Test-Path $servicePath)) {
    Write-Host "Error: admin-service directory not found" -ForegroundColor Red
    exit 1
}

Set-Location $servicePath

Write-Host "Current directory: $(Get-Location)" -ForegroundColor Gray
Write-Host ""

# Check if shared package is built
$sharedDist = "C:\Users\PC\Desktop\React-Expo-set\kc-backend\shared\dist\index.js"
if (-not (Test-Path $sharedDist)) {
    Write-Host "⚠️  Shared package not built. Building now..." -ForegroundColor Yellow
    Set-Location "C:\Users\PC\Desktop\React-Expo-set\kc-backend"
    pnpm --filter @kodingcaravan/shared build
    Set-Location $servicePath
}

Write-Host "Starting service..." -ForegroundColor Cyan
Write-Host ""

# Start the service and capture output
pnpm exec tsx watch src/index.ts

