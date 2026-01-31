# Install and Setup Google Cloud SDK for FCM v1 API

Write-Host ""
Write-Host "Google Cloud SDK Setup for FCM v1 API" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if gcloud is already installed
$gcloud = Get-Command gcloud -ErrorAction SilentlyContinue

if ($gcloud) {
    Write-Host "gcloud CLI is already installed!" -ForegroundColor Green
    Write-Host "   Location: $($gcloud.Source)" -ForegroundColor White
} else {
    Write-Host "Installing Google Cloud SDK..." -ForegroundColor Yellow
    Write-Host "   This may take a few minutes..." -ForegroundColor White
    
    # Try to install using winget
    try {
        winget install Google.CloudSDK --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Google Cloud SDK installed successfully!" -ForegroundColor Green
            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        } else {
            Write-Host "Installation failed. Please install manually:" -ForegroundColor Red
            Write-Host "   Download from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
            exit 1
        }
    } catch {
        Write-Host "Could not install via winget. Please install manually:" -ForegroundColor Red
        Write-Host "   Download from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
        exit 1
    }
    
    # Wait a moment for PATH to update
    Start-Sleep -Seconds 2
    
    # Check if gcloud is now available
    $gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
    if (-not $gcloud) {
        Write-Host ""
        Write-Host "gcloud not found in PATH. You may need to:" -ForegroundColor Yellow
        Write-Host "   1. Restart your terminal" -ForegroundColor White
        Write-Host "   2. Or add gcloud to PATH manually" -ForegroundColor White
        Write-Host ""
        Write-Host "   After restarting, run this script again or run:" -ForegroundColor Cyan
        Write-Host "   gcloud auth login" -ForegroundColor White
        Write-Host "   gcloud auth application-default login" -ForegroundColor White
        exit 0
    }
}

Write-Host ""
Write-Host "Setting up authentication..." -ForegroundColor Yellow

# Check if already authenticated
$authList = gcloud auth list 2>&1
if ($authList -match "ACTIVE") {
    Write-Host "Already authenticated with gcloud" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Opening browser for authentication..." -ForegroundColor Cyan
    Write-Host "   Please sign in with your Google account that has access to the Firebase project" -ForegroundColor White
    gcloud auth login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Authentication failed" -ForegroundColor Red
        exit 1
    }
}

# Set up Application Default Credentials
Write-Host ""
Write-Host "Setting up Application Default Credentials..." -ForegroundColor Yellow
Write-Host "   This will open a browser again..." -ForegroundColor White
gcloud auth application-default login
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to set up Application Default Credentials" -ForegroundColor Red
    exit 1
}

# Set the project
Write-Host ""
Write-Host "Setting project to kodingcaravan-c1a5f..." -ForegroundColor Yellow
gcloud config set project kodingcaravan-c1a5f
if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not set project. You can set it manually:" -ForegroundColor Yellow
    Write-Host "   gcloud config set project kodingcaravan-c1a5f" -ForegroundColor White
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "   1. Restart your backend: pnpm dev" -ForegroundColor White
Write-Host "   2. Check logs for: FCM Service initialized with HTTP v1 API" -ForegroundColor White
Write-Host "   3. Test notifications: node test-notification.js YOUR_USER_ID" -ForegroundColor White
Write-Host ""
