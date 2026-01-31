# Kafka & ZooKeeper Stability Fix

## Problem
Kafka was crashing on startup with `KeeperException$NodeExistsException at /brokers/ids/1` due to:
1. Missing ZooKeeper healthcheck - Kafka started before ZooKeeper was ready
2. No data persistence - Broker ID conflicts on restart
3. Missing restart policies - Containers didn't recover from failures
4. No proper dependency health checks

## Changes Made

### 1. ZooKeeper Configuration
**Added:**
- ✅ Healthcheck using `ruok` command (checks if ZooKeeper is ready)
- ✅ Persistent volumes for data and logs
- ✅ Restart policy: `unless-stopped`
- ✅ Optimized timeouts and connection limits
- ✅ Auto-purge configuration for log cleanup

**Why:**
- Healthcheck ensures Kafka waits for ZooKeeper to be ready
- Persistent volumes prevent broker ID conflicts on restart
- Restart policy ensures automatic recovery

### 2. Kafka Configuration
**Added:**
- ✅ Persistent volume for Kafka data
- ✅ Proper `depends_on` with `service_healthy` condition
- ✅ Extended ZooKeeper session/connection timeouts (18s)
- ✅ Disabled broker ID generation (uses fixed ID: 1)
- ✅ Disabled auto-create topics (use kafka-init instead)
- ✅ Log retention and cleanup settings
- ✅ Extended healthcheck start period (60s for initial startup)
- ✅ Restart policy: `unless-stopped`

**Why:**
- Persistent volume ensures broker ID consistency
- Healthcheck dependency prevents Kafka starting before ZooKeeper
- Fixed broker ID prevents conflicts
- Extended timeouts handle slow startup scenarios

### 3. Volume Configuration
**Added volumes:**
- `zookeeper_data` - ZooKeeper data directory
- `zookeeper_logs` - ZooKeeper transaction logs
- `kafka_data` - Kafka log directories

**Why:**
- Data persistence across restarts
- Prevents broker ID conflicts
- Maintains topic and offset data

## Startup Sequence
1. ZooKeeper starts → waits for healthcheck (30s start period)
2. Kafka waits for ZooKeeper healthcheck → starts after ZooKeeper is healthy
3. Kafka healthcheck passes (60s start period)
4. kafka-init runs → creates topics
5. Workers start → connect to Kafka

## Development Reset

### Safe Dev Reset (Deletes All Data)
```bash
# Make script executable (first time only)
chmod +x reset-kafka-dev.sh

# Run reset
./reset-kafka-dev.sh
```

**What it does:**
- Stops Kafka, ZooKeeper, and kafka-init
- Removes containers
- Deletes all volumes (all data lost)
- Restarts services in correct order
- Recreates topics

**When to use:**
- Testing workflows from scratch
- Debugging broker ID conflicts
- After configuration changes
- Development only - never in production

### Manual Reset (If Script Fails)
```bash
# Stop services
docker-compose stop kafka zookeeper kafka-init

# Remove containers
docker-compose rm -f kafka zookeeper kafka-init

# Remove volumes
docker volume rm kc-backend_kafka_data kc-backend_zookeeper_data kc-backend_zookeeper_logs

# Restart
docker-compose up -d zookeeper
sleep 30  # Wait for ZooKeeper
docker-compose up -d kafka
sleep 60  # Wait for Kafka
docker-compose up kafka-init
```

## Production Recommendations

### ⚠️ DO NOT use this Docker Compose setup in production

**Why:**
- Single broker = no fault tolerance
- Single ZooKeeper = no high availability
- No security (PLAINTEXT protocol)
- Limited scalability
- Manual topic management

### Production Options

#### Option 1: Managed Kafka (Recommended)
**AWS MSK (Managed Streaming for Kafka)**
- ✅ Fully managed, auto-scaling
- ✅ Multi-AZ high availability
- ✅ Automatic backups
- ✅ Security (TLS, IAM)
- ✅ Monitoring and alerting

**Confluent Cloud**
- ✅ Fully managed
- ✅ Global availability
- ✅ Schema registry included
- ✅ Advanced monitoring

**Azure Event Hubs / Google Pub/Sub**
- ✅ Serverless alternatives
- ✅ Auto-scaling
- ✅ Pay-per-use

#### Option 2: Self-Hosted (Advanced)
If you must self-host:
- Use Kafka operator (Strimzi) on Kubernetes
- Minimum 3 ZooKeeper nodes (quorum)
- Minimum 3 Kafka brokers (replication factor 3)
- TLS encryption
- SASL authentication
- Persistent volumes with backups
- Monitoring (Prometheus + Grafana)

## Verification

### Check Services
```bash
# Check container status
docker-compose ps kafka zookeeper

# Check logs
docker-compose logs -f kafka
docker-compose logs -f zookeeper

# Check Kafka health
docker exec kodingcaravan-kafka kafka-broker-api-versions --bootstrap-server localhost:9092

# List topics
docker exec kodingcaravan-kafka kafka-topics --list --bootstrap-server localhost:9092
```

### Expected Topics
- `purchase-confirmed`
- `purchase-created`
- `trainer-allocated`
- `dead-letter-queue`

## Troubleshooting

### Broker ID Conflict Still Occurs
```bash
# Check ZooKeeper for stale broker registrations
docker exec kodingcaravan-zookeeper zkCli.sh ls /brokers/ids

# If you see broker ID 1, clean it:
docker exec kodingcaravan-zookeeper zkCli.sh delete /brokers/ids/1

# Then restart Kafka
docker-compose restart kafka
```

### Kafka Won't Start
1. Check ZooKeeper is healthy: `docker-compose ps zookeeper`
2. Check ZooKeeper logs: `docker-compose logs zookeeper`
3. Check Kafka logs: `docker-compose logs kafka`
4. Verify volumes exist: `docker volume ls | grep kafka`
5. Try reset script: `./reset-kafka-dev.sh`

### Topics Not Created
```bash
# Manually create topics
docker exec kodingcaravan-kafka kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic purchase-confirmed \
  --partitions 3 \
  --replication-factor 1 \
  --if-not-exists
```

## Summary

✅ **Fixed Issues:**
- Broker ID conflicts resolved with persistent volumes
- Startup race condition fixed with healthchecks
- Data persistence ensures consistency
- Restart policies enable automatic recovery

✅ **Production Ready:**
- No - use managed Kafka service
- This setup is for development only

✅ **Dev Reset:**
- Use `./reset-kafka-dev.sh` for clean slate
- Deletes all data - development only

