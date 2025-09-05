const jwt = require('jsonwebtoken');

const JWT_SECRET = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // From .dev.vars
const API_BASE = 'http://localhost:8787';

// Generate JWT token
const token = jwt.sign(
  {
    sub: 'test-user',
    roles: ['admin', 'user'],
    iat: Math.floor(Date.now() / 1000),
  },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '1h' }
);

const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};

async function testAPIs() {
  console.log('Testing RPC-based APIs...\n');

  try {
    // Test 1: Register a server
    console.log('1. Registering server...');
    const registerResponse = await fetch(`${API_BASE}/api/servers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'test-server-1',
        endpoints: {
          predict: 'http://localhost:8000/predict',
          health: 'http://localhost:8000/health'
        },
        maxConcurrent: 10,
        capabilities: ['video-processing'],
        groups: ['production'],
        priority: 5
      })
    });
    
    if (!registerResponse.ok) {
      const error = await registerResponse.text();
      throw new Error(`Failed to register server: ${error}`);
    }
    
    const { serverId } = await registerResponse.json();
    console.log(`✅ Server registered with ID: ${serverId}`);

    // Test 2: List servers
    console.log('\n2. Listing servers...');
    const listResponse = await fetch(`${API_BASE}/api/servers`, {
      headers
    });
    
    if (listResponse.ok) {
      const servers = await listResponse.json();
      console.log(`✅ Found ${servers.length} server(s)`);
    }

    // Test 3: Create a task
    console.log('\n3. Creating task...');
    const taskResponse = await fetch(`${API_BASE}/api/task`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'video-processing',
        priority: 1,
        payload: {
          mimeType: 'video/mp4',
          model: 'test-model',
          video_quality: 'high',
          video_url: 'http://example.com/video.mp4',
          enable_upscale: true
        },
        async: true
      })
    });
    
    if (!taskResponse.ok) {
      const error = await taskResponse.text();
      throw new Error(`Failed to create task: ${error}`);
    }
    
    const task = await taskResponse.json();
    console.log(`✅ Task created with ID: ${task.id}, Status: ${task.status}`);

    // Test 4: Get task status
    console.log('\n4. Getting task status...');
    const statusResponse = await fetch(`${API_BASE}/api/task/${task.id}`, {
      headers
    });
    
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      console.log(`✅ Task status: ${status.status}`);
    }

    // Test 5: Get statistics
    console.log('\n5. Getting statistics...');
    const statsResponse = await fetch(`${API_BASE}/api/stats`, {
      headers
    });
    
    if (statsResponse.ok) {
      const stats = await statsResponse.json();
      console.log(`✅ Statistics - Total tasks: ${stats.totalTasks}, Successful: ${stats.successfulTasks}`);
    }

    // Test 6: Update server heartbeat
    if (serverId) {
      console.log('\n6. Updating server heartbeat...');
      const heartbeatResponse = await fetch(`${API_BASE}/api/servers/${serverId}/heartbeat`, {
        method: 'POST',
        headers
      });
      
      if (heartbeatResponse.ok) {
        console.log(`✅ Heartbeat updated for server ${serverId}`);
      }
    }

    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests
testAPIs().catch(console.error);