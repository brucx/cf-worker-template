import { fromHono, RouterOptions } from 'chanfana'

import app from './app';
import { CreateTask, GetTask, UpdateTask } from './routes/task-routes';
import { CreateServer, ListServers, UpdateServerHeartbeat, GetServer, DeleteServer, CleanupStaleServers } from './routes/server-routes';

const ChanfanaOptions = {
	docs_url: '/docs',
	schema: {
		info: {
			title: 'Worker API',
			version: '1.0',
		},
		security: [
			{
				BearerAuth: [],
			},
		],
	},
} satisfies RouterOptions;

const openapi = fromHono(app, ChanfanaOptions)
openapi.registry.registerComponent('securitySchemes', 'BearerAuth', {
	type: 'http',
	scheme: 'bearer',
	bearerFormat: 'JWT',
});

openapi.post('/api/task', CreateTask)
openapi.get('/api/task/:id', GetTask)
openapi.put('/api/task/:id', UpdateTask)

// New server registry API endpoints
openapi.post('/api/servers', CreateServer)
openapi.get('/api/servers', ListServers)
openapi.post('/api/servers/:serverId/heartbeat', UpdateServerHeartbeat)
openapi.get('/api/servers/:serverId', GetServer)
openapi.delete('/api/servers/:serverId', DeleteServer)
openapi.post('/api/servers/cleanup', CleanupStaleServers)

export { TaskManager } from './durable-objects/task-manager'
export { ServerInstance } from './durable-objects/server-instance'
export { ServerRegistry } from './durable-objects/server-registry'

export default app
