# Admin Login and Create Allocation Script
Write-Host "=== Admin Login and Create Allocation ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Login as Admin
Write-Host "Step 1: Logging in as admin..." -ForegroundColor Yellow
$loginBody = @{
    email = "admin@kodingcaravan.com"
    password = "KodingCaravan!23"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
    $adminToken = $loginResponse.data.tokens.accessToken
    Write-Host "✓ Login successful! Token obtained." -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "✗ Login failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Create Allocation
Write-Host "Step 2: Creating allocation..." -ForegroundColor Yellow
$headers = @{
    "Authorization" = "Bearer $adminToken"
    "Content-Type" = "application/json"
}

$allocationBody = @{
    studentId = "c728fd99-a3b3-499c-9ba4-74990ce883d4"
    trainerId = "ad387c78-bec8-48c7-8c75-05d915874753"
    courseId = "f21af68c-f2f3-4afc-8c48-42cedb8a6e44"
    requestedBy = "5c3c01ad-5595-40b5-8fcf-aea311984df1"
    notes = "Allocated after course purchase"
    metadata = @{
        paymentId = "73f65427-9cc8-4f11-a705-9b8187f74b08"
    }
} | ConvertTo-Json -Depth 5

try {
    $allocationResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/allocations" -Method POST -Headers $headers -Body $allocationBody
    $allocationId = $allocationResponse.data.id
    Write-Host "✓ Allocation created successfully! ID: $allocationId" -ForegroundColor Green
    Write-Host ""
    
    # Step 3: Approve the allocation
    Write-Host "Step 3: Approving allocation..." -ForegroundColor Yellow
    $approveBody = @{
        trainerId = "ad387c78-bec8-48c7-8c75-05d915874753"
    } | ConvertTo-Json
    
    try {
        $approveResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/allocations/$allocationId/approve" -Method POST -Headers $headers -Body $approveBody
        Write-Host "✓ Allocation approved successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Final Allocation Details:" -ForegroundColor Cyan
        $approveResponse | ConvertTo-Json -Depth 10
    } catch {
        Write-Host "✗ Allocation approval failed: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "Response: $responseBody" -ForegroundColor Red
        }
        exit 1
    }
} catch {
    Write-Host "✗ Allocation creation failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
    exit 1
}

