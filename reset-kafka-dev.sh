#!/bin/bash
# Safe development reset script for Kafka and ZooKeeper
# WARNING: This deletes all Kafka and ZooKeeper data - use only in development

set -e

echo "🛑 Stopping Kafka and ZooKeeper containers..."
docker-compose stop kafka zookeeper kafka-init

echo "🗑️  Removing Kafka and ZooKeeper containers..."
docker-compose rm -f kafka zookeeper kafka-init

echo "💾 Removing Kafka and ZooKeeper volumes (all data will be lost)..."
docker volume rm kc-backend_kafka_data kc-backend_zookeeper_data kc-backend_zookeeper_logs 2>/dev/null || true

echo "✅ Cleanup complete. Starting Kafka and ZooKeeper..."
docker-compose up -d zookeeper

echo "⏳ Waiting for ZooKeeper to be healthy (30 seconds)..."
sleep 30

docker-compose up -d kafka

echo "⏳ Waiting for Kafka to be healthy (60 seconds)..."
sleep 60

echo "🚀 Starting Kafka init to create topics..."
docker-compose up kafka-init

echo "✅ Kafka and ZooKeeper reset complete!"
echo ""
echo "📊 Check status:"
docker-compose ps kafka zookeeper

