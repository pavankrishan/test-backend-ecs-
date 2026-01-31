# Start Admin Service Script
Write-Host "Starting Admin Service..." -ForegroundColor Cyan
Write-Host ""

$servicePath = "C:\Users\PC\Desktop\React-Expo-set\kc-backend\services\admin-service"

if (-not (Test-Path $servicePath)) {
    Write-Host "Error: admin-service directory not found" -ForegroundColor Red
    exit 1
}

Set-Location $servicePath

Write-Host "Starting service with pnpm dev..." -ForegroundColor Cyan
Write-Host "This will open in a new window" -ForegroundColor Gray
Write-Host ""

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$servicePath'; Write-Host 'Admin Service Starting...' -ForegroundColor Cyan; pnpm dev"

Write-Host "Waiting for service to start (15 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

Write-Host ""
Write-Host "Testing service..." -ForegroundColor Cyan
try {
    $result = Invoke-RestMethod -Uri "http://localhost:3010/healthz" -Method GET -TimeoutSec 3
    Write-Host "SUCCESS! Admin Service is running!" -ForegroundColor Green
} catch {
    Write-Host "Service may still be starting. Check the admin-service window." -ForegroundColor Yellow
    Write-Host "Look for: Admin Service is ready to accept requests" -ForegroundColor Green
}

Write-Host ""
Write-Host "You can now try your login request again." -ForegroundColor Cyan
