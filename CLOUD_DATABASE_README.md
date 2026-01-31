# ☁️ Cloud Database Setup Guide

Your production-grade PostgreSQL database is now **cloud-ready**! This guide covers everything you need to deploy and manage your database in the cloud.

## 🚀 Quick Start (5 minutes)

### 1. Choose Your Cloud Provider
```bash
# AWS RDS (Recommended for enterprise)
# Google Cloud SQL (Easy setup)
# Azure Database (Microsoft ecosystem)
# Supabase (Developer-friendly)
# Neon (Serverless)
```

### 2. Configure Environment
```bash
# Copy the example configuration
cp env.cloud.example .env

# Edit with your cloud database credentials
nano .env
```

### 3. Initialize Database
```bash
# One-command setup
node scripts/init-production-database.js

# Expected output: "🎉 Production Database Initialization Complete!"
```

### 4. Verify Setup
```bash
# Check database status
node scripts/cloud-db-status.js

# Monitor continuously
node scripts/monitor-cloud-database.js --continuous
```

---

## 📁 What Was Created

### Core Files
```
📁 shared/databases/postgres/
├── schema.sql              # Complete production schema
├── cloud-connection.ts     # Cloud-optimized connection pool
└── connection.ts           # Backward compatibility layer

📁 scripts/
├── init-production-database.js    # Database setup script
├── run-schema-migration.js        # Migration runner
├── monitor-cloud-database.js      # Performance monitoring
└── cloud-db-status.js            # Status checker

📁 env.cloud.example         # Configuration examples
📁 CLOUD_DATABASE_DEPLOYMENT.md  # Detailed deployment guide
```

### Production Features
- ✅ **SSL/TLS Encryption** (required for cloud)
- ✅ **Connection Pooling** (optimized per provider)
- ✅ **Health Monitoring** (real-time metrics)
- ✅ **Auto-scaling Ready** (connection pool management)
- ✅ **Backup Integration** (cloud provider backups)
- ✅ **Security Hardened** (IAM, VPC, encryption)

---

## 🔧 Cloud Provider Setup

### AWS RDS PostgreSQL
```bash
# Environment variables
DATABASE_URL=postgresql://user:pass@instance.rds.amazonaws.com:5432/db?sslmode=require
POOL_MAX=50          # RDS can handle more connections
POOL_CONNECTION_TIMEOUT=30000  # RDS failover can be slow
```

### Google Cloud SQL
```bash
# Environment variables
DATABASE_URL=postgresql://user:pass@project:region:instance/db?sslmode=require
POOL_MAX=25          # Cloud SQL connection limits
POOL_IDLE_TIMEOUT=60000  # Keeps connections alive longer
```

### Azure Database
```bash
# Environment variables
DATABASE_URL=postgresql://user@server:pass@server.postgres.database.azure.com:5432/db?sslmode=require
POOL_MAX=30          # Azure connection limits
```

### Supabase
```bash
# Environment variables
DATABASE_URL=postgresql://postgres:pass@db.project.supabase.co:5432/postgres
POOL_MAX=15          # Supabase has strict limits
```

---

## 📊 Monitoring & Maintenance

### Health Checks
```bash
# Quick status check
node scripts/cloud-db-status.js

# Detailed monitoring
node scripts/monitor-cloud-database.js

# Continuous monitoring (Ctrl+C to stop)
node scripts/monitor-cloud-database.js --continuous
```

### Key Metrics to Monitor
- **Connection Pool**: Total, idle, waiting clients
- **Response Time**: Query execution time
- **Database Size**: Growth over time
- **Slow Queries**: Queries > 1 second
- **Active Connections**: Current usage vs limits

### Automated Monitoring
```javascript
// Add to your application
const { checkCloudDatabaseHealth } = require('./shared/databases/postgres/cloud-connection');

setInterval(async () => {
  const health = await checkCloudDatabaseHealth(pool);
  if (!health.isHealthy) {
    // Send alert to monitoring system
    console.error('🚨 Database unhealthy:', health.errors);
  }
}, 30000); // Check every 30 seconds
```

---

## 🔧 Configuration Options

### Connection Pool Tuning
```bash
# Adjust based on your cloud provider limits
POOL_MIN=2                    # Minimum connections
POOL_MAX=20                   # Maximum connections (provider-dependent)
POOL_IDLE_TIMEOUT=30000       # Close idle connections (ms)
POOL_CONNECTION_TIMEOUT=20000 # Connection timeout (ms)
```

### SSL & Security
```bash
# SSL is automatically enabled for cloud databases
POSTGRES_SSL=true
DB_SSL_MODE=require

# For development (not recommended for production)
POSTGRES_SSL=false
```

### Performance Tuning
```bash
# Query timeouts
DB_QUERY_TIMEOUT=30000        # 30 seconds
DB_STATEMENT_TIMEOUT=30000    # 30 seconds

# Connection optimization
DB_KEEP_ALIVE=true
DB_TCP_KEEP_ALIVE=true
```

---

## 🚨 Troubleshooting

### Common Issues

#### Connection Refused
```bash
# Check firewall rules (AWS Security Groups, etc.)
# Verify credentials
# Ensure SSL mode is correct
node scripts/cloud-db-status.js
```

#### SSL Errors
```bash
# For self-signed certificates (some providers)
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Or disable SSL verification (not recommended)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
```

#### Connection Pool Exhaustion
```bash
# Increase pool size (check provider limits)
POOL_MAX=30

# Monitor pool usage
node scripts/monitor-cloud-database.js
```

#### Slow Queries
```sql
-- Check slow queries
SELECT query, mean_time, calls
FROM pg_stat_statements
WHERE mean_time > 1000
ORDER BY mean_time DESC;
```

---

## 📈 Scaling & Performance

### Connection Pool Scaling
```javascript
// Automatic pool scaling based on load
const { createCloudConnectionPool } = require('./shared/databases/postgres/cloud-connection');

const pool = createCloudConnectionPool({
  min: process.env.NODE_ENV === 'production' ? 5 : 1,
  max: process.env.NODE_ENV === 'production' ? 50 : 10,
});
```

### Read Replicas (AWS RDS, Cloud SQL)
```bash
# Configure read replica for read-heavy workloads
DB_READ_REPLICA_ENABLED=true
DB_READ_REPLICA_HOST=replica-host
DB_READ_REPLICA_PORT=5432
```

### Query Optimization
```sql
-- Add indexes for frequently queried columns
CREATE INDEX CONCURRENTLY idx_sessions_date ON session_bookings(scheduled_date);
CREATE INDEX CONCURRENTLY idx_users_email ON students(email);

-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM session_bookings WHERE status = 'confirmed';
```

---

## 🔒 Security Best Practices

### Network Security
- ✅ Use VPC/private networking (not public IPs)
- ✅ Configure security groups/firewall rules
- ✅ Enable SSL/TLS encryption
- ✅ Use IAM authentication where available

### Access Control
- ✅ Least privilege principle
- ✅ Separate read/write users
- ✅ Regular credential rotation
- ✅ Audit logging enabled

### Data Protection
- ✅ Encryption at rest (provider-managed)
- ✅ SSL in transit
- ✅ Automated backups
- ✅ Point-in-time recovery

---

## 🎯 Production Checklist

- [ ] Cloud database provisioned
- [ ] SSL/TLS enabled
- [ ] Connection pooling configured
- [ ] Environment variables set
- [ ] Database initialized with schema
- [ ] Monitoring alerts configured
- [ ] Backup strategy implemented
- [ ] Security groups configured
- [ ] Performance baselines established
- [ ] Failover testing completed

---

## 📞 Support & Resources

### Documentation
- 📖 [Cloud Database Deployment Guide](CLOUD_DATABASE_DEPLOYMENT.md)
- 🔧 [Schema Reference](shared/databases/postgres/schema.sql)
- 📊 [Monitoring Guide](scripts/monitor-cloud-database.js)

### Cloud Provider Docs
- **AWS RDS**: https://docs.aws.amazon.com/rds/
- **Google Cloud SQL**: https://cloud.google.com/sql/docs
- **Azure Database**: https://docs.microsoft.com/azure/postgresql/

### PostgreSQL Resources
- **Connection Pooling**: https://github.com/brianc/node-postgres/tree/master/packages/pg-pool
- **Performance Tuning**: https://www.postgresql.org/docs/current/performance-tips.html

---

## 🎉 You're All Set!

Your cloud database is now **enterprise-grade** and **production-ready**! 🚀

**Need help?** Run `node scripts/cloud-db-status.js` to check your setup anytime.

Happy coding! 🎯

cd kc-backend

# One-command setup (creates everything)
node scripts/init-production-database.js