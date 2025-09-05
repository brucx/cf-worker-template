import { fromHono, RouterOptions } from 'chanfana'

import app from './app';

// RPC-based routes
import { CreateTask, GetTask, UpdateTask, RetryTask, CancelTask } from './routes/task-routes';
import { RegisterServer, ListServers, UpdateServerHeartbeat, UnregisterServer, SetServerMaintenance, GetServerMetrics } from './routes/server-routes';
import { GetTaskStats, GetHourlyReport, GetServerStats, GetLoadBalancerStatus, SetLoadBalancerAlgorithm } from './routes/stats-routes';

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

// Task management
openapi.post('/api/task', CreateTask)
openapi.get('/api/task/:id', GetTask)
openapi.put('/api/task/:id', UpdateTask)
openapi.post('/api/task/:id/retry', RetryTask)
openapi.delete('/api/task/:id', CancelTask)

// Server management
openapi.post('/api/servers', RegisterServer)
openapi.get('/api/servers', ListServers)
openapi.post('/api/servers/:serverId/heartbeat', UpdateServerHeartbeat)
openapi.delete('/api/servers/:serverId', UnregisterServer)
openapi.put('/api/servers/:serverId/maintenance', SetServerMaintenance)
openapi.get('/api/servers/:serverId/metrics', GetServerMetrics)

// Statistics and monitoring
openapi.get('/api/stats', GetTaskStats)
openapi.get('/api/stats/hourly', GetHourlyReport)
openapi.get('/api/stats/server/:serverId', GetServerStats)
openapi.get('/api/loadbalancer/status', GetLoadBalancerStatus)
openapi.put('/api/loadbalancer/algorithm', SetLoadBalancerAlgorithm)

// Export RPC-based Durable Objects
export { TaskInstanceDO } from './durable-objects/TaskInstanceDO'
export { LoadBalancerDO } from './durable-objects/LoadBalancerDO'
export { ServerInstanceDO } from './durable-objects/ServerInstanceDO'
export { ServerRegistryDO } from './durable-objects/ServerRegistryDO'
export { TaskInstanceStatsDO } from './durable-objects/TaskInstanceStatsDO'

export default app
