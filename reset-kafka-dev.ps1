# Safe development reset script for Kafka and ZooKeeper (Windows PowerShell)
# WARNING: This deletes all Kafka and ZooKeeper data - use only in development

function Wait-ForHealthy {
    param(
        [string]$ContainerName,
        [int]$MaxWaitSeconds = 120,
        [string]$ServiceName
    )
    
    Write-Host "[WAIT] Waiting for $ServiceName to be healthy (max $MaxWaitSeconds seconds)..." -ForegroundColor Cyan
    $elapsed = 0
    $checkInterval = 5
    
    while ($elapsed -lt $MaxWaitSeconds) {
        $health = docker inspect --format='{{.State.Health.Status}}' $ContainerName 2>$null
        if ($health -eq "healthy") {
            Write-Host "[OK] $ServiceName is healthy!" -ForegroundColor Green
            return $true
        }
        
        if ($health -eq "unhealthy") {
            Write-Host "[WARN] $ServiceName is unhealthy. Checking logs..." -ForegroundColor Yellow
            docker logs --tail 20 $ContainerName
            Write-Host "[INFO] Continuing to wait..." -ForegroundColor Cyan
        }
        
        Start-Sleep -Seconds $checkInterval
        $elapsed += $checkInterval
        Write-Host "  ... still waiting ($elapsed/$MaxWaitSeconds seconds)" -ForegroundColor Gray
    }
    
    Write-Host "[ERROR] $ServiceName did not become healthy within $MaxWaitSeconds seconds" -ForegroundColor Red
    Write-Host "[INFO] Current status:" -ForegroundColor Yellow
    docker inspect --format='Status: {{.State.Status}}, Health: {{.State.Health.Status}}' $ContainerName
    Write-Host "[INFO] Recent logs:" -ForegroundColor Yellow
    docker logs --tail 30 $ContainerName
    return $false
}

Write-Host "[STOP] Stopping Kafka and ZooKeeper containers..." -ForegroundColor Yellow
docker-compose stop kafka zookeeper kafka-init 2>$null

Write-Host "[REMOVE] Removing Kafka and ZooKeeper containers..." -ForegroundColor Yellow
docker-compose rm -f kafka zookeeper kafka-init 2>$null

Write-Host "[DELETE] Removing Kafka and ZooKeeper volumes (all data will be lost)..." -ForegroundColor Yellow
docker volume rm kc-backend_kafka_data kc-backend_zookeeper_data kc-backend_zookeeper_logs 2>$null

Write-Host "[OK] Cleanup complete. Starting ZooKeeper..." -ForegroundColor Green
docker-compose up -d zookeeper

if (-not (Wait-ForHealthy -ContainerName "kodingcaravan-zookeeper" -MaxWaitSeconds 90 -ServiceName "ZooKeeper")) {
    Write-Host "[ERROR] ZooKeeper failed to become healthy. Cannot proceed." -ForegroundColor Red
    exit 1
}

Write-Host "[START] Starting Kafka..." -ForegroundColor Green
docker-compose up -d kafka

if (-not (Wait-ForHealthy -ContainerName "kodingcaravan-kafka" -MaxWaitSeconds 120 -ServiceName "Kafka")) {
    Write-Host "[ERROR] Kafka failed to become healthy. Cannot proceed." -ForegroundColor Red
    exit 1
}

Write-Host "[START] Starting Kafka init to create topics..." -ForegroundColor Green
docker-compose up kafka-init

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Kafka and ZooKeeper reset complete!" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Kafka init failed. Check logs above." -ForegroundColor Red
}

Write-Host ""
Write-Host "[STATUS] Final status:" -ForegroundColor Cyan
docker-compose ps kafka zookeeper

