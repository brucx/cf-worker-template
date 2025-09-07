const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Simple JWT generation for testing
function base64url(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Read JWT_SECRET from .dev.vars file
function readJwtSecret() {
  try {
    const devVarsPath = path.join(__dirname, '.dev.vars');
    const content = fs.readFileSync(devVarsPath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('JWT_SECRET')) {
        // Extract value, handling both quoted and unquoted values
        const match = line.match(/JWT_SECRET\s*=\s*"?([^"]+)"?/);
        if (match) {
          return match[1].trim();
        }
      }
    }
    
    throw new Error('JWT_SECRET not found in .dev.vars');
  } catch (error) {
    console.error('Error reading .dev.vars:', error.message);
    console.error('Please ensure .dev.vars file exists with JWT_SECRET defined');
    process.exit(1);
  }
}

const header = { alg: 'HS256', typ: 'JWT' };
const payload = { 
  sub: 'admin', 
  roles: ['admin'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 360000 
};

const secret = readJwtSecret();

const encodedHeader = base64url(JSON.stringify(header));
const encodedPayload = base64url(JSON.stringify(payload));

const signature = crypto
  .createHmac('sha256', secret)
  .update(`${encodedHeader}.${encodedPayload}`)
  .digest('base64')
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const token = `${encodedHeader}.${encodedPayload}.${signature}`;
console.log(token);