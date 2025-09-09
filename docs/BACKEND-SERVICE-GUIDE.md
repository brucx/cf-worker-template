# Backend Inference Service Development Guide

This guide describes how to develop backend inference services that integrate with the Cloudflare Worker task management system.

## Overview

The system supports two modes of operation:
- **Synchronous Mode**: For quick tasks that complete within seconds
- **Asynchronous Mode**: For long-running tasks that require callbacks

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Client    │────▶│   CF Worker  │────▶│ Backend Service │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │                       │
                           ▼                       ▼
                    ┌──────────────┐      ┌──────────────┐
                    │ Durable Obj  │      │   Process    │
                    │   (State)     │      │   Request    │
                    └──────────────┘      └──────────────┘
```

## Server Registration

Before processing tasks, backend services must register with the Worker:

### Registration Endpoint
```
POST /api/servers/register
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

### Request Body
```json
{
  "url": "https://inference.example.com",
  "name": "gpu-server-01",
  "capabilities": ["video-processing", "image-generation"],
  "maxConcurrent": 10,
  "metadata": {
    "gpu": "A100",
    "vram": "80GB",
    "region": "us-west"
  }
}
```

### Response
```json
{
  "id": "srv_abc123",
  "status": "active"
}
```

## Task Processing

### 1. Synchronous Mode

For tasks that complete quickly (< 30 seconds), use synchronous processing.

#### Request from Worker to Backend
```
POST https://your-backend.com/process
Content-Type: application/json
```

```json
{
  "id": "task_xyz789",
  "type": "video-processing",
  "payload": {
    "video_url": "https://example.com/video.mp4",
    "operations": ["transcribe", "summarize"],
    "options": {
      "language": "en",
      "format": "srt"
    }
  },
  "callback_url": null,  // No callback for sync mode
  "timeout": 30000
}
```

#### Expected Response (Success)
```json
{
  "status": "success",
  "result": {
    "transcription": "...",
    "summary": "...",
    "metadata": {
      "duration": 120,
      "word_count": 500
    }
  }
}
```

#### Expected Response (Error)
```json
{
  "status": "error",
  "error": "Video format not supported",
  "code": "INVALID_FORMAT"
}
```

### 2. Asynchronous Mode

For long-running tasks, use asynchronous processing with callbacks.

#### Request from Worker to Backend
```
POST https://your-backend.com/process
Content-Type: application/json
```

```json
{
  "id": "task_abc456",
  "type": "video-processing",
  "payload": {
    "video_url": "https://example.com/large-video.mp4",
    "operations": ["full-analysis"],
    "options": {
      "quality": "high",
      "include_thumbnails": true
    }
  },
  "callback_url": "https://worker.example.com/api/tasks/task_abc456",
  "timeout": 300000  // 5 minutes
}
```

#### Immediate Response
```json
{
  "status": "accepted",
  "message": "Task queued for processing"
}
```

#### Progress Updates (Optional)
Send progress updates to the callback URL:

```
PUT https://worker.example.com/api/tasks/task_abc456
Content-Type: application/json
```

```json
{
  "status": "PROCESSING",
  "progress": 45,
  "message": "Analyzing video frames..."
}
```

#### Final Callback (Success)
```
PUT https://worker.example.com/api/tasks/task_abc456
Content-Type: application/json
```

```json
{
  "status": "COMPLETED",
  "result": {
    "analysis": {
      "scenes": [...],
      "objects": [...],
      "transcription": "..."
    },
    "thumbnails": [
      "https://cdn.example.com/thumb1.jpg",
      "https://cdn.example.com/thumb2.jpg"
    ],
    "metadata": {
      "processing_time": 180.5,
      "frames_processed": 7200
    }
  }
}
```

#### Final Callback (Failure)
```
PUT https://worker.example.com/api/tasks/task_abc456
Content-Type: application/json
```

```json
{
  "status": "FAILED",
  "error": "Out of memory while processing video",
  "details": {
    "frame": 3600,
    "memory_used": "32GB"
  }
}
```

## Health Checks

The Worker will periodically check server health:

### Health Check Request
```
GET https://your-backend.com/health
```

### Expected Response
```json
{
  "status": "healthy",
  "timestamp": 1704067200000,
  "load": {
    "cpu": 45,
    "memory": 60,
    "active_tasks": 3,
    "queue_length": 5
  },
  "capabilities": ["video-processing", "image-generation"]
}
```

## Task Status Codes

Use these standard status codes in callbacks:

| Status | Description |
|--------|-------------|
| `PENDING` | Task received but not started |
| `PROCESSING` | Task is being processed |
| `COMPLETED` | Task completed successfully |
| `FAILED` | Task failed with error |
| `TIMEOUT` | Task exceeded time limit |
| `CANCELLED` | Task was cancelled |

## Error Handling

### Standard Error Response Format
```json
{
  "status": "FAILED",
  "error": "Brief error message",
  "code": "ERROR_CODE",
  "details": {
    // Additional context
  }
}
```

### Common Error Codes
- `INVALID_FORMAT` - Input format not supported
- `RESOURCE_LIMIT` - Resource limits exceeded
- `TIMEOUT` - Processing timeout
- `INTERNAL_ERROR` - Unexpected server error
- `INVALID_PAYLOAD` - Missing or invalid parameters

## Implementation Examples

### Python (FastAPI)

```python
from fastapi import FastAPI, BackgroundTasks
import httpx
import asyncio

app = FastAPI()

@app.post("/process")
async def process_task(request: dict, background_tasks: BackgroundTasks):
    task_id = request["id"]
    callback_url = request.get("callback_url")
    
    # Synchronous processing
    if not callback_url:
        try:
            result = await process_sync(request["payload"])
            return {"status": "success", "result": result}
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    # Asynchronous processing
    background_tasks.add_task(process_async, task_id, request["payload"], callback_url)
    return {"status": "accepted", "message": "Task queued"}

async def process_async(task_id: str, payload: dict, callback_url: str):
    try:
        # Send progress updates
        async with httpx.AsyncClient() as client:
            await client.put(callback_url, json={
                "status": "PROCESSING",
                "progress": 0
            })
            
            # Process task
            result = await long_running_process(payload)
            
            # Send completion
            await client.put(callback_url, json={
                "status": "COMPLETED",
                "result": result
            })
    except Exception as e:
        async with httpx.AsyncClient() as client:
            await client.put(callback_url, json={
                "status": "FAILED",
                "error": str(e)
            })

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": int(time.time() * 1000),
        "load": {
            "cpu": get_cpu_usage(),
            "memory": get_memory_usage(),
            "active_tasks": get_active_tasks()
        }
    }
```

### Node.js (Express)

```javascript
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

app.post('/process', async (req, res) => {
  const { id, payload, callback_url, timeout } = req.body;
  
  // Synchronous processing
  if (!callback_url) {
    try {
      const result = await processSync(payload);
      res.json({ status: 'success', result });
    } catch (error) {
      res.json({ status: 'error', error: error.message });
    }
    return;
  }
  
  // Asynchronous processing
  processAsync(id, payload, callback_url);
  res.json({ status: 'accepted', message: 'Task queued' });
});

async function processAsync(taskId, payload, callbackUrl) {
  try {
    // Send initial progress
    await axios.put(callbackUrl, {
      status: 'PROCESSING',
      progress: 0
    });
    
    // Process task
    const result = await longRunningProcess(payload);
    
    // Send completion
    await axios.put(callbackUrl, {
      status: 'COMPLETED',
      result
    });
  } catch (error) {
    await axios.put(callbackUrl, {
      status: 'FAILED',
      error: error.message
    });
  }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    load: {
      cpu: getCpuUsage(),
      memory: getMemoryUsage(),
      active_tasks: getActiveTasks()
    }
  });
});
```

## Best Practices

### 1. Timeout Handling
- Respect the timeout value in requests
- Cancel long-running operations when timeout is reached
- Send timeout callback before the Worker's timeout

### 2. Progress Reporting
- Send progress updates for tasks > 10 seconds
- Include meaningful progress messages
- Update at reasonable intervals (every 5-10 seconds)

### 3. Error Recovery
- Implement retry logic for transient failures
- Provide detailed error information
- Clean up resources on failure

### 4. Resource Management
- Track concurrent task limits
- Queue tasks when at capacity
- Monitor memory and CPU usage

### 5. Security
- Validate JWT tokens if implementing authentication
- Sanitize input payloads
- Use HTTPS for all communications
- Validate callback URLs

## Testing Your Backend

### 1. Register Your Server
```bash
# Generate JWT token
node generate-jwt.js

# Register server
curl -X POST http://localhost:8787/api/servers/register \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:8080",
    "name": "test-backend",
    "capabilities": ["test-processing"]
  }'
```

### 2. Create a Test Task (Synchronous)
```bash
curl -X POST http://localhost:8787/api/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "test-processing",
    "async": false,
    "payload": {
      "test": "data"
    }
  }'
```

### 3. Create a Test Task (Asynchronous)
```bash
curl -X POST http://localhost:8787/api/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "test-processing",
    "async": true,
    "payload": {
      "test": "data"
    }
  }'
```

### 4. Check Task Status
```bash
curl -X GET http://localhost:8787/api/tasks/<task_id> \
  -H "Authorization: Bearer <token>"
```

## Debugging Tips

1. **Enable Logging**: Log all incoming requests and outgoing callbacks
2. **Test Locally**: Use the Worker's dev mode with local backend
3. **Monitor Health**: Implement comprehensive health checks
4. **Handle Edge Cases**: Test timeout, cancellation, and error scenarios
5. **Validate Payloads**: Check for required fields and data types

## Support

For issues or questions:
- Check the [main documentation](./README.md)
- Review the [API documentation](./API.md)
- Test with the mock server implementation in `/test/mock-server.js`