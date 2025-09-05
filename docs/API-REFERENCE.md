# API Reference

This document provides detailed information about all API endpoints in the Cloudflare Workers Task Processing System.

## Base URL

- **Development**: `http://localhost:8787`
- **Production**: `https://your-worker.workers.dev`

## Authentication

All API endpoints require JWT authentication. Include the token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

Generate a token using:
```bash
node generate-jwt.js
```

## API Endpoints by Tag

### 📦 Tasks

Endpoints for managing task lifecycle.

#### Create Task
```http
POST /api/task
```

Creates a new task for processing.

**Request Body:**
```json
{
  "type": "video-processing",
  "priority": 1,
  "payload": {
    "mimeType": "video/mp4",
    "model": "standard",
    "video_quality": "1080p",
    "video_url": "https://example.com/video.mp4",
    "enable_upscale": false
  },
  "capabilities": ["video"],
  "async": true
}
```

**Response:**
```json
{
  "id": "task_abc123",
  "status": "PENDING",
  "createdAt": 1704556800000,
  "updatedAt": 1704556800000
}
```

#### Get Task Status
```http
GET /api/task/:id
```

Retrieves the current status of a task.

**Response:**
```json
{
  "id": "task_abc123",
  "status": "PROCESSING",
  "progress": 45,
  "serverId": "server_xyz789",
  "createdAt": 1704556800000,
  "updatedAt": 1704556810000
}
```

#### Update Task
```http
PUT /api/task/:id
```

Updates task status (typically called by backend servers).

**Request Body:**
```json
{
  "status": "COMPLETED",
  "result": {
    "output_url": "https://example.com/processed.mp4",
    "duration": 120
  }
}
```

#### Retry Failed Task
```http
POST /api/task/:id/retry
```

Retries a failed or timed out task.

**Response:**
```json
{
  "message": "Task queued for retry",
  "taskId": "task_abc123"
}
```

#### Cancel Task
```http
POST /api/task/:id/cancel
```

Cancels a pending or processing task.

**Response:**
```json
{
  "message": "Task cancelled",
  "taskId": "task_abc123"
}
```

### 🖥️ Servers

Endpoints for managing backend servers (Admin role required).

#### Register Server
```http
POST /api/servers
```

Registers a new backend server.

**Request Body:**
```json
{
  "name": "gpu-server-01",
  "endpoints": {
    "predict": "https://server1.example.com/predict",
    "health": "https://server1.example.com/health",
    "metrics": "https://server1.example.com/metrics"
  },
  "apiKey": "server-api-key",
  "maxConcurrent": 10,
  "capabilities": ["video", "image"],
  "groups": ["production"],
  "priority": 1
}
```

**Response:**
```json
{
  "serverId": "server_xyz789",
  "message": "Server registered successfully"
}
```

#### List Servers
```http
GET /api/servers
```

Lists all registered servers.

**Query Parameters:**
- `status` (optional): Filter by status (online, offline, maintenance, degraded)
- `group` (optional): Filter by server group

**Response:**
```json
{
  "servers": [
    {
      "id": "server_xyz789",
      "name": "gpu-server-01",
      "status": "online",
      "registeredAt": 1704553200000,
      "lastHeartbeat": 1704556800000,
      "uptime": 3600000,
      "timeSinceLastHeartbeat": 5000,
      "groups": ["production", "gpu"],
      "priority": 2
    }
  ]
}
```

**Response Fields:**
- `uptime`: Server uptime in milliseconds (time since registration)
- `timeSinceLastHeartbeat`: Time since last heartbeat in milliseconds

#### Update Server Heartbeat
```http
POST /api/servers/:id/heartbeat
```

Updates server heartbeat and health status.

**Request Body:**
```json
{
  "status": "healthy",
  "activeTasks": 3,
  "metrics": {
    "cpu": 45,
    "memory": 60,
    "gpu": 80
  }
}
```

#### Unregister Server
```http
DELETE /api/servers/:id
```

Removes a server from the registry.

**Response:**
```json
{
  "message": "Server unregistered",
  "serverId": "server_xyz789"
}
```

#### Set Maintenance Mode
```http
POST /api/servers/:id/maintenance
```

Enables or disables maintenance mode for a server.

**Request Body:**
```json
{
  "maintenance": true,
  "reason": "Scheduled maintenance"
}
```

#### Get Server Metrics
```http
GET /api/servers/:id/metrics
```

Retrieves detailed metrics for a specific server.

**Response:**
```json
{
  "serverId": "server_xyz789",
  "metrics": {
    "uptime": 3600000,
    "tasksProcessed": 150,
    "successCount": 147,
    "failureCount": 3,
    "averageProcessingTime": 45000,
    "currentLoad": 0.6
  }
}
```

### 📊 Statistics

Endpoints for retrieving system statistics.

#### Get Task Statistics
```http
GET /api/stats/tasks
```

Gets aggregated task processing statistics.

**Query Parameters:**
- `date` (optional): Date in YYYY-MM-DD format (defaults to today)

**Response:**
```json
{
  "totalTasks": 500,
  "pendingTasks": 10,
  "successfulTasks": 450,
  "failedTasks": 30,
  "retriedTasks": 10,
  "averageProcessingTime": 45000,
  "serverCount": 5,
  "topServers": [
    {
      "serverId": "server_xyz789",
      "tasksProcessed": 150,
      "successRate": 0.98
    }
  ],
  "hourlyTrend": [
    {
      "hour": 0,
      "tasks": 20
    },
    {
      "hour": 1,
      "tasks": 15
    }
  ]
}
```

#### Get Hourly Report
```http
GET /api/stats/hourly
```

Gets task statistics broken down by hour.

**Query Parameters:**
- `date` (optional): Date in YYYY-MM-DD format

**Response:**
```json
{
  "date": "2024-01-06",
  "hours": [
    {
      "hour": 0,
      "created": 20,
      "completed": 18,
      "failed": 2,
      "averageTime": 42000
    }
  ]
}
```

#### Get Server Statistics
```http
GET /api/stats/servers/:id
```

Gets statistics for a specific server.

**Query Parameters:**
- `date` (optional): Date in YYYY-MM-DD format

**Response:**
```json
{
  "serverId": "server_xyz789",
  "tasksProcessed": 150,
  "successCount": 147,
  "failureCount": 3,
  "successRate": 0.98,
  "averageProcessingTime": 45000,
  "uptime": 0.995
}
```

### ⚖️ Load Balancer

Endpoints for managing load balancing.

#### Get Load Balancer Status
```http
GET /api/stats/load-balancer
```

Gets current load distribution and algorithm.

**Response:**
```json
{
  "algorithm": "weighted-round-robin",
  "serverDistribution": {
    "server_xyz789": {
      "load": 0.6,
      "activeTasks": 6,
      "weight": 2
    },
    "server_abc456": {
      "load": 0.3,
      "activeTasks": 3,
      "weight": 1
    }
  },
  "totalActiveTasks": 9,
  "averageLoad": 0.45
}
```

#### Set Load Balancer Algorithm
```http
POST /api/stats/load-balancer/algorithm
```

Changes the load balancing algorithm.

**Request Body:**
```json
{
  "algorithm": "least-connections"
}
```

**Available Algorithms:**
- `round-robin`: Distribute tasks evenly in sequence
- `least-connections`: Route to server with fewest active tasks
- `weighted-round-robin`: Consider server priority/weight
- `random`: Random server selection

**Response:**
```json
{
  "message": "Load balancer algorithm updated",
  "algorithm": "least-connections"
}
```

## Error Responses

All endpoints return standard error responses:

### 400 Bad Request
```json
{
  "error": "Invalid request",
  "details": "Missing required field: priority"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "details": "Invalid or expired token"
}
```

### 403 Forbidden
```json
{
  "error": "Forbidden",
  "details": "Admin role required"
}
```

### 404 Not Found
```json
{
  "error": "Not found",
  "details": "Task not found: task_abc123"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "details": "An unexpected error occurred"
}
```

## Rate Limiting

API endpoints are subject to rate limiting:
- **Default**: 100 requests per minute
- **Task Creation**: 50 requests per minute
- **Server Registration**: 10 requests per minute

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704557400
```

## WebSocket Support (Coming Soon)

Real-time task status updates via WebSocket:
```javascript
const ws = new WebSocket('wss://your-worker.workers.dev/ws');
ws.send(JSON.stringify({
  type: 'subscribe',
  taskId: 'task_abc123'
}));
```

## OpenAPI Specification

Interactive API documentation is available at:
- **Development**: http://localhost:8787/docs
- **OpenAPI JSON**: http://localhost:8787/openapi.json

## SDK Usage Examples

### JavaScript/TypeScript
```javascript
const API_BASE = 'http://localhost:8787';
const token = 'your-jwt-token';

// Create a task
const response = await fetch(`${API_BASE}/api/task`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    type: 'video-processing',
    priority: 1,
    payload: {
      video_url: 'https://example.com/video.mp4'
    }
  })
});

const task = await response.json();
console.log('Task created:', task.id);
```

### Python
```python
import requests

API_BASE = 'http://localhost:8787'
token = 'your-jwt-token'

# Create a task
response = requests.post(
    f'{API_BASE}/api/task',
    headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    },
    json={
        'type': 'video-processing',
        'priority': 1,
        'payload': {
            'video_url': 'https://example.com/video.mp4'
        }
    }
)

task = response.json()
print(f"Task created: {task['id']}")
```

### cURL
```bash
# Create a task
curl -X POST http://localhost:8787/api/task \
  -H "Authorization: Bearer your-jwt-token" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "video-processing",
    "priority": 1,
    "payload": {
      "video_url": "https://example.com/video.mp4"
    }
  }'
```