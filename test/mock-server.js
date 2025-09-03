/**
 * Mock Backend Server for E2E Testing
 * Simulates a prediction/inference backend server with health check endpoint
 */

const http = require('http');
const url = require('url');
const jwt = require('jsonwebtoken');

const PORT = process.env.MOCK_SERVER_PORT || 8080;
const SERVER_ID = process.env.SERVER_ID || 'mock-server-001';
const SIMULATE_ERRORS = process.env.SIMULATE_ERRORS === 'true';
const PROCESSING_DELAY = parseInt(process.env.PROCESSING_DELAY || '1000');
// Use the same JWT_SECRET as defined in .dev.vars
const JWT_SECRET = process.env.JWT_SECRET || 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// Track server state
let isHealthy = true;
let requestCount = 0;
let taskResults = new Map();

// Helper to generate random result
function generateMockResult(taskId) {
  return {
    task_id: taskId,
    backend_task_id: `backend-${taskId}`,
    data: {
      prediction: Math.random() > 0.5 ? 'positive' : 'negative',
      confidence: Math.random(),
      processed_at: new Date().toISOString(),
      model_version: '1.0.0',
      server_id: SERVER_ID
    },
    metadata: {
      server_id: SERVER_ID,
      processing_time: PROCESSING_DELAY,
      model_time: Math.floor(PROCESSING_DELAY * 0.8),
      queue_time: Math.floor(PROCESSING_DELAY * 0.2),
      progress: 100,
      status: 'FINISHED',
      message: 'Processing completed successfully'
    }
  };
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers for development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  requestCount++;
  console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);

  // Health check endpoint
  if (pathname === '/health' && method === 'GET') {
    // Simulate occasional health check failures
    if (SIMULATE_ERRORS && Math.random() < 0.1) {
      isHealthy = false;
      setTimeout(() => { isHealthy = true; }, 5000); // Recover after 5 seconds
    }

    if (isHealthy) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        server_id: SERVER_ID,
        uptime: process.uptime(),
        request_count: requestCount
      }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'unhealthy',
        server_id: SERVER_ID,
        error: 'Service temporarily unavailable'
      }));
    }
    return;
  }

  // Prediction endpoint
  if (pathname === '/predict' && method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);
        console.log('Received prediction request:', requestData);

        // Simulate processing errors
        if (SIMULATE_ERRORS && Math.random() < 0.2) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Internal server error during processing',
            request_id: requestData.task_id
          }));
          return;
        }

        // Check if async processing is requested
        const isAsync = requestData.async === true;
        const callbackUrl = requestData.callback_url;

        if (isAsync && callbackUrl) {
          // Async processing - return immediately
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            task_id: requestData.task_id,
            backend_task_id: `backend-${requestData.task_id}`,
            status: 'PROCESSING',
            message: 'Task accepted for async processing'
          }));

          // Simulate async processing and callback
          setTimeout(async () => {
            const result = generateMockResult(requestData.task_id);
            taskResults.set(requestData.task_id, result);
            
            // Send callback with JWT authentication
            try {
              // Generate a JWT token for the callback (using service account)
              const callbackToken = jwt.sign({
                sub: 'mock-server',
                roles: ['service', 'user'],
                iat: Math.floor(Date.now() / 1000)
              }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
              
              const callbackUrlParsed = new URL(callbackUrl);
              const callbackReq = http.request({
                hostname: callbackUrlParsed.hostname,
                port: callbackUrlParsed.port,
                path: callbackUrlParsed.pathname,
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${callbackToken}`
                }
              }, (callbackRes) => {
                console.log(`Callback sent to ${callbackUrl}, status: ${callbackRes.statusCode}`);
                if (callbackRes.statusCode === 401) {
                  console.error('Callback failed: Authentication required');
                }
              });

              callbackReq.on('error', (error) => {
                console.error('Callback failed:', error);
              });

              callbackReq.write(JSON.stringify(result));
              callbackReq.end();
            } catch (error) {
              console.error('Failed to send callback:', error);
            }
          }, PROCESSING_DELAY);

        } else {
          // Synchronous processing - wait and return result
          await new Promise(resolve => setTimeout(resolve, PROCESSING_DELAY));
          
          const result = generateMockResult(requestData.task_id);
          taskResults.set(requestData.task_id, result);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        }
      } catch (error) {
        console.error('Error processing request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Invalid request format',
          details: error.message
        }));
      }
    });
    return;
  }

  // Get task result endpoint (for testing async flows)
  if (pathname.startsWith('/result/') && method === 'GET') {
    const taskId = pathname.substring(8);
    const result = taskResults.get(taskId);
    
    if (result) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Task result not found',
        task_id: taskId
      }));
    }
    return;
  }

  // Server info endpoint
  if (pathname === '/info' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      server_id: SERVER_ID,
      version: '1.0.0',
      capabilities: {
        async: true,
        callback: true,
        batch: false
      },
      endpoints: {
        predict: '/predict',
        health: '/health',
        info: '/info',
        result: '/result/:task_id'
      }
    }));
    return;
  }

  // 404 for unknown endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Endpoint not found',
    path: pathname
  }));
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           Mock Backend Server Started                      ║
╠═══════════════════════════════════════════════════════════╣
║  Server ID: ${SERVER_ID.padEnd(45)} ║
║  Port: ${PORT.toString().padEnd(50)} ║
║  Health Endpoint: http://localhost:${PORT}/health${' '.repeat(21)} ║
║  Predict Endpoint: http://localhost:${PORT}/predict${' '.repeat(19)} ║
║  Simulate Errors: ${SIMULATE_ERRORS.toString().padEnd(39)} ║
║  Processing Delay: ${PROCESSING_DELAY}ms${' '.repeat(36)} ║
║  JWT Auth: Enabled for callbacks                         ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});