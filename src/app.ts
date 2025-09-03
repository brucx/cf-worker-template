import { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt'
import { requestId } from 'hono/request-id'

import type { Bindings } from './types';

const app = new Hono({ strict: false });

app.use('/api/*', requestId())
app.use('/api/*', cors({ credentials: true, origin: '*', }));
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

export default app;
