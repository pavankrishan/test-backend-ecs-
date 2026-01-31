# Build and Run All Backend Services
# This script builds and starts all KodingCaravan backend services

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "KodingCaravan Backend Services" -ForegroundColor Cyan
Write-Host "Build and Run Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "Checking Docker status..." -ForegroundColor Yellow
try {
    docker ps | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running or not accessible" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again" -ForegroundColor Yellow
    exit 1
}

# Build all services
Write-Host ""
Write-Host "Building all services (this may take several minutes)..." -ForegroundColor Yellow
Write-Host ""

docker compose build --parallel

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Build failed. Please check the errors above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Build completed successfully!" -ForegroundColor Green
Write-Host ""

# Ask if user wants to start services
$response = Read-Host "Do you want to start all services now? (Y/N)"
if ($response -eq 'Y' -or $response -eq 'y') {
    Write-Host ""
    Write-Host "Starting all services..." -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Yellow
    Write-Host ""
    
    docker compose up
} else {
    Write-Host ""
    Write-Host "To start services manually, run:" -ForegroundColor Cyan
    Write-Host "  docker compose up" -ForegroundColor White
    Write-Host ""
    Write-Host "Or to run in detached mode (background):" -ForegroundColor Cyan
    Write-Host "  docker compose up -d" -ForegroundColor White
    Write-Host ""
}
