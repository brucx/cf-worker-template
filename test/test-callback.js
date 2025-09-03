/**
 * Test callback authentication issue
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');

const WORKER_URL = 'http://localhost:8787';
const JWT_SECRET = 'test-secret-key';

async function testCallbackAuth() {
  console.log('Testing callback authentication...\n');
  
  // Generate admin token
  const adminToken = jwt.sign({
    sub: 'admin-user',
    roles: ['admin'],
    iat: Math.floor(Date.now() / 1000)
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  
  // Generate user token
  const userToken = jwt.sign({
    sub: 'regular-user',
    roles: ['user'],
    iat: Math.floor(Date.now() / 1000)
  }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
  
  try {
    // Test 1: Update task without token (should fail)
    console.log('Test 1: Update task without token');
    try {
      await axios.put(`${WORKER_URL}/api/task/test-task-id`, {
        backend_task_id: 'backend-test',
        data: { result: 'test' },
        metadata: {
          server_id: 'test-server',
          status: 'FINISHED'
        }
      });
      console.log('❌ FAIL: Request without token should have been rejected');
    } catch (error) {
      console.log(`✅ PASS: Request rejected with status ${error.response?.status}`);
    }
    
    // Test 2: Update task with user token (should succeed)
    console.log('\nTest 2: Update task with user token');
    try {
      await axios.put(`${WORKER_URL}/api/task/test-task-id`, {
        backend_task_id: 'backend-test',
        data: { result: 'test' },
        metadata: {
          server_id: 'test-server',
          status: 'FINISHED'
        }
      }, {
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      console.log('✅ PASS: Request with user token succeeded');
    } catch (error) {
      console.log(`Status: ${error.response?.status}`);
      console.log(`Message: ${error.response?.data?.error || error.message}`);
    }
    
    // Test 3: Update task with admin token (should succeed)
    console.log('\nTest 3: Update task with admin token');
    try {
      await axios.put(`${WORKER_URL}/api/task/test-task-id`, {
        backend_task_id: 'backend-test',
        data: { result: 'test' },
        metadata: {
          server_id: 'test-server',
          status: 'FINISHED'
        }
      }, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      console.log('✅ PASS: Request with admin token succeeded');
    } catch (error) {
      console.log(`Status: ${error.response?.status}`);
      console.log(`Message: ${error.response?.data?.error || error.message}`);
    }
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Check if Worker is running
axios.get(WORKER_URL)
  .then(() => {
    console.log('Worker is running at', WORKER_URL);
    testCallbackAuth();
  })
  .catch(() => {
    console.log('Worker is not running. Please start it with: npm run dev');
  });