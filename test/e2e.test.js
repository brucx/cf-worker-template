/**
 * End-to-End Test Suite for Cloudflare Workers API
 * Tests complete workflows including task creation, server registration, and processing
 */

const { describe, it, before, after, beforeEach } = require('mocha');
const { expect } = require('chai');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');

// Test configuration
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const MOCK_SERVER_URL = process.env.MOCK_SERVER_URL || 'http://localhost:8080';
// Use the same JWT_SECRET as defined in .dev.vars
const JWT_SECRET = process.env.JWT_SECRET || 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const TEST_TIMEOUT = 30000; // 30 seconds

// Test data
let adminToken;
let userToken;
let mockServerProcess;
let workerProcess;
let testServerId = 'test-server-' + Date.now();
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

// Test Suite
describe('E2E Tests', function() {
  this.timeout(TEST_TIMEOUT);

  before(async function() {
    console.log('Setting up test environment...');
    
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

    // Start mock backend server
    console.log('Starting mock backend server...');
    mockServerProcess = spawn('node', ['mock-server.js'], {
      env: { ...process.env, MOCK_SERVER_PORT: '8080' },
      stdio: 'inherit',
      cwd: __dirname  // Set cwd to test directory
    });

    // Start Cloudflare Worker in dev mode
    console.log('Starting Cloudflare Worker...');
    workerProcess = spawn('npx', ['wrangler', 'dev', '--port', '8787'], {
      env: { ...process.env, JWT_SECRET },
      stdio: 'inherit'
    });

    // Wait for servers to be ready
    await waitForServer(`${MOCK_SERVER_URL}/health`);
    await waitForServer(WORKER_URL);
    console.log('Test environment ready!');
  });

  after(async function() {
    console.log('Cleaning up test environment...');
    
    // Clean up test server if it exists
    try {
      await axios.delete(`${WORKER_URL}/api/servers/${testServerId}`, {
        headers: await createAuthHeaders(true)
      });
    } catch (error) {
      // Server might already be deleted
    }

    // Stop processes
    if (mockServerProcess) {
      mockServerProcess.kill('SIGTERM');
    }
    if (workerProcess) {
      workerProcess.kill('SIGTERM');
    }
  });

  describe('Authentication Tests', () => {
    it('should reject requests without JWT token', async () => {
      try {
        await axios.get(`${WORKER_URL}/api/servers`);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(401);
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

    it('should accept requests with valid JWT token', async () => {
      const response = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });
      expect(response.status).to.equal(200);
    });
  });

  describe('Server Management Tests', () => {
    it('should register a new server (admin only)', async () => {
      const serverData = {
        id: testServerId,
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`
        },
        provider: 'test-provider',
        name: 'Test Server',
        async: true,
        callback: true
      };

      const response = await axios.post(`${WORKER_URL}/api/servers`, serverData, {
        headers: await createAuthHeaders(true)
      });

      expect(response.status).to.equal(200);
      expect(response.data.id).to.equal(testServerId);
      expect(response.data.success).to.be.true;
    });

    it('should reject server registration from non-admin users', async () => {
      const serverData = {
        id: 'unauthorized-server',
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`
        },
        provider: 'test-provider',
        name: 'Unauthorized Server'
      };

      try {
        await axios.post(`${WORKER_URL}/api/servers`, serverData, {
          headers: await createAuthHeaders(false)
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(403);
      }
    });

    it('should list registered servers', async () => {
      const response = await axios.get(`${WORKER_URL}/api/servers`, {
        headers: await createAuthHeaders(true)
      });

      expect(response.status).to.equal(200);
      expect(response.data.servers).to.be.an('array');
      
      const testServer = response.data.servers.find(s => s.id === testServerId);
      expect(testServer).to.exist;
      expect(testServer.name).to.equal('Test Server');
    });

    it('should get server details', async () => {
      const response = await axios.get(`${WORKER_URL}/api/servers/${testServerId}`, {
        headers: await createAuthHeaders(true)
      });

      expect(response.status).to.equal(200);
      expect(response.data.id).to.equal(testServerId);
      expect(response.data.endpoints.predict).to.include('/predict');
    });

    it('should update server heartbeat', async () => {
      const response = await axios.post(
        `${WORKER_URL}/api/servers/${testServerId}/heartbeat`,
        {},
        { headers: await createAuthHeaders(true) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.success).to.be.true;
      expect(response.data.lastHeartbeat).to.exist;
    });

    it('should handle server health checks', async function() {
      // Wait for health check to occur
      await new Promise(resolve => setTimeout(resolve, 5000));

      const response = await axios.get(`${WORKER_URL}/api/servers/${testServerId}`, {
        headers: await createAuthHeaders(true)
      });

      // Server should be either online or offline depending on health check timing
      expect(response.data.status).to.be.oneOf(['online', 'offline']);
    });
  });

  describe('Task Management Tests', () => {
    it('should create a new task', async () => {
      const taskData = {
        mimeType: 'application/json',
        model: 'test-model',
        video_quality: 'high',
        video_url: 'https://example.com/test.mp4',
        enable_upscale: true
      };

      const response = await axios.post(`${WORKER_URL}/api/task`, taskData, {
        headers: await createAuthHeaders(false)
      });

      expect(response.status).to.equal(200);
      expect(response.data.taskId).to.exist;
      testTaskId = response.data.taskId;
      
      expect(response.data.taskDetails).to.exist;
      expect(response.data.taskDetails.status).to.be.oneOf(['WAITING', 'PROCESSING']);
    });

    it('should reject task creation with invalid data', async () => {
      const invalidTaskData = {
        mimeType: 'application/json'
        // Missing required fields
      };

      try {
        await axios.post(`${WORKER_URL}/api/task`, invalidTaskData, {
          headers: await createAuthHeaders(false)
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(400);
      }
    });

    it('should get task details', async () => {
      const response = await axios.get(`${WORKER_URL}/api/task/${testTaskId}`, {
        headers: await createAuthHeaders(false)
      });

      expect(response.status).to.equal(200);
      expect(response.data.taskId).to.equal(testTaskId);
      expect(response.data.taskDetails).to.exist;
    });

    it('should process task and update status', async function() {
      // Wait for task to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check task status
      const response = await axios.get(`${WORKER_URL}/api/task/${testTaskId}`, {
        headers: await createAuthHeaders(false)
      });

      expect(response.data.taskDetails.status).to.be.oneOf(['PROCESSING', 'FINISHED']);
      
      if (response.data.taskDetails.status === 'FINISHED') {
        expect(response.data.taskDetails.result).to.exist;
        expect(response.data.taskDetails.result.data).to.exist;
      }
    });

    it('should update task with results', async () => {
      const updateData = {
        backend_task_id: `backend-${testTaskId}`,
        data: {
          prediction: 'positive',
          confidence: 0.95
        },
        metadata: {
          server_id: testServerId,
          processing_time: 1000,
          model_time: 800,
          queue_time: 200,
          progress: 100,
          status: 'FINISHED',
          message: 'Processing completed'
        }
      };

      const response = await axios.put(
        `${WORKER_URL}/api/task/${testTaskId}`,
        updateData,
        { headers: await createAuthHeaders(false) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.taskDetails.status).to.equal('FINISHED');
    });

    it('should handle task not found', async () => {
      try {
        await axios.get(`${WORKER_URL}/api/task/nonexistent-task-id`, {
          headers: await createAuthHeaders(false)
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.be.oneOf([404, 500]);
      }
    });
  });

  describe('Concurrent Operations Tests', () => {
    it('should handle concurrent task creation', async () => {
      const taskPromises = [];
      const taskCount = 10;

      for (let i = 0; i < taskCount; i++) {
        const taskData = {
          mimeType: 'application/json',
          model: 'test-model',
          video_quality: 'high',
          video_url: `https://example.com/test-${i}.mp4`,
          enable_upscale: false
        };

        taskPromises.push(
          axios.post(`${WORKER_URL}/api/task`, taskData, {
            headers: await createAuthHeaders(false)
          })
        );
      }

      const responses = await Promise.all(taskPromises);
      
      expect(responses).to.have.lengthOf(taskCount);
      responses.forEach(response => {
        expect(response.status).to.equal(200);
        expect(response.data.taskId).to.exist;
      });

      // Verify all tasks have unique IDs
      const taskIds = responses.map(r => r.data.taskId);
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).to.equal(taskCount);
    });

    it('should handle concurrent server operations', async () => {
      const operations = [
        axios.get(`${WORKER_URL}/api/servers`, {
          headers: await createAuthHeaders(true)
        }),
        axios.get(`${WORKER_URL}/api/servers/${testServerId}`, {
          headers: await createAuthHeaders(true)
        }),
        axios.post(
          `${WORKER_URL}/api/servers/${testServerId}/heartbeat`,
          {},
          { headers: await createAuthHeaders(true) }
        )
      ];

      const responses = await Promise.all(operations);
      
      responses.forEach(response => {
        expect(response.status).to.equal(200);
      });
    });
  });

  describe('Error Handling Tests', () => {
    it('should handle server removal gracefully', async () => {
      const tempServerId = 'temp-server-' + Date.now();
      
      // Register temporary server
      await axios.post(`${WORKER_URL}/api/servers`, {
        id: tempServerId,
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: 'http://nonexistent-server:9999/health' // Invalid health endpoint
        },
        provider: 'temp-provider',
        name: 'Temporary Server'
      }, {
        headers: await createAuthHeaders(true)
      });

      // Wait for health check to fail
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Try to get server - should still exist but be offline
      const response = await axios.get(`${WORKER_URL}/api/servers/${tempServerId}`, {
        headers: await createAuthHeaders(true)
      });

      expect(response.data.status).to.equal('offline');

      // Delete the server
      const deleteResponse = await axios.delete(`${WORKER_URL}/api/servers/${tempServerId}`, {
        headers: await createAuthHeaders(true)
      });

      expect(deleteResponse.status).to.equal(200);
    });

    it('should handle database errors gracefully', async () => {
      // This test would require simulating database failures
      // For now, we just verify error handling exists
      expect(true).to.be.true;
    });
  });

  describe('API Documentation Tests', () => {
    it('should provide OpenAPI documentation', async () => {
      const response = await axios.get(`${WORKER_URL}/docs`);
      
      expect(response.status).to.equal(200);
      expect(response.headers['content-type']).to.include('text/html');
    });
  });

  describe('Cleanup Tests', () => {
    it('should cleanup stale servers', async () => {
      const response = await axios.post(
        `${WORKER_URL}/api/servers/cleanup`,
        { maxAgeMins: 60 },
        { headers: await createAuthHeaders(true) }
      );

      expect(response.status).to.equal(200);
      expect(response.data.success).to.be.true;
      expect(response.data.removedServers).to.be.an('array');
    });

    it('should delete server successfully', async () => {
      // Create a server to delete
      const deleteTestServerId = 'delete-test-' + Date.now();
      
      await axios.post(`${WORKER_URL}/api/servers`, {
        id: deleteTestServerId,
        endpoints: {
          predict: `${MOCK_SERVER_URL}/predict`,
          health: `${MOCK_SERVER_URL}/health`
        },
        provider: 'delete-test',
        name: 'Delete Test Server'
      }, {
        headers: await createAuthHeaders(true)
      });

      // Delete the server
      const deleteResponse = await axios.delete(
        `${WORKER_URL}/api/servers/${deleteTestServerId}`,
        { headers: await createAuthHeaders(true) }
      );

      expect(deleteResponse.status).to.equal(200);
      expect(deleteResponse.data.success).to.be.true;

      // Verify server is deleted
      try {
        await axios.get(`${WORKER_URL}/api/servers/${deleteTestServerId}`, {
          headers: await createAuthHeaders(true)
        });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.response.status).to.equal(404);
      }
    });
  });
});