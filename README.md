# Cloudflare Workers Task Processing System

A distributed task processing system built on Cloudflare Workers with Durable Objects for state management and D1 for persistence.

## Features

- **Distributed Task Processing**: Manage and execute tasks across multiple backend servers
- **Server Registry**: Dynamic server registration with health monitoring
- **JWT Authentication**: Secure API endpoints with role-based access control
- **Durable Objects**: Reliable state management for tasks and servers
- **Health Monitoring**: Automatic server health checks and failure detection
- **OpenAPI Documentation**: Auto-generated API documentation at `/docs`

## Quick Start

### Prerequisites

- Node.js 18+ 
- Cloudflare account with Workers and D1 enabled
- Wrangler CLI (`npm install -g wrangler`)

### Installation

```bash
# Install dependencies
npm install

# Install test dependencies
cd test && npm install && cd ..

# Apply database migrations locally
npx wrangler d1 migrations apply TASK_DATABASE --local

# Start development server
npm run dev
```

### Running Tests

```bash
# Run complete E2E test suite
npm run test:e2e

# Or run components separately
npm run mock-server  # Start mock backend
npm run dev          # Start Worker
npm test            # Run tests
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed architecture documentation.

### Core Components

- **API Layer**: Hono framework with JWT authentication
- **Durable Objects**:
  - `TaskManager`: Manages individual task lifecycle
  - `ServerRegistry`: Central registry of all servers
  - `ServerInstance`: Monitors individual server health
- **D1 Database**: Persistent storage for task data
- **Backend Servers**: External prediction/inference services

## API Endpoints

### Task Management
- `POST /api/task` - Create new task
- `GET /api/task/:id` - Get task details  
- `PUT /api/task/:id` - Update task status

### Server Management (Admin only)
- `POST /api/servers` - Register server
- `GET /api/servers` - List all servers
- `GET /api/servers/:id` - Get server details
- `POST /api/servers/:id/heartbeat` - Update heartbeat
- `DELETE /api/servers/:id` - Remove server
- `POST /api/servers/cleanup` - Clean stale servers

### Documentation
- `GET /docs` - OpenAPI documentation

## Configuration

### Environment Variables

Edit `wrangler.jsonc` to configure:

```jsonc
{
  "vars": {
    "JWT_SECRET": "your-secret-key"
  }
}
```

### Database Setup

```bash
# Create D1 database
wrangler d1 create TASK_DATABASE

# Apply migrations
wrangler d1 migrations apply TASK_DATABASE --local  # For local dev
wrangler d1 migrations apply TASK_DATABASE          # For production
```

## Development

### Project Structure

```
├── src/
│   ├── index.ts                 # Main entry point
│   ├── app.ts                   # Express app configuration
│   ├── types.ts                 # TypeScript types
│   ├── routes/
│   │   ├── task-routes.ts      # Task API endpoints
│   │   └── server-routes.ts    # Server API endpoints
│   ├── durable-objects/
│   │   ├── task-manager.ts     # Task lifecycle management
│   │   ├── server-registry.ts  # Server registration
│   │   └── server-instance.ts  # Server health monitoring
│   └── migrations/              # Database migrations
├── test/
│   ├── e2e.test.js             # End-to-end tests
│   ├── mock-server.js          # Mock backend server
│   └── run-tests.sh            # Automated test runner
└── docs/
    ├── architecture.md          # Architecture documentation
    ├── test-scenarios.md       # Test scenarios
    └── optimization-todo.md    # Optimization roadmap
```

### Common Commands

```bash
npm run dev                      # Start dev server
npm run deploy                   # Deploy to production
npm run cf-typegen              # Generate TypeScript types
npm run cf-migrate -- --local   # Apply migrations locally
npm run test:e2e                # Run E2E tests
npm run mock-server             # Start mock server
```

## Testing

The project includes a comprehensive E2E test suite covering:

- Authentication and authorization
- Server registration and health monitoring
- Task creation and processing
- Concurrent operations
- Error handling and recovery

### Latest Test Results (2024-09-03)
- **Pass Rate**: 20/22 tests passing (91%)
- **Core Functionality**: ✅ Fully operational
- **Performance**: ✅ Optimized with retry logic and adaptive health checks
- **Security**: ✅ CORS protection and error sanitization implemented

See [test/README.md](test/README.md) for detailed testing documentation.

## Deployment

### Deploy to Cloudflare Workers

```bash
# Deploy to production
npm run deploy

# Deploy to specific environment
wrangler deploy --env staging
```

### Production Checklist

- [ ] Set secure JWT_SECRET in production
- [ ] Configure CORS origins appropriately
- [ ] Enable rate limiting
- [ ] Set up monitoring and alerting
- [ ] Review security settings
- [ ] Test disaster recovery procedures

## Documentation

- [Architecture Overview](docs/architecture.md)
- [Test Scenarios](docs/test-scenarios.md)
- [Optimization Roadmap](docs/optimization-todo.md)
- [E2E Testing Guide](test/README.md)
- [API Documentation](http://localhost:8787/docs) (when running locally)

## Recent Improvements (2024-09-03)

✅ **Resolved Issues**:
- Fixed JSON serialization for task payloads
- Optimized health check intervals with adaptive timing
- Enhanced error handling with retry logic
- Improved database query performance

📋 **Remaining Tasks**:
- Database indexing for better query performance
- Task batching for high-volume scenarios
- See [docs/optimization-todo.md](docs/optimization-todo.md) for full list

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm run test:e2e`)
4. Commit your changes
5. Push to the branch
6. Open a Pull Request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please open an issue on GitHub.