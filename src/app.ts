import { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt'
import { requestId } from 'hono/request-id'

import type { Bindings } from './types';

const app = new Hono({ strict: false });

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'https://app.example.com',
  'https://admin.example.com'
];

app.use('/api/*', requestId())
app.use('/api/*', cors({ 
  credentials: true, 
  origin: (origin) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return '*';
    // Check if origin is in allowed list
    return allowedOrigins.includes(origin) ? origin : null;
  }
}));
app.use('/api/*', (c: Context<{ Bindings: Bindings }>, next) => {
const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET, alg: 'HS256' })
return jwtMiddleware(c, next)
})

// Add middleware to check for admin role for server-related endpoints
app.use('/api/servers', async (c: Context<{ Bindings: Bindings }>, next) => {
  const payload = c.get('jwtPayload');
  if (!payload || !payload.roles || !Array.isArray(payload.roles) || !payload.roles.includes('admin')) {
    return c.json({ error: 'Unauthorized: Admin role required' }, 403);
  }
  return next();
});

app.get('/', (c) => { return c.text('OK!') })
app.get('/health', (c) => { 
  return c.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    version: '2.0.0'
  }) 
})

export default app;
