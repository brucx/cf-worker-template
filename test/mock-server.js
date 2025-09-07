/**
 * Mock Backend Server for E2E Testing
 * Simulates a real prediction/inference backend server with complete functionality
 */

const http = require('http');
const url = require('url');
const jwt = require('jsonwebtoken');

const PORT = process.env.MOCK_SERVER_PORT || 8080;
const SERVER_ID = process.env.SERVER_ID || `mock-server-${Date.now()}`;
const SIMULATE_ERRORS = process.env.SIMULATE_ERRORS === 'true';
const PROCESSING_DELAY = parseInt(process.env.PROCESSING_DELAY || '500');
const JWT_SECRET = process.env.JWT_SECRET || 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // Must match .dev.vars

// Server state management
let serverState = {
  isHealthy: true,
  requestCount: 0,
  successCount: 0,
  errorCount: 0,
  activeTasks: 0,
  totalProcessingTime: 0,
  serverStartTime: Date.now()
};

// Task storage
let taskResults = new Map();
let processingTasks = new Map();

// Server capabilities
const serverCapabilities = ['video', 'image', 'text', 'audio'];
const serverMetrics = {
  cpu: 0,
  memory: 0,
  gpu: 0,
  diskSpace: 85
};

// Helper functions
function updateMetrics() {
  // Simulate realistic metrics
  serverMetrics.cpu = Math.min(95, 20 + serverState.activeTasks * 15 + Math.random() * 10);
  serverMetrics.memory = Math.min(90, 30 + serverState.activeTasks * 10 + Math.random() * 5);
  serverMetrics.gpu = serverState.activeTasks > 0 ? 40 + Math.random() * 40 : Math.random() * 10;
}

function generateMockResult(requestData) {
  const processingTime = PROCESSING_DELAY + Math.floor(Math.random() * 500);
  
  // Different responses based on model type
  let result = {
    requestData,
    prediction: 'unknown',
    confidence: 0
  };

  if (requestData.payload) {
    const model = requestData.payload.model || 'standard';
    
    if (model === 'fail-model') {
      // Special model for testing failures
      throw new Error('Model processing failed');
    } else if (model === 'slow-model') {
      // Simulate slow processing
      processingTime * 3;
    }

    // Generate appropriate result based on mime type
    if (requestData.payload.mimeType === 'video/mp4') {
      result = {
        output_url: `https://cdn.example.com/processed/${requestData.id || 'unknown'}.mp4`,
        duration: 120,
        frames: 3600,
        resolution: requestData.payload.video_quality || '1080p',
        upscaled: requestData.payload.enable_upscale || false,
        processing_stages: ['decode', 'analyze', 'process', 'encode'],
        confidence: 0.85 + Math.random() * 0.15
      };
    } else if (requestData.payload.mimeType === 'image/jpeg') {
      result = {
        classification: ['object', 'scene', 'face'][Math.floor(Math.random() * 3)],
        confidence: 0.7 + Math.random() * 0.3,
        bounding_boxes: [],
        tags: ['nature', 'outdoor', 'landscape']
      };
    } else {
      result = {
        text_analysis: {
          sentiment: ['positive', 'negative', 'neutral'][Math.floor(Math.random() * 3)],
          confidence: 0.6 + Math.random() * 0.4,
          language: 'en',
          keywords: ['test', 'mock', 'server']
        }
      };
    }
  }

  return {
    task_id: requestData.id || requestData.task_id,
    backend_task_id: `backend-${requestData.id || requestData.task_id}`,
    data: result,
    metadata: {
      server_id: SERVER_ID,
      processing_time: processingTime,
      model_time: Math.floor(processingTime * 0.7),
      queue_time: Math.floor(processingTime * 0.2),
      postprocess_time: Math.floor(processingTime * 0.1),
      progress: 100,
      status: 'FINISHED',
      message: 'Processing completed successfully',
      model_version: '2.1.0',
      timestamp: new Date().toISOString()
    }
  };
}

async function sendCallback(callbackUrl, taskId, result) {
  try {
    // Generate service JWT for callback
    const callbackToken = jwt.sign({
      sub: 'backend-service',
      roles: ['service', 'user'],
      server_id: SERVER_ID,
      iat: Math.floor(Date.now() / 1000)
    }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    
    const callbackUrlParsed = new URL(callbackUrl);
    
    // Prepare the update data in the format expected by the API
    const updateData = {
      status: 'COMPLETED',
      result: result.data,
      metadata: result.metadata
    };
    
    const callbackReq = http.request({
      hostname: callbackUrlParsed.hostname,
      port: callbackUrlParsed.port || 80,
      path: callbackUrlParsed.pathname,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${callbackToken}`,
        'X-Server-ID': SERVER_ID,
        'X-Backend-Task-ID': result.backend_task_id
      }
    }, (callbackRes) => {
      let responseBody = '';
      callbackRes.on('data', chunk => responseBody += chunk);
      callbackRes.on('end', () => {
        console.log(`✅ Callback sent: ${taskId}, status: ${callbackRes.statusCode}`);
        if (callbackRes.statusCode >= 400) {
          console.error('Callback error response:', responseBody);
        }
      });
    });

    callbackReq.on('error', (error) => {
      console.error('❌ Callback failed:', error.message);
    });

    callbackReq.write(JSON.stringify(updateData));
    callbackReq.end();
  } catch (error) {
    console.error('Failed to send callback:', error);
  }
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Server-ID');

  // Handle preflight
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  serverState.requestCount++;
  updateMetrics();
  
  console.log(`[${new Date().toISOString()}] ${method} ${pathname}`);

  // Health check endpoint
  if (pathname === '/health' && method === 'GET') {
    // Simulate occasional failures
    if (SIMULATE_ERRORS && Math.random() < 0.05) {
      serverState.isHealthy = false;
      setTimeout(() => { 
        serverState.isHealthy = true;
        console.log('🔧 Server recovered from health issue');
      }, 3000);
    }

    if (serverState.isHealthy) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        serverId: SERVER_ID,  // Changed from server_id to serverId to match DO expectation
        server_id: SERVER_ID,  // Keep for backward compatibility
        uptime: Math.floor((Date.now() - serverState.serverStartTime) / 1000),
        active_tasks: serverState.activeTasks,
        total_requests: serverState.requestCount,
        success_rate: serverState.requestCount > 0 
          ? (serverState.successCount / serverState.requestCount).toFixed(3)
          : 1,
        capabilities: serverCapabilities,
        version: '2.1.0'
      }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'unhealthy',
        serverId: SERVER_ID,  // Changed from server_id to serverId to match DO expectation
        server_id: SERVER_ID,  // Keep for backward compatibility
        error: 'Service temporarily unavailable',
        retry_after: 3
      }));
    }
    return;
  }

  // Metrics endpoint
  if (pathname === '/metrics' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      server_id: SERVER_ID,
      timestamp: new Date().toISOString(),
      metrics: {
        ...serverMetrics,
        active_tasks: serverState.activeTasks,
        total_processed: serverState.successCount,
        total_failed: serverState.errorCount,
        average_processing_time: serverState.successCount > 0
          ? Math.floor(serverState.totalProcessingTime / serverState.successCount)
          : 0,
        queue_length: processingTasks.size,
        uptime_seconds: Math.floor((Date.now() - serverState.serverStartTime) / 1000)
      },
      thresholds: {
        max_concurrent: 20,
        cpu_limit: 90,
        memory_limit: 85
      }
    }));
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
        const taskId = requestData.id || requestData.task_id || `task_${Date.now()}`;
        
        console.log(`📥 Prediction request: ${taskId}, async: ${requestData.request.async}`);

        // Check server capacity
        if (serverState.activeTasks >= 20) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Server at capacity',
            retry_after: 5,
            current_load: serverState.activeTasks
          }));
          return;
        }

        // Simulate processing errors for specific models
        if (requestData.payload && requestData.payload.model === 'fail-model') {
          serverState.errorCount++;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Model processing failed',
            task_id: taskId,
            details: 'The fail-model always fails for testing'
          }));
          return;
        }

        // Random errors if SIMULATE_ERRORS is enabled
        if (SIMULATE_ERRORS && Math.random() < 0.1) {
          serverState.errorCount++;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Random processing error',
            task_id: taskId
          }));
          return;
        }

        serverState.activeTasks++;
        processingTasks.set(taskId, Date.now());

        const isAsync = requestData.request.async === true;
        const callbackUrl = requestData.callback_url || requestData.callbackUrl;

        if (isAsync && callbackUrl) {
          console.log(`📤 Async prediction request: ${taskId}`);
          // Async processing
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            task_id: taskId,
            backend_task_id: `backend-${taskId}`,
            status: 'PROCESSING',
            message: 'Task accepted for async processing',
            estimated_time: PROCESSING_DELAY
          }));

          // Process async
          const delay = requestData.payload?.model === 'slow-model' 
            ? PROCESSING_DELAY * 3 
            : PROCESSING_DELAY;

          setTimeout(async () => {
            try {
              const result = generateMockResult(requestData);
              taskResults.set(taskId, result);
              serverState.successCount++;
              serverState.totalProcessingTime += delay;
              
              await sendCallback(callbackUrl, taskId, result);
            } catch (error) {
              console.error(`Error processing task ${taskId}:`, error);
              serverState.errorCount++;
              
              // Send error callback
              await sendCallback(callbackUrl, taskId, {
                task_id: taskId,
                backend_task_id: `backend-${taskId}`,
                data: { error: error.message },
                metadata: { status: 'FAILED', error: error.message }
              });
            } finally {
              serverState.activeTasks--;
              processingTasks.delete(taskId);
            }
          }, delay);

        } else {
          // Synchronous processing
          const delay = requestData.payload?.model === 'slow-model'
            ? PROCESSING_DELAY * 3
            : PROCESSING_DELAY;
            
          await new Promise(resolve => setTimeout(resolve, delay));
          
          try {
            const result = generateMockResult(requestData);
            taskResults.set(taskId, result);
            serverState.successCount++;
            serverState.totalProcessingTime += delay;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (error) {
            serverState.errorCount++;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Processing failed',
              details: error.message
            }));
          } finally {
            serverState.activeTasks--;
            processingTasks.delete(taskId);
          }
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

  // Get task result endpoint
  if (pathname.startsWith('/result/') && method === 'GET') {
    const taskId = pathname.substring(8);
    const result = taskResults.get(taskId);
    
    if (result) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } else if (processingTasks.has(taskId)) {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        task_id: taskId,
        status: 'PROCESSING',
        message: 'Task is still being processed'
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Task not found',
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
      name: 'Mock Inference Server',
      version: '2.1.0',
      capabilities: serverCapabilities,
      features: {
        async: true,
        callback: true,
        batch: false,
        streaming: false,
        priorities: true
      },
      endpoints: {
        predict: '/predict',
        health: '/health',
        metrics: '/metrics',
        info: '/info',
        result: '/result/:task_id'
      },
      models: [
        { name: 'standard', version: '1.0', type: 'general' },
        { name: 'fast', version: '1.0', type: 'optimized' },
        { name: 'slow-model', version: '1.0', type: 'high-accuracy' },
        { name: 'fail-model', version: '1.0', type: 'testing' }
      ],
      limits: {
        max_concurrent: 20,
        max_payload_size: '100MB',
        timeout: 300000
      }
    }));
    return;
  }

  // Clear results endpoint (for testing cleanup)
  if (pathname === '/clear' && method === 'POST') {
    const oldSize = taskResults.size;
    taskResults.clear();
    processingTasks.clear();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Results cleared',
      cleared_count: oldSize
    }));
    return;
  }

  // 404 for unknown endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Endpoint not found',
    path: pathname,
    available_endpoints: ['/health', '/predict', '/metrics', '/info', '/result/:id']
  }));
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║        🚀 Mock Backend Server Started                      ║
╠═══════════════════════════════════════════════════════════╣
║  Server ID: ${SERVER_ID.padEnd(45)} ║
║  Port: ${PORT.toString().padEnd(50)} ║
║  Base URL: http://localhost:${PORT.toString().padEnd(29)} ║
╠═══════════════════════════════════════════════════════════╣
║  Endpoints:                                               ║
║    • Health:  GET  /health                                ║
║    • Predict: POST /predict                               ║
║    • Metrics: GET  /metrics                               ║
║    • Info:    GET  /info                                  ║
║    • Result:  GET  /result/:task_id                       ║
╠═══════════════════════════════════════════════════════════╣
║  Configuration:                                           ║
║    • Simulate Errors: ${SIMULATE_ERRORS.toString().padEnd(35)} ║
║    • Processing Delay: ${(PROCESSING_DELAY + 'ms').padEnd(34)} ║
║    • JWT Auth: Enabled                                    ║
║    • Max Concurrent: 20                                   ║
║    • Capabilities: video, image, text, audio              ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Periodic status update
  setInterval(() => {
    updateMetrics();
    if (serverState.activeTasks > 0 || processingTasks.size > 0) {
      console.log(`📊 Status: Active=${serverState.activeTasks}, Queue=${processingTasks.size}, Success=${serverState.successCount}, Error=${serverState.errorCount}`);
    }
  }, 10000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n📴 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n📴 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});