# E2E Testing Suite

This directory contains end-to-end tests for the Cloudflare Workers API, including a mock backend server for testing.

## Components

### 1. Mock Backend Server (`mock-server.js`)

A Node.js HTTP server that simulates a prediction/inference backend with:

- **Health Check Endpoint** (`/health`): Returns server health status
- **Prediction Endpoint** (`/predict`): Handles both sync and async processing
- **Result Endpoint** (`/result/:task_id`): Returns async task results
- **Info Endpoint** (`/info`): Provides server capabilities

Features:
- Simulates processing delays
- Optional error simulation
- Async processing with callbacks
- Configurable via environment variables

### 2. E2E Test Suite (`e2e.test.js`)

Comprehensive test suite covering:

- **Authentication Tests**: JWT validation, role-based access
- **Server Management**: Registration, health checks, deletion
- **Task Management**: Creation, processing, status updates
- **Concurrent Operations**: Parallel requests handling
- **Error Handling**: Failure scenarios and recovery
- **API Documentation**: OpenAPI endpoint verification

## Setup

### 1. Install Dependencies

```bash
cd test
npm install
```

### 2. Configure Environment

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

### 3. Set JWT Secret

Ensure your Wrangler configuration has the JWT_SECRET:

```bash
export JWT_SECRET="your-secret-key"
```

## Running Tests

### Run Full Test Suite

```bash
npm test
```

### Run with Watch Mode

```bash
npm run test:watch
```

### Run Mock Server Standalone

```bash
npm run mock-server
```

### Run with Custom Configuration

```bash
SIMULATE_ERRORS=true PROCESSING_DELAY=2000 npm test
```

## Test Scenarios Covered

1. **Authentication & Authorization**
   - Valid/Invalid JWT tokens
   - Admin vs User roles
   - Protected endpoints

2. **Server Lifecycle**
   - Registration with health endpoint
   - Health check monitoring
   - Heartbeat updates
   - Automatic offline detection
   - Manual deletion

3. **Task Processing**
   - Synchronous processing
   - Asynchronous processing with callbacks
   - Status transitions (WAITING → PROCESSING → FINISHED/FAILED)
   - Error handling and retries

4. **Concurrent Operations**
   - Multiple tasks creation
   - Parallel server operations
   - Data consistency

5. **Error Recovery**
   - Server failures
   - Network timeouts
   - Invalid requests
   - Database errors

## CI/CD Integration

For CI environments, use the JSON reporter:

```bash
npm run test:ci
```

This generates `test-results.json` for integration with CI tools.

## Environment Variables

### Mock Server Variables

- `MOCK_SERVER_PORT`: Port for mock server (default: 8080)
- `SERVER_ID`: Unique server identifier
- `SIMULATE_ERRORS`: Enable random errors (true/false)
- `PROCESSING_DELAY`: Simulated processing time in ms

### Test Variables

- `WORKER_URL`: Cloudflare Worker URL (default: http://localhost:8787)
- `JWT_SECRET`: Secret for JWT token generation
- `TEST_TIMEOUT`: Maximum test execution time in ms

## Debugging

### Enable Verbose Logging

```bash
DEBUG=* npm test
```

### Run Specific Test

```bash
npx mocha test/e2e.test.js --grep "should create a new task"
```

### Check Mock Server Health

```bash
curl http://localhost:8080/health
```

### Generate Test JWT Token

```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'test-user', roles: ['admin'] },
  'test-secret-key',
  { algorithm: 'HS256', expiresIn: '1h' }
);
console.log(token);
```

## Troubleshooting

### Tests Timeout

- Increase `TEST_TIMEOUT` environment variable
- Check if services are running properly
- Verify network connectivity

### Authentication Failures

- Ensure JWT_SECRET matches between Worker and tests
- Check token expiration
- Verify role assignments

### Mock Server Issues

- Check port availability
- Review console logs for errors
- Verify health endpoint accessibility

### Worker Connection Failed

- Ensure Wrangler is running (`npm run dev`)
- Check WORKER_URL configuration
- Verify CORS settings

## Best Practices

1. **Clean State**: Each test should clean up its resources
2. **Isolation**: Tests should not depend on each other
3. **Idempotency**: Tests should produce same results on repeated runs
4. **Timeouts**: Set appropriate timeouts for async operations
5. **Error Messages**: Include descriptive assertions for debugging

## Adding New Tests

1. Add test case to appropriate describe block
2. Follow existing naming conventions
3. Clean up any created resources
4. Document any new environment variables
5. Update this README if adding new test categories