# Deployment Guide

This guide covers deploying the Cloudflare Workers Task Processing System to production.

## Prerequisites

- Cloudflare account with Workers plan
- Wrangler CLI installed and authenticated
- D1 database access
- Durable Objects enabled on your account

## Environment Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd cf-worker-template
npm install
```

### 2. Configure Wrangler

Ensure your `wrangler.jsonc` is properly configured:

```jsonc
{
  "name": "task-processor",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-06",
  
  "vars": {
    "JWT_SECRET": "your-production-secret-here"
  },
  
  "durable_objects": {
    "bindings": [
      {
        "name": "SERVER_REGISTRY",
        "class_name": "ServerRegistryDO"
      },
      {
        "name": "SERVER_INSTANCE", 
        "class_name": "ServerInstanceDO"
      },
      {
        "name": "TASK_INSTANCE",
        "class_name": "TaskInstanceDO"
      },
      {
        "name": "LOAD_BALANCER",
        "class_name": "LoadBalancerDO"
      },
      {
        "name": "TASK_STATS",
        "class_name": "TaskInstanceStatsDO"
      }
    ]
  },
  
  "d1_databases": [
    {
      "binding": "TASK_DATABASE",
      "database_name": "task-database",
      "database_id": "your-database-id"
    }
  ]
}
```

## Database Setup

### 1. Create D1 Database

```bash
# Create production database
wrangler d1 create task-database

# Note the database_id from the output
```

### 2. Update Configuration

Add the database ID to your `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "TASK_DATABASE",
    "database_name": "task-database",
    "database_id": "xxxxx-xxxxx-xxxxx-xxxxx"
  }
]
```

### 3. Apply Migrations

```bash
# Apply to production
wrangler d1 migrations apply TASK_DATABASE

# Verify migrations
wrangler d1 execute TASK_DATABASE --command="SELECT * FROM _cf_KV"
```

## Security Configuration

### 1. Generate Production JWT Secret

```bash
# Generate a secure secret
openssl rand -base64 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. Set Production Secrets

```bash
# Set JWT secret
wrangler secret put JWT_SECRET

# Set other secrets if needed
wrangler secret put API_KEY
```

### 3. Configure CORS

Update `src/app.ts` with your production domains:

```typescript
const CORS_ORIGINS = [
  'https://your-app.com',
  'https://www.your-app.com',
  'https://admin.your-app.com'
];
```

## Deployment Steps

### 1. Build and Test

```bash
# Run tests
npm run test:e2e

# Type checking
npm run cf-typegen

# Build check
wrangler deploy --dry-run
```

### 2. Deploy to Staging

```bash
# Deploy to staging environment
wrangler deploy --env staging

# Test staging deployment
curl https://task-processor-staging.<your-subdomain>.workers.dev/docs
```

### 3. Deploy to Production

```bash
# Deploy to production
wrangler deploy --env production

# Or simply
npm run deploy
```

### 4. Verify Deployment

```bash
# Check deployment status
wrangler deployments list

# Test health endpoint
curl https://task-processor.<your-subdomain>.workers.dev/health

# Generate admin token
node generate-jwt.js

# Test API
curl https://task-processor.<your-subdomain>.workers.dev/api/servers \
  -H "Authorization: Bearer <token>"
```

## Environment-Specific Configuration

### Development

```jsonc
{
  "vars": {
    "JWT_SECRET": "dev-secret",
    "ENVIRONMENT": "development"
  }
}
```

### Staging

```jsonc
{
  "env": {
    "staging": {
      "vars": {
        "ENVIRONMENT": "staging"
      },
      "routes": [
        "staging.your-domain.com/*"
      ]
    }
  }
}
```

### Production

```jsonc
{
  "env": {
    "production": {
      "vars": {
        "ENVIRONMENT": "production"
      },
      "routes": [
        "api.your-domain.com/*"
      ]
    }
  }
}
```

## Custom Domains

### 1. Add Custom Domain

```bash
# Add custom domain route
wrangler route add api.your-domain.com/* --env production
```

### 2. Configure DNS

Add CNAME record in Cloudflare DNS:

```
Type: CNAME
Name: api
Content: task-processor.<your-subdomain>.workers.dev
Proxy: Yes (Orange cloud)
```

## Monitoring and Observability

### 1. Enable Analytics

```bash
# View real-time logs
wrangler tail --env production

# View metrics
wrangler analytics engine --env production
```

### 2. Set Up Alerts

Configure alerts in Cloudflare Dashboard:
- Workers > Your Worker > Analytics > Alerts
- Set thresholds for errors, latency, requests

### 3. Custom Metrics

Implement custom metrics tracking:

```typescript
// In your worker code
c.env.ANALYTICS.writeDataPoint({
  dataset: 'task_metrics',
  point: {
    blobs: ['task_created'],
    doubles: [1],
    indexes: [Date.now()]
  }
});
```

## Performance Optimization

### 1. Enable Caching

```typescript
// Cache static responses
const cacheUrl = new URL(request.url);
const cacheKey = new Request(cacheUrl.toString(), request);
const cache = caches.default;

let response = await cache.match(cacheKey);
if (!response) {
  response = await handleRequest(request);
  c.env.ctx.waitUntil(cache.put(cacheKey, response.clone()));
}
```

### 2. Optimize Bundle Size

```bash
# Check bundle size
wrangler deploy --dry-run --outdir dist

# Analyze bundle
npm run analyze
```

### 3. Configure Limits

```jsonc
{
  "limits": {
    "cpu_ms": 50,
    "memory_mb": 128
  }
}
```

## Rollback Procedures

### 1. View Deployment History

```bash
# List deployments
wrangler deployments list

# View specific deployment
wrangler deployments view <deployment-id>
```

### 2. Rollback to Previous Version

```bash
# Rollback to specific deployment
wrangler rollback <deployment-id> --env production

# Or use percentage rollout
wrangler rollback <deployment-id> --percentage 10
```

### 3. Emergency Rollback

```bash
# Immediate rollback
wrangler rollback --message "Emergency rollback" --env production
```

## Troubleshooting

### Common Issues

#### 1. Durable Object Errors

```bash
# Check DO status
wrangler tail --env production --filter "DO"

# Reset DO state (caution!)
wrangler durable-objects reset --env production
```

#### 2. Database Connection Issues

```bash
# Test database connection
wrangler d1 execute TASK_DATABASE --command="SELECT 1"

# Check migrations
wrangler d1 migrations list TASK_DATABASE
```

#### 3. Authentication Failures

```bash
# Verify JWT secret
wrangler secret list

# Test token generation
JWT_SECRET=your-secret node generate-jwt.js
```

### Debug Mode

Enable debug logging:

```typescript
// In src/index.ts
const DEBUG = c.env.DEBUG === 'true';
if (DEBUG) {
  console.log('Request:', request);
}
```

## Production Checklist

### Pre-Deployment

- [ ] All tests passing (`npm run test:e2e`)
- [ ] TypeScript types generated (`npm run cf-typegen`)
- [ ] Environment variables configured
- [ ] JWT secret set securely
- [ ] Database migrations applied
- [ ] CORS origins configured

### Post-Deployment

- [ ] Health endpoint responding
- [ ] API documentation accessible
- [ ] Authentication working
- [ ] Database queries functioning
- [ ] Monitoring enabled
- [ ] Alerts configured

### Security

- [ ] JWT secret rotated from development
- [ ] CORS properly restricted
- [ ] Rate limiting enabled
- [ ] Input validation active
- [ ] Error messages sanitized
- [ ] HTTPS enforced

## Scaling Considerations

### Durable Object Limits

- Max 1000 requests/second per DO instance
- Consider sharding for high traffic:

```typescript
// Shard by task ID
const shardId = hashCode(taskId) % SHARD_COUNT;
const doId = c.env.TASK_INSTANCE.idFromName(`shard-${shardId}`);
```

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_tasks_server ON tasks(server_id);
```

### Rate Limiting

```typescript
// Implement rate limiting
const rateLimiter = new RateLimiter({
  limit: 100,
  window: 60000 // 1 minute
});

if (!rateLimiter.check(clientId)) {
  return c.json({ error: 'Rate limited' }, 429);
}
```

## Maintenance Mode

### Enable Maintenance

```typescript
// Set in environment
wrangler secret put MAINTENANCE_MODE --value="true"

// Check in worker
if (c.env.MAINTENANCE_MODE === 'true') {
  return c.json({ 
    error: 'System under maintenance',
    retry_after: 3600 
  }, 503);
}
```

### Graceful Shutdown

```typescript
// Handle graceful shutdown
c.env.ctx.waitUntil(
  Promise.all([
    flushMetrics(),
    closeDatabaseConnections(),
    notifyServers()
  ])
);
```

## Support and Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Durable Objects Guide](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
- [D1 Database Documentation](https://developers.cloudflare.com/d1/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)

For production support, contact Cloudflare support or open an issue in the repository.