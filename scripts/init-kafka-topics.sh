#!/bin/bash
# Initialize Kafka topics for event-driven workers
# This script ensures all required topics exist before workers start

set -e

KAFKA_BROKER="${KAFKA_BROKER:-kafka:9092}"
MAX_WAIT=60
WAIT_INTERVAL=5

echo "[Kafka Topics] Waiting for Kafka broker at $KAFKA_BROKER..."

# Wait for Kafka to be ready
for i in $(seq 1 $MAX_WAIT); do
  if kafka-broker-api-versions --bootstrap-server "$KAFKA_BROKER" > /dev/null 2>&1; then
    echo "[Kafka Topics] Kafka broker is ready"
    break
  fi
  if [ $i -eq $MAX_WAIT ]; then
    echo "[Kafka Topics] ERROR: Kafka broker not ready after ${MAX_WAIT}s"
    exit 1
  fi
  echo "[Kafka Topics] Waiting for Kafka... ($i/$MAX_WAIT)"
  sleep $WAIT_INTERVAL
done

# Function to create topic if it doesn't exist
create_topic_if_not_exists() {
  local topic=$1
  local partitions=${2:-3}
  local replication=${3:-1}
  
  if kafka-topics --bootstrap-server "$KAFKA_BROKER" --list | grep -q "^${topic}$"; then
    echo "[Kafka Topics] Topic '$topic' already exists"
  else
    echo "[Kafka Topics] Creating topic '$topic' with $partitions partitions, replication factor $replication"
    kafka-topics --create \
      --bootstrap-server "$KAFKA_BROKER" \
      --topic "$topic" \
      --partitions "$partitions" \
      --replication-factor "$replication" \
      --if-not-exists || {
      echo "[Kafka Topics] WARNING: Failed to create topic '$topic' (may already exist)"
    }
  fi
}

# Create all required topics
echo "[Kafka Topics] Initializing required topics..."

create_topic_if_not_exists "purchase-confirmed" 3 1
create_topic_if_not_exists "purchase-created" 3 1
create_topic_if_not_exists "trainer-allocated" 3 1
create_topic_if_not_exists "sessions-generated" 3 1
create_topic_if_not_exists "course-access-granted" 3 1
create_topic_if_not_exists "dead-letter-queue" 3 1

echo "[Kafka Topics] ✅ All topics initialized"
echo "[Kafka Topics] Listing all topics:"
kafka-topics --bootstrap-server "$KAFKA_BROKER" --list

