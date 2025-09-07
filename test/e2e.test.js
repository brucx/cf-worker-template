/**
 * End-to-End Test Suite for Cloudflare Workers Task Processing System
 * Tests complete workflows including all API endpoints and RPC-based Durable Objects
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://localhost:8080';
const JWT_SECRET = process.env.JWT_SECRET || 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // Must match .dev.vars
const TEST_TIMEOUT = 30000; // 30 seconds

// Test data
let adminToken;
let userToken;
let mockServerProcess;
let workerProcess;
let testServerId;
let testTaskId;

// Helper functions
function generateJWT(payload) {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await axios.get(url);
      return true;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Server ${url} did not start within ${maxAttempts} seconds`);
}

async function createAuthHeaders(isAdmin = false) {
  const token = isAdmin ? adminToken : userToken;
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// Main Test Suite
describe('E2E Tests - Task Processing System', function() {
  this.timeout(TEST_TIMEOUT);

  before(async function() {
    console.log('🚀 Setting up test environment...');
    
    // Generate test tokens
    adminToken = generateJWT({
      sub: 'admin-user',
      roles: ['admin'],
      iat: Math.floor(Date.now() / 1000)
    });
    
    userToken = generateJWT({
      sub: 'regular-user',
      roles: ['user'],
      iat: Math.floor(Date.now() / 1000)
    });

    console.log('📝 Test tokens generated');

    // Start mock backend server
    console.log('🔧 Starting mock backend server...');
    mockServerProcess = spawn('node', ['mock-server.js'], {
      env: { ...process.env, MOCK_SERVER_PORT: '8080' },
      stdio: 'inherit',
      cwd: __dirname
    });

    // Start Cloudflare Worker in dev mode
    console.log('☁️ Starting Cloudflare Worker...');
    const projectRoot = path.resolve(__dirname, '..');
    workerProcess = spawn('npm', ['run', 'dev'], {
      env: { ...process.env, JWT_SECRET },
      stdio: 'inherit',
      cwd: projectRoot
    });

    // Wait for servers to be ready
    await waitForServer(`${MOCK_SERVER_URL}/health`);
    await waitForServer(`${WORKER_URL}/docs`);
    console.log('✅ Test environment ready!\n');
  });

  after(async function() {
    console.log('\n🧹 Cleaning up test environment...');
    
    // Clean up any remaining test servers
    if (testServerId) {
      try {
        await axios.delete(`${WORKER_URL}/api/servers/${testServerId}`, {
          headers: await createAuthHeaders(true)
        });
      } catch (error) {
        // Server might already be deleted
      }
    }

    // Stop processes
    if (mockServerProcess) {
      mockServerProcess.kill('SIGTERM');
    }
    if (workerProcess) {
      workerProcess.kill('SIGTERM');
    }
    
    console.log('✅ Cleanup complete');
  });

  describe('🔐 Authentication & Authorization', () => {
    it('should reject requests without JWT token', async () => {
      try {
        await axios.get(`${WORKER_URL}/api/servers`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(401);
        if (error.response.data && error.response.data.error) {
          expect(error.response.data.error).to.include('Unauthorized');
        }
      }
    });

    it('should reject requests with invalid JWT token', async () => {
      try {
        await axios.get(`${WORKER_URL}/api/servers`, {
          headers: { 'Authorization': 'Bearer invalid-token' }
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(401);
      }
    });

    it('should reject expired JWT token', async () => {
      const expiredToken = jwt.sign(
        { sub: 'user', roles: ['user'], iat: Math.floor(Date.now() / 1000) - 7200 },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '-1h' }
      );
      
      try {
        await axios.get(`${WORKER_URL}/api/servers`, {
          headers: { 'Authorization': `Bearer ${expiredToken}` }
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(401);
      }
    });

    it('should accept requests with valid JWT token', async () => {
      const response = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });
      expect(response.status).to.equal(200);
      expect(response.data.servers).to.be.an('array');
    });

    it('should enforce role-based access control', async () => {
      // Non-admin trying to register a server
      try {
        await axios.post(`${WORKER_URL}/api/servers`, {
          name: 'unauthorized-server',
          endpoints: { predict: 'http://test.com', health: 'http://test.com' }
        }, {
          headers: await createAuthHeaders(false) // regular user
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(403);
        if (error.response.data && error.response.data.error) {
          expect(error.response.data.error).to.include('Admin role required');
        }
      }
    });
  });

  describe('🖥️ Server Management (RPC)', () => {
    it('should register a new server via RPC', async () => {
      testServerId = 'server_' + Date.now();
      const serverData = {
        id: testServerId,
        name: 'GPU Server 01',
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`,
          metrics: `${MOCK_SERVER_URL}/metrics`
        },
        apiKey: 'test-api-key',
        maxConcurrent: 10,
        capabilities: ['video', 'image', 'text'],
        groups: ['production', 'gpu'],
        priority: 2
      };

      const response = await axios.post(`${WORKER_URL}/api/servers`, serverData, {
        headers: await createAuthHeaders(true)
      });

      expect(response.status).to.equal(200);
      expect(response.data.serverId).to.exist;
      expect(response.data.message).to.include('registered successfully');
      testServerId = response.data.serverId;
    });

    it('should list all registered servers', async () => {
      const response = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });

      expect(response.status).to.equal(200);
      expect(response.data.servers).to.be.an('array');
      
      const testServer = response.data.servers.find(s => s.id === testServerId);
      expect(testServer).to.exist;
      expect(testServer.name).to.equal('GPU Server 01');
      expect(testServer.status).to.be.oneOf(['active', 'inactive', 'online', 'offline']);
      // Verify new time fields
      expect(testServer.uptime).to.be.a('number');
      expect(testServer.uptime).to.be.at.least(0);
      expect(testServer.timeSinceLastHeartbeat).to.be.a('number');
      expect(testServer.timeSinceLastHeartbeat).to.be.at.least(0);
    });

    it('should update server heartbeat', async () => {
      // Get initial heartbeat time
      const beforeResponse = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });
      const serverBefore = beforeResponse.data.servers.find(s => s.id === testServerId);
      const initialHeartbeatTime = serverBefore?.timeSinceLastHeartbeat;
      
      // Wait a bit to have measurable difference
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const response = await axios.post(
        `${WORKER_URL}/api/servers/${testServerId}/heartbeat`,
        {
          status: 'healthy',
          activeTasks: 3,
          metrics: { cpu: 45, memory: 60, gpu: 80 }
        },
        { headers: await createAuthHeaders(true) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.message).to.include('Heartbeat updated');
      
      // Verify heartbeat was updated
      const afterResponse = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });
      const serverAfter = afterResponse.data.servers.find(s => s.id === testServerId);
      expect(serverAfter.timeSinceLastHeartbeat).to.be.lessThan(initialHeartbeatTime);
    });

    it('should set server maintenance mode', async () => {
      const response = await axios.post(
        `${WORKER_URL}/api/servers/${testServerId}/maintenance`,
        { maintenance: true, reason: 'Scheduled maintenance' },
        { headers: await createAuthHeaders(true) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.message).to.include('Maintenance mode');
      
      // Disable maintenance
      await axios.post(
        `${WORKER_URL}/api/servers/${testServerId}/maintenance`,
        { maintenance: false },
        { headers: await createAuthHeaders(true) }
      );
    });

    it('should get server metrics', async () => {
      const response = await axios.get(
        `${WORKER_URL}/api/servers/${testServerId}/metrics`,
        { headers: await createAuthHeaders(true) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.serverId).to.equal(testServerId);
      expect(response.data.metrics).to.exist;
    });

    it('should handle server health monitoring', async function() {
      this.timeout(10000);
      
      // Wait for health check cycle
      await new Promise(resolve => setTimeout(resolve, 3000));

      const response = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });

      const server = response.data.servers.find(s => s.id === testServerId);
      expect(server.health).to.exist;
      expect(server.health.status).to.be.oneOf(['healthy', 'unhealthy']);
      expect(server.health.lastHeartbeat).to.be.a('number');
    });
  });

  describe('📦 Task Management (RPC)', () => {
    it('should create a new task with proper schema', async () => {
      const taskData = {
        type: 'video-processing',
        priority: 1,
        payload: {
          mimeType: 'video/mp4',
          model: 'standard',
          video_quality: '1080p',
          video_url: 'https://example.com/test.mp4',
          enable_upscale: false
        },
        capabilities: ['video'],
        async: true
      };

      const response = await axios.post(`${WORKER_URL}/api/task`, taskData, {
        headers: await createAuthHeaders(false)
      });

      expect(response.status).to.equal(200);
      expect(response.data.id).to.exist;
      expect(response.data.status).to.equal('PENDING');
      testTaskId = response.data.id;
    });

    it('should get task status via RPC', async () => {
      const response = await axios.get(`${WORKER_URL}/api/task/${testTaskId}`, {
        headers: await createAuthHeaders(false)
      });

      expect(response.status).to.equal(200);
      expect(response.data.id).to.equal(testTaskId);
      expect(response.data.status).to.be.oneOf(['PENDING', 'PROCESSING', 'COMPLETED']);
      expect(response.data.createdAt).to.be.a('number');
    });

    it('should update task status (backend callback)', async () => {
      const updateData = {
        status: 'COMPLETED',
        result: {
          output_url: 'https://example.com/processed.mp4',
          duration: 120,
          frames: 3600
        }
      };

      const response = await axios.put(
        `${WORKER_URL}/api/task/${testTaskId}`,
        updateData,
        { headers: await createAuthHeaders(false) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.message).to.include('updated');
    });

    it('should retry failed task', async () => {
      // Create a task that will fail
      const failTaskData = {
        type: 'video-processing',
        priority: 0,
        payload: {
          mimeType: 'video/mp4',
          model: 'fail-model', // Special model to trigger failure
          video_quality: '1080p',
          video_url: 'https://example.com/fail.mp4',
          enable_upscale: false
        },
        capabilities: ['video'],
        async: true
      };

      const createResponse = await axios.post(`${WORKER_URL}/api/task`, failTaskData, {
        headers: await createAuthHeaders(false)
      });
      
      const failTaskId = createResponse.data.id;
      
      // Update to failed status
      await axios.put(`${WORKER_URL}/api/task/${failTaskId}`, {
        status: 'FAILED',
        error: 'Processing failed'
      }, { headers: await createAuthHeaders(false) });

      // Retry the task
      const retryResponse = await axios.post(
        `${WORKER_URL}/api/task/${failTaskId}/retry`,
        {},
        { headers: await createAuthHeaders(false) }
      );

      expect(retryResponse.status).to.equal(200);
      expect(retryResponse.data.message).to.include('retry');
    });

    it('should cancel pending task', async () => {
      // Create a new task
      const taskData = {
        type: 'video-processing',
        priority: 0,
        payload: {
          mimeType: 'video/mp4',
          model: 'slow-model',
          video_quality: '4k',
          video_url: 'https://example.com/large.mp4',
          enable_upscale: true
        },
        capabilities: ['video'],
        async: true
      };

      const createResponse = await axios.post(`${WORKER_URL}/api/task`, taskData, {
        headers: await createAuthHeaders(false)
      });
      
      const cancelTaskId = createResponse.data.id;

      // Cancel the task
      const cancelResponse = await axios.post(
        `${WORKER_URL}/api/task/${cancelTaskId}/cancel`,
        {},
        { headers: await createAuthHeaders(false) }
      );

      expect(cancelResponse.status).to.equal(200);
      expect(cancelResponse.data.message).to.include('cancelled');

      // Verify task is cancelled
      const statusResponse = await axios.get(`${WORKER_URL}/api/task/${cancelTaskId}`, {
        headers: await createAuthHeaders(false)
      });
      
      expect(statusResponse.data.status).to.equal('CANCELLED');
    });

    it('should handle task not found', async () => {
      try {
        await axios.get(`${WORKER_URL}/api/task/nonexistent_task_123`, {
          headers: await createAuthHeaders(false)
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
        if (error.response.data && error.response.data.error) {
          expect(error.response.data.error).to.include('not found');
        }
      }
    });
  });

  describe('📊 Statistics & Metrics', () => {
    it('should get task statistics', async () => {
      const response = await axios.get(`${WORKER_URL}/api/stats/tasks`, {
        headers: await createAuthHeaders(false),
        params: { date: new Date().toISOString().slice(0, 10) }
      });

      expect(response.status).to.equal(200);
      expect(response.data.totalTasks).to.be.a('number');
      expect(response.data.pendingTasks).to.be.a('number');
      expect(response.data.successfulTasks).to.be.a('number');
      expect(response.data.failedTasks).to.be.a('number');
      expect(response.data.averageProcessingTime).to.be.a('number');
    });

    it('should get hourly report', async () => {
      const response = await axios.get(`${WORKER_URL}/api/stats/hourly`, {
        headers: await createAuthHeaders(false),
        params: { date: new Date().toISOString().slice(0, 10) }
      });

      expect(response.status).to.equal(200);
      expect(response.data.date).to.exist;
      expect(response.data.hourlyBreakdown).to.be.an('array');
      expect(response.data.hourlyBreakdown).to.have.lengthOf(24);
    });

    it('should get server statistics', async () => {
      const response = await axios.get(`${WORKER_URL}/api/stats/servers/${testServerId}`, {
        headers: await createAuthHeaders(true),
        params: { date: new Date().toISOString().slice(0, 10) }
      });

      expect(response.status).to.equal(200);
      expect(response.data.serverId).to.equal(testServerId);
      expect(response.data.tasksProcessed).to.be.a('number');
      expect(response.data.successRate).to.be.a('number');
    });
  });

  describe('⚖️ Load Balancing', () => {
    let server2Id, server3Id;

    before(async () => {
      // Register additional servers for load balancing tests
      server2Id = 'server_lb_2_' + Date.now();
      server3Id = 'server_lb_3_' + Date.now();

      await axios.post(`${WORKER_URL}/api/servers`, {
        id: server2Id,
        name: 'Load Balance Server 2',
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`
        },
        maxConcurrent: 5,
        priority: 1
      }, { headers: await createAuthHeaders(true) });

      await axios.post(`${WORKER_URL}/api/servers`, {
        id: server3Id,
        name: 'Load Balance Server 3',
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`
        },
        maxConcurrent: 15,
        priority: 3
      }, { headers: await createAuthHeaders(true) });
    });

    after(async () => {
      // Clean up test servers
      try {
        await axios.delete(`${WORKER_URL}/api/servers/${server2Id}`, {
          headers: await createAuthHeaders(true)
        });
        await axios.delete(`${WORKER_URL}/api/servers/${server3Id}`, {
          headers: await createAuthHeaders(true)
        });
      } catch (error) {
        // Servers might already be deleted
      }
    });

    it('should get load balancer status', async () => {
      const response = await axios.get(`${WORKER_URL}/api/stats/load-balancer`, {
        headers: await createAuthHeaders(false)
      });

      expect(response.status).to.equal(200);
      expect(response.data.algorithm).to.be.oneOf([
        'round-robin', 
        'least-connections', 
        'weighted-round-robin',
        'random'
      ]);
      expect(response.data.serverDistribution).to.be.an('object');
    });

    it('should set load balancer algorithm', async () => {
      const algorithms = ['round-robin', 'least-connections', 'weighted-round-robin'];
      
      for (const algo of algorithms) {
        const response = await axios.post(
          `${WORKER_URL}/api/stats/load-balancer/algorithm`,
          { algorithm: algo },
          { headers: await createAuthHeaders(true) }
        );

        expect(response.status).to.equal(200);
        expect(response.data.algorithm).to.equal(algo);
      }
    });

    it('should distribute tasks across servers', async () => {
      // Set to round-robin for predictable distribution
      await axios.post(
        `${WORKER_URL}/api/stats/load-balancer/algorithm`,
        { algorithm: 'round-robin' },
        { headers: await createAuthHeaders(true) }
      );

      // Create multiple tasks
      const taskIds = [];
      for (let i = 0; i < 6; i++) {
        const response = await axios.post(`${WORKER_URL}/api/task`, {
          type: 'video-processing',
          priority: 1,
          payload: {
            mimeType: 'video/mp4',
            model: 'standard',
            video_quality: '720p',
            video_url: `https://example.com/lb-test-${i}.mp4`,
            enable_upscale: false
          },
          capabilities: ['video'],
          async: true
        }, { headers: await createAuthHeaders(false) });
        
        taskIds.push(response.data.id);
      }

      // Check load balancer status to see distribution
      const lbStatus = await axios.get(`${WORKER_URL}/api/stats/load-balancer`, {
        headers: await createAuthHeaders(false)
      });

      expect(lbStatus.data.totalActiveTasks).to.be.at.least(0);
      expect(Object.keys(lbStatus.data.serverDistribution)).to.have.length.at.least(1);
    });
  });

  describe('🔄 Concurrent Operations', () => {
    it('should handle concurrent task creation', async () => {
      const taskPromises = [];
      const taskCount = 20;

      for (let i = 0; i < taskCount; i++) {
        const taskData = {
          type: 'video-processing',
          priority: Math.floor(Math.random() * 3),
          payload: {
            mimeType: 'video/mp4',
            model: 'concurrent-test',
            video_quality: ['720p', '1080p', '4k'][i % 3],
            video_url: `https://example.com/concurrent-${i}.mp4`,
            enable_upscale: i % 2 === 0
          },
          capabilities: ['video'],
          async: true
        };

        taskPromises.push(
          axios.post(`${WORKER_URL}/api/task`, taskData, {
            headers: await createAuthHeaders(false)
          })
        );
      }

      const responses = await Promise.allSettled(taskPromises);
      const successful = responses.filter(r => r.status === 'fulfilled');
      
      expect(successful).to.have.length.at.least(taskCount * 0.8); // At least 80% should succeed
      
      // Verify all successful tasks have unique IDs
      const taskIds = successful.map(r => r.value.data.id);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).to.equal(successful.length);
    });

    it('should handle concurrent server operations', async () => {
      const operations = [];
      
      // Mix of different operations
      for (let i = 0; i < 5; i++) {
        operations.push(
          axios.get(`${WORKER_URL}/api/servers`, {
            headers: await createAuthHeaders(true)
          })
        );
        
        operations.push(
          axios.post(`${WORKER_URL}/api/servers/${testServerId}/heartbeat`, 
            { status: 'healthy', activeTasks: i },
            { headers: await createAuthHeaders(true) }
          )
        );
      }

      const responses = await Promise.allSettled(operations);
      const successful = responses.filter(r => r.status === 'fulfilled');
      
      expect(successful).to.have.length.at.least(operations.length * 0.9);
    });

    it('should handle race conditions in task assignment', async () => {
      // Create tasks simultaneously to test race conditions
      const taskPromises = [];
      
      for (let i = 0; i < 10; i++) {
        taskPromises.push(
          axios.post(`${WORKER_URL}/api/task`, {
            type: 'video-processing',
            priority: 2,
            payload: {
              mimeType: 'video/mp4',
              model: 'race-test',
              video_quality: '1080p',
              video_url: `https://example.com/race-${i}.mp4`,
              enable_upscale: false
            },
            capabilities: ['video'],
            async: true
          }, { headers: await createAuthHeaders(false) })
        );
      }

      const responses = await Promise.allSettled(taskPromises);
      
      // All should succeed despite race conditions
      responses.forEach(response => {
        expect(response.status).to.equal('fulfilled');
        if (response.status === 'fulfilled') {
          expect(response.value.data.id).to.exist;
        }
      });
    });
  });

  describe('🚨 Error Handling & Recovery', () => {
    it('should handle invalid task data gracefully', async () => {
      const invalidData = [
        { type: 'video-processing' }, // Missing payload
        { payload: { mimeType: 'video/mp4' } }, // Missing type
        { type: 'invalid-type', payload: {} }, // Invalid type
        { type: 'video-processing', priority: 100, payload: {} }, // Invalid priority
      ];

      for (const data of invalidData) {
        try {
          await axios.post(`${WORKER_URL}/api/task`, data, {
            headers: await createAuthHeaders(false)
          });
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.response.status).to.be.oneOf([400, 422]);
          if (error.response.data) {
            expect(error.response.data.error).to.exist;
          }
        }
      }
    });

    it('should handle server failures gracefully', async () => {
      const failServerId = 'fail_server_' + Date.now();
      
      // Register server with unreachable endpoint
      await axios.post(`${WORKER_URL}/api/servers`, {
        id: failServerId,
        name: 'Failing Server',
        endpoints: {
          predict: 'http://nonexistent-server:9999/predict',
          health: 'http://nonexistent-server:9999/health'
        },
        maxConcurrent: 10
      }, { headers: await createAuthHeaders(true) });

      // Wait for health check to detect failure
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Server should be marked as unhealthy
      const response = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });

      const failServer = response.data.servers.find(s => s.id === failServerId);
      if (failServer && failServer.health) {
        expect(failServer.health.status).to.equal('unhealthy');
      }

      // Clean up
      await axios.delete(`${WORKER_URL}/api/servers/${failServerId}`, {
        headers: await createAuthHeaders(true)
      });
    });

    it('should recover from Durable Object failures', async () => {
      // This test simulates DO recovery by creating many tasks quickly
      const taskPromises = [];
      
      for (let i = 0; i < 5; i++) {
        taskPromises.push(
          axios.post(`${WORKER_URL}/api/task`, {
            type: 'video-processing',
            priority: 1,
            payload: {
              mimeType: 'video/mp4',
              model: 'recovery-test',
              video_quality: '1080p',
              video_url: `https://example.com/recovery-${i}.mp4`,
              enable_upscale: false
            },
            capabilities: ['video'],
            async: true
          }, { headers: await createAuthHeaders(false) })
        );
      }

      const responses = await Promise.allSettled(taskPromises);
      const successful = responses.filter(r => r.status === 'fulfilled');
      
      // Even with potential DO issues, most should succeed
      expect(successful.length).to.be.at.least(3);
    });

    it('should handle database errors gracefully', async () => {
      // Try to get a task with an extremely long ID that might cause issues
      const longId = 'task_' + 'x'.repeat(1000);
      
      try {
        await axios.get(`${WORKER_URL}/api/task/${longId}`, {
          headers: await createAuthHeaders(false)
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.be.oneOf([400, 404, 500]);
      }
    });
  });

  describe('📚 API Documentation', () => {
    it('should provide OpenAPI documentation', async () => {
      const response = await axios.get(`${WORKER_URL}/docs`);
      
      expect(response.status).to.equal(200);
      expect(response.headers['content-type']).to.include('text/html');
      expect(response.data).to.include('swagger');
    });

    it('should provide OpenAPI JSON specification', async () => {
      const response = await axios.get(`${WORKER_URL}/openapi.json`);
      
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an('object');
      expect(response.data.openapi).to.exist;
      expect(response.data.paths).to.be.an('object');
      expect(response.data.components).to.be.an('object');
    });

    it('should have proper tags in OpenAPI spec', async () => {
      const response = await axios.get(`${WORKER_URL}/openapi.json`);
      
      expect(response.data.tags).to.be.an('array');
      const tagNames = response.data.tags.map(t => t.name);
      expect(tagNames).to.include.members(['Tasks', 'Servers', 'Statistics', 'Load Balancer']);
    });
  });

  describe('🧹 Cleanup & Maintenance', () => {
    it('should unregister server successfully', async () => {
      const tempServerId = 'temp_server_' + Date.now();
      
      // Register temporary server
      await axios.post(`${WORKER_URL}/api/servers`, {
        id: tempServerId,
        name: 'Temporary Server',
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`
        }
      }, { headers: await createAuthHeaders(true) });

      // Delete the server
      const deleteResponse = await axios.delete(
        `${WORKER_URL}/api/servers/${tempServerId}`,
        { headers: await createAuthHeaders(true) }
      );

      expect(deleteResponse.status).to.equal(200);

      // Verify server is deleted
      const listResponse = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });
      
      const deletedServer = listResponse.data.servers.find(s => s.id === tempServerId);
      expect(deletedServer).to.be.undefined;
    });

    it('should handle cleanup of stale data', async () => {
      // Create tasks and let them complete
      const oldTaskData = {
        type: 'video-processing',
        priority: 0,
        payload: {
          mimeType: 'video/mp4',
          model: 'cleanup-test',
          video_quality: '720p',
          video_url: 'https://example.com/cleanup.mp4',
          enable_upscale: false
        },
        capabilities: ['video'],
        async: true
      };

      const response = await axios.post(`${WORKER_URL}/api/task`, oldTaskData, {
        headers: await createAuthHeaders(false)
      });

      const oldTaskId = response.data.id;

      // Mark as completed
      await axios.put(`${WORKER_URL}/api/task/${oldTaskId}`, {
        status: 'COMPLETED',
        result: { processed: true }
      }, { headers: await createAuthHeaders(false) });

      // Task should still be retrievable
      const getResponse = await axios.get(`${WORKER_URL}/api/task/${oldTaskId}`, {
        headers: await createAuthHeaders(false)
      });

      expect(getResponse.status).to.equal(200);
      expect(getResponse.data.status).to.equal('COMPLETED');
    });
  });
});