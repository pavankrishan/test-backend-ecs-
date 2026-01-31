# FCM v1 API Setup Helper Script
# This script helps you set up FCM HTTP v1 API with OAuth2

Write-Host "`n🔥 FCM HTTP v1 API Setup Helper" -ForegroundColor Cyan
Write-Host "================================`n" -ForegroundColor Cyan

# Step 1: Check .env file
Write-Host "1️⃣  Checking .env file..." -ForegroundColor Yellow
if (Test-Path .env) {
    Write-Host "   ✅ .env file exists" -ForegroundColor Green
    
    $envContent = Get-Content .env -Raw
    
    # Check FIREBASE_PROJECT_ID
    if ($envContent -match "FIREBASE_PROJECT_ID\s*=") {
        $projectId = ($envContent | Select-String -Pattern "FIREBASE_PROJECT_ID\s*=\s*(.+)").Matches.Groups[1].Value.Trim()
        Write-Host "   ✅ FIREBASE_PROJECT_ID: $projectId" -ForegroundColor Green
    } else {
        Write-Host "   ❌ FIREBASE_PROJECT_ID not found" -ForegroundColor Red
        Write-Host "   💡 Add to .env: FIREBASE_PROJECT_ID=kodingcaravan-c1a5f" -ForegroundColor Yellow
    }
    
    # Check FIREBASE_SERVICE_ACCOUNT_EMAIL
    if ($envContent -match "FIREBASE_SERVICE_ACCOUNT_EMAIL\s*=") {
        $email = ($envContent | Select-String -Pattern "FIREBASE_SERVICE_ACCOUNT_EMAIL\s*=\s*(.+)").Matches.Groups[1].Value.Trim()
        Write-Host "   ✅ FIREBASE_SERVICE_ACCOUNT_EMAIL: $email" -ForegroundColor Green
    } else {
        Write-Host "   ❌ FIREBASE_SERVICE_ACCOUNT_EMAIL not found" -ForegroundColor Red
        Write-Host "   💡 Get it from: Firebase Console → Project Settings → Cloud Messaging → Service account" -ForegroundColor Yellow
        Write-Host "   💡 Add to .env: FIREBASE_SERVICE_ACCOUNT_EMAIL=firebase-adminsdk-...@kodingcaravan-c1a5f.iam.gserviceaccount.com" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ .env file not found" -ForegroundColor Red
    Write-Host "   💡 Create .env file in kc-backend/ directory" -ForegroundColor Yellow
}

Write-Host "`n2️⃣  Checking gcloud CLI..." -ForegroundColor Yellow
$gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
if ($gcloud) {
    Write-Host "   ✅ gcloud CLI is installed" -ForegroundColor Green
    Write-Host "   Location: $($gcloud.Source)" -ForegroundColor White
    
    # Check if authenticated
    Write-Host "`n   Checking authentication..." -ForegroundColor Cyan
    $authCheck = gcloud auth list 2>&1
    if ($authCheck -match "ACTIVE") {
        Write-Host "   ✅ gcloud is authenticated" -ForegroundColor Green
        
        # Check application-default credentials
        $adcCheck = gcloud auth application-default print-access-token 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "   ✅ Application Default Credentials are set up" -ForegroundColor Green
        } else {
            Write-Host "   ❌ Application Default Credentials not set up" -ForegroundColor Red
            Write-Host "   💡 Run: gcloud auth application-default login" -ForegroundColor Yellow
        }
        
        # Check project
        $project = gcloud config get-value project 2>&1
        if ($project -and $project -ne "None") {
            Write-Host "   ✅ Current project: $project" -ForegroundColor Green
            if ($project -ne "kodingcaravan-c1a5f") {
                Write-Host "   ⚠️  Project mismatch. Run: gcloud config set project kodingcaravan-c1a5f" -ForegroundColor Yellow
            }
        } else {
            Write-Host "   ❌ No project set" -ForegroundColor Red
            Write-Host "   💡 Run: gcloud config set project kodingcaravan-c1a5f" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ❌ gcloud not authenticated" -ForegroundColor Red
        Write-Host "   💡 Run: gcloud auth login" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ gcloud CLI not found" -ForegroundColor Red
    Write-Host "   💡 Install it:" -ForegroundColor Yellow
    Write-Host "      winget install Google.CloudSDK" -ForegroundColor White
    Write-Host "      OR download from: https://cloud.google.com/sdk/docs/install" -ForegroundColor White
}

Write-Host "`n3️⃣  Next Steps:" -ForegroundColor Yellow
Write-Host "`n   If everything is OK, you're ready!" -ForegroundColor Green
Write-Host "   Restart your backend: pnpm dev" -ForegroundColor Cyan
Write-Host "   Check logs for: 'FCM Service initialized with HTTP v1 API'" -ForegroundColor Cyan
Write-Host "`n   If you see errors, follow the suggestions above" -ForegroundColor Yellow
Write-Host "`n📄 Full guide: kc-backend/FCM_V1_SETUP.md" -ForegroundColor Cyan
Write-Host ""

