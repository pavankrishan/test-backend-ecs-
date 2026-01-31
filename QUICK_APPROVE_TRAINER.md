# Quick Guide: How to Approve Trainer Applications

## Step-by-Step Process

### Step 1: Login as Admin
First, you need to get an admin authentication token:

```powershell
# Login to get admin token
$loginBody = @{
    email = "admin@example.com"
    password = "your-admin-password"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
$adminToken = $loginResponse.data.tokens.accessToken
Write-Host "Admin token: $adminToken"
```

### Step 2: View Pending Trainers
Get a list of trainers waiting for approval:

```powershell
$headers = @{ 
    "Authorization" = "Bearer $adminToken" 
}

# Get pending trainers with profile details
$pendingTrainers = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals?status=pending&includeProfile=true" -Method GET -Headers $headers

# Display in a readable format
$pendingTrainers.data | Format-Table id, email, username, approvalStatus -AutoSize

# Or view full details
$pendingTrainers.data | ConvertTo-Json -Depth 5
```

### Step 3: Review Trainer Details (Optional)
Before approving, you can view detailed information about a specific trainer:

```powershell
$trainerId = "TRAINER_ID_HERE"  # Replace with actual trainer ID
$trainerDetails = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals/$trainerId?includeProfile=true" -Method GET -Headers $headers
$trainerDetails.data | ConvertTo-Json -Depth 5
```

### Step 4: Approve Trainer
Once you've reviewed and decided to approve:

```powershell
$trainerId = "TRAINER_ID_HERE"  # Replace with actual trainer ID

# Approve the trainer
$result = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals/$trainerId/approve" -Method POST -Headers $headers

Write-Host "✅ Trainer approved successfully!"
Write-Host "Email: $($result.data.email)"
Write-Host "Status: $($result.data.approvalStatus)"
```

### Step 5: Verify Approval
Check that the trainer status has been updated:

```powershell
# Get the trainer again to verify
$trainer = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals/$trainerId" -Method GET -Headers $headers
Write-Host "Current status: $($trainer.data.approvalStatus)"
```

## Complete Example Script

Here's a complete PowerShell script that does everything:

```powershell
# ============================================
# Complete Trainer Approval Script
# ============================================

# Step 1: Login
Write-Host "🔐 Logging in as admin..." -ForegroundColor Cyan
$loginBody = @{
    email = "admin@example.com"
    password = "your-admin-password"
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
    $adminToken = $loginResponse.data.tokens.accessToken
    Write-Host "✅ Login successful!" -ForegroundColor Green
} catch {
    Write-Host "❌ Login failed: $_" -ForegroundColor Red
    exit 1
}

$headers = @{ 
    "Authorization" = "Bearer $adminToken" 
}

# Step 2: Get Pending Trainers
Write-Host "`n📋 Fetching pending trainers..." -ForegroundColor Cyan
try {
    $pendingTrainers = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals?status=pending&includeProfile=true" -Method GET -Headers $headers
    
    if ($pendingTrainers.data.Count -eq 0) {
        Write-Host "ℹ️  No pending trainers found." -ForegroundColor Yellow
        exit 0
    }
    
    Write-Host "Found $($pendingTrainers.data.Count) pending trainer(s):" -ForegroundColor Green
    $pendingTrainers.data | ForEach-Object {
        Write-Host "  - ID: $($_.id) | Email: $($_.email) | Username: $($_.username)" -ForegroundColor White
    }
    
    # Display first trainer's details
    $firstTrainer = $pendingTrainers.data[0]
    Write-Host "`n📄 First trainer details:" -ForegroundColor Cyan
    Write-Host "  Email: $($firstTrainer.email)"
    Write-Host "  Username: $($firstTrainer.username)"
    if ($firstTrainer.profile) {
        Write-Host "  Name: $($firstTrainer.profile.fullName)"
        Write-Host "  Experience: $($firstTrainer.profile.experienceYears) years"
    }
    
    # Step 3: Approve (uncomment to actually approve)
    # $trainerId = $firstTrainer.id
    # Write-Host "`n✅ Approving trainer $trainerId..." -ForegroundColor Cyan
    # $result = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals/$trainerId/approve" -Method POST -Headers $headers
    # Write-Host "✅ Trainer approved!" -ForegroundColor Green
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Red
}
```

## Alternative: Reject a Trainer

If you need to reject a trainer application:

```powershell
$trainerId = "TRAINER_ID_HERE"
$rejectionReason = "Insufficient qualifications"

$body = @{
    reason = $rejectionReason
} | ConvertTo-Json

$result = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals/$trainerId/reject" -Method POST -Headers $headers -Body $body -ContentType "application/json"

Write-Host "❌ Trainer rejected: $($result.data.email)"
Write-Host "Reason: $rejectionReason"
```

## Check Statistics

View overall approval statistics:

```powershell
$stats = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/admin/trainers/approvals/statistics" -Method GET -Headers $headers

Write-Host "📊 Trainer Approval Statistics:" -ForegroundColor Cyan
Write-Host "  Pending: $($stats.data.pending)" -ForegroundColor Yellow
Write-Host "  Approved: $($stats.data.approved)" -ForegroundColor Green
Write-Host "  Rejected: $($stats.data.rejected)" -ForegroundColor Red
Write-Host "  Total: $($stats.data.total)" -ForegroundColor White
```

## Important Notes

1. **Admin Token Required**: All operations require admin authentication
2. **Approved Trainers**: Only trainers with `approval_status = 'approved'` can be allocated to students
3. **Status Values**: `pending`, `approved`, `rejected`
4. **Profile Data**: Use `includeProfile=true` to see full trainer application details

## Troubleshooting

### Error: "Admin authentication required"
- Make sure you're using a valid admin token
- Token might have expired - login again

### Error: "Trainer not found"
- Verify the trainer ID is correct
- Check if the trainer exists in the database

### Error: "Invalid status"
- Status must be one of: `pending`, `approved`, `rejected`

