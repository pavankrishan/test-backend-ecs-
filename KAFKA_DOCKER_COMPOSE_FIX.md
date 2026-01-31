# Kafka & ZooKeeper Docker Compose Fix

## Corrected docker-compose.yml Sections

### ZooKeeper Service
```yaml
zookeeper:
  image: confluentinc/cp-zookeeper:7.5.0
  container_name: kodingcaravan-zookeeper
  environment:
    ZOOKEEPER_CLIENT_PORT: 2181
    ZOOKEEPER_TICK_TIME: 2000
    ZOOKEEPER_SYNC_LIMIT: 2
    ZOOKEEPER_INIT_LIMIT: 5
    ZOOKEEPER_MAX_CLIENT_CNXNS: 60
    ZOOKEEPER_AUTOPURGE_SNAP_RETAIN_COUNT: 3
    ZOOKEEPER_AUTOPURGE_PURGE_INTERVAL: 24
  volumes:
    - zookeeper_data:/var/lib/zookeeper/data
    - zookeeper_logs:/var/lib/zookeeper/log
  healthcheck:
    test: ["CMD-SHELL", "bash -c 'exec 3<>/dev/tcp/localhost/2181 && echo -e \"ruok\" >&3 && cat <&3 | grep -q imok'"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
  networks:
    - kodingcaravan-network
  restart: unless-stopped
```

**Changes:**
1. ✅ Added persistent volumes for data and logs
2. ✅ Added healthcheck using ZooKeeper's `ruok` command
3. ✅ Added restart policy
4. ✅ Added connection and timeout optimizations
5. ✅ Added auto-purge for log cleanup

### Kafka Service
```yaml
kafka:
  image: confluentinc/cp-kafka:7.5.0
  container_name: kodingcaravan-kafka
  depends_on:
    zookeeper:
      condition: service_healthy
  ports:
    - "${KAFKA_PORT:-9092}:9092"
  environment:
    # Stable broker ID - must be unique and persistent
    KAFKA_BROKER_ID: 1
    # ZooKeeper connection - wait for ZooKeeper to be healthy
    KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
    KAFKA_ZOOKEEPER_SESSION_TIMEOUT_MS: 18000
    KAFKA_ZOOKEEPER_CONNECTION_TIMEOUT_MS: 18000
    # Listener configuration
    KAFKA_LISTENERS: PLAINTEXT://0.0.0.0:9092
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
    KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: PLAINTEXT:PLAINTEXT
    KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
    # Single broker configuration (dev)
    KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
    KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
    # Log retention and cleanup
    KAFKA_LOG_RETENTION_HOURS: 168
    KAFKA_LOG_SEGMENT_BYTES: 1073741824
    KAFKA_LOG_RETENTION_CHECK_INTERVAL_MS: 300000
    # Prevent broker ID conflicts on restart
    KAFKA_BROKER_ID_GENERATION_ENABLE: "false"
    # Auto create topics (disabled - use kafka-init)
    KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
    # Num network threads
    KAFKA_NUM_NETWORK_THREADS: 8
    KAFKA_NUM_IO_THREADS: 8
  volumes:
    - kafka_data:/var/lib/kafka/data
  healthcheck:
    test: ["CMD-SHELL", "kafka-broker-api-versions --bootstrap-server localhost:9092 || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 5
    start_period: 60s
  networks:
    - kodingcaravan-network
  restart: unless-stopped
```

**Changes:**
1. ✅ Changed `depends_on` to use `service_healthy` condition
2. ✅ Added persistent volume for Kafka data
3. ✅ Added extended ZooKeeper timeouts (18s)
4. ✅ Disabled broker ID generation (fixed ID: 1)
5. ✅ Disabled auto-create topics
6. ✅ Added log retention settings
7. ✅ Extended healthcheck start period (60s)
8. ✅ Added restart policy

### Volumes Section
```yaml
volumes:
  postgres_data:
  mongo_data:
  redis_data:
  minio_data:
  zookeeper_data:      # NEW
  zookeeper_logs:      # NEW
  kafka_data:          # NEW
```

**Changes:**
1. ✅ Added `zookeeper_data` volume
2. ✅ Added `zookeeper_logs` volume
3. ✅ Added `kafka_data` volume

## Explanation of Changes

### 1. ZooKeeper Healthcheck
**Why:** Kafka was starting before ZooKeeper was ready, causing connection failures.

**Fix:** Added healthcheck that verifies ZooKeeper responds to `ruok` command. Kafka now waits for ZooKeeper to be healthy before starting.

### 2. Persistent Volumes
**Why:** Without volumes, broker ID registrations were lost on restart, causing `NodeExistsException`.

**Fix:** Added volumes for ZooKeeper data/logs and Kafka data. Broker ID is now persisted across restarts.

### 3. Restart Policies
**Why:** Containers didn't automatically recover from failures.

**Fix:** Added `restart: unless-stopped` to both services. They will automatically restart on failure.

### 4. ZooKeeper Timeouts
**Why:** Default timeouts were too short for slow startup scenarios.

**Fix:** Increased session and connection timeouts to 18 seconds, giving more time for ZooKeeper to respond.

### 5. Broker ID Generation Disabled
**Why:** Auto-generated broker IDs can cause conflicts.

**Fix:** Disabled generation, using fixed ID 1. With persistent volumes, this ID is consistent.

### 6. Healthcheck Start Periods
**Why:** Services need time to initialize before healthchecks should start.

**Fix:** Added 30s start period for ZooKeeper, 60s for Kafka. Prevents false negatives during startup.

## Dev Reset Command

### Linux/Mac
```bash
chmod +x reset-kafka-dev.sh
./reset-kafka-dev.sh
```

### Windows PowerShell
```powershell
.\reset-kafka-dev.ps1
```

**What it does:**
- Stops Kafka, ZooKeeper, kafka-init
- Removes containers and volumes (all data deleted)
- Restarts in correct order with healthchecks
- Recreates topics

**⚠️ WARNING:** Deletes all Kafka/ZooKeeper data. Development only!

## Production Recommendation

### ❌ DO NOT use this Docker Compose setup in production

**Reasons:**
- Single broker = no fault tolerance
- Single ZooKeeper = no high availability
- No security (PLAINTEXT)
- Limited scalability

### ✅ Use Managed Kafka Services

**Recommended Options:**
1. **AWS MSK** - Fully managed, auto-scaling, multi-AZ
2. **Confluent Cloud** - Global, schema registry included
3. **Azure Event Hubs** - Serverless, pay-per-use
4. **Google Pub/Sub** - Serverless alternative

**Benefits:**
- High availability (multi-AZ)
- Automatic backups
- Security (TLS, IAM)
- Monitoring and alerting
- Auto-scaling
- No operational overhead

## Verification

```bash
# Check services are healthy
docker-compose ps kafka zookeeper

# Check logs
docker-compose logs -f kafka

# Verify Kafka is responding
docker exec kodingcaravan-kafka kafka-broker-api-versions --bootstrap-server localhost:9092

# List topics
docker exec kodingcaravan-kafka kafka-topics --list --bootstrap-server localhost:9092
```

## Summary

✅ **Fixed:**
- Broker ID conflicts (persistent volumes)
- Startup race conditions (healthchecks)
- Data loss on restart (volumes)
- No automatic recovery (restart policies)

✅ **Stable for:**
- Development
- Testing
- Local workflows

❌ **Not for:**
- Production
- High availability requirements
- Multi-node deployments

