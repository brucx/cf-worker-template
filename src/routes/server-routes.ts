import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AppContext } from "../types";
import { handleError, logError } from "../lib/errors";

// Schema for server configuration
const ServerConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  endpoints: z.object({
    predict: z.string().url(),
    health: z.string().url(),
    metrics: z.string().url().optional(),
  }),
  apiKey: z.string().optional(),
  maxConcurrent: z.number().min(1).max(100).default(10),
  capabilities: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
  priority: z.number().min(0).max(10).default(1),
});

export class RegisterServer extends OpenAPIRoute {
  schema = {
    tags: ['Servers'],
    summary: "Register a new server",
    description: "Registers a new backend server with the system",
    request: {
      body: contentJson(ServerConfigSchema),
    },
    responses: {
      "200": {
        description: "Successfully registered server",
        content: {
          "application/json": {
            schema: z.object({
              serverId: z.string(),
              message: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new ServerRegistryDO with RPC
      const registryId = c.env.SERVER_REGISTRY.idFromName("global");
      const registry = c.env.SERVER_REGISTRY.get(registryId);
      
      // Register server via RPC
      const serverId = await registry.registerServer(data.body);
      
      return c.json({
        serverId,
        message: "Server registered successfully"
      });
    } catch (error) {
      logError('RegisterServer', error);
      return handleError(error);
    }
  }
}

export class ListServers extends OpenAPIRoute {
  schema = {
    tags: ['Servers'],
    summary: "List registered servers",
    description: "Gets list of all registered servers with optional filtering",
    request: {
      query: z.object({
        status: z.enum(["online", "offline", "maintenance", "degraded"]).optional(),
        group: z.string().optional(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved server list",
        content: {
          "application/json": {
            schema: z.object({
              servers: z.array(z.object({
                id: z.string(),
                name: z.string(),
                status: z.string(),
                registeredAt: z.number(),
                lastHeartbeat: z.number(),
                uptime: z.number().describe("Server uptime in milliseconds"),
                timeSinceLastHeartbeat: z.number().describe("Time since last heartbeat in milliseconds"),
                groups: z.array(z.string()),
                priority: z.number(),
              })),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const query = c.req.query();
      
      // Use new ServerRegistryDO with RPC
      const registryId = c.env.SERVER_REGISTRY.idFromName("global");
      const registry = c.env.SERVER_REGISTRY.get(registryId);
      
      // Get servers via RPC with optional filter
      const servers = await registry.getAvailableServers(query);
      
      return c.json({ servers });
    } catch (error) {
      logError('ListServers', error);
      return handleError(error);
    }
  }
}

export class UpdateServerHeartbeat extends OpenAPIRoute {
  schema = {
    tags: ['Servers'],
    summary: "Update server heartbeat",
    description: "Updates the heartbeat timestamp for a server",
    request: {
      params: z.object({
        serverId: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully updated heartbeat",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new ServerRegistryDO with RPC
      const registryId = c.env.SERVER_REGISTRY.idFromName("global");
      const registry = c.env.SERVER_REGISTRY.get(registryId);
      
      // Update heartbeat via RPC
      await registry.updateHeartbeat(data.params.serverId);
      
      return c.json({
        success: true,
        message: "Heartbeat updated successfully"
      });
    } catch (error) {
      logError('UpdateServerHeartbeat', error);
      return handleError(error);
    }
  }
}

export class UnregisterServer extends OpenAPIRoute {
  schema = {
    tags: ['Servers'],
    summary: "Unregister server",
    description: "Removes a server from the registry",
    request: {
      params: z.object({
        serverId: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully unregistered server",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new ServerRegistryDO with RPC
      const registryId = c.env.SERVER_REGISTRY.idFromName("global");
      const registry = c.env.SERVER_REGISTRY.get(registryId);
      
      // Unregister server via RPC
      await registry.unregisterServer(data.params.serverId);
      
      return c.json({
        success: true,
        message: "Server unregistered successfully"
      });
    } catch (error) {
      logError('UnregisterServer', error);
      return handleError(error);
    }
  }
}

export class SetServerMaintenance extends OpenAPIRoute {
  schema = {
    tags: ['Servers'],
    summary: "Set server maintenance mode",
    description: "Enables or disables maintenance mode for a server",
    request: {
      params: z.object({
        serverId: z.string(),
      }),
      body: contentJson(z.object({
        enabled: z.boolean(),
      })),
    },
    responses: {
      "200": {
        description: "Successfully updated maintenance mode",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new ServerInstanceDO with RPC
      const instanceId = c.env.SERVER_INSTANCE.idFromName(data.params.serverId);
      const instance = c.env.SERVER_INSTANCE.get(instanceId);
      
      // Set maintenance mode via RPC
      await instance.setMaintenanceMode(data.body.enabled);
      
      return c.json({
        success: true,
        message: `Maintenance mode ${data.body.enabled ? 'enabled' : 'disabled'} for server ${data.params.serverId}`
      });
    } catch (error) {
      logError('SetServerMaintenance', error);
      return handleError(error);
    }
  }
}

export class GetServerMetrics extends OpenAPIRoute {
  schema = {
    tags: ['Servers'],
    summary: "Get server metrics",
    description: "Gets performance metrics for a specific server",
    request: {
      params: z.object({
        serverId: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved server metrics",
        content: {
          "application/json": {
            schema: z.object({
              tasksProcessed: z.number(),
              successCount: z.number(),
              failureCount: z.number(),
              successRate: z.number(),
              averageResponseTime: z.number(),
              healthScore: z.number(),
              activeTasks: z.number(),
              status: z.string(),
              healthy: z.boolean(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new ServerInstanceDO with RPC
      const instanceId = c.env.SERVER_INSTANCE.idFromName(data.params.serverId);
      const instance = c.env.SERVER_INSTANCE.get(instanceId);
      
      // Get metrics via RPC
      const metrics = await instance.getMetrics();
      
      return c.json(metrics);
    } catch (error) {
      logError('GetServerMetrics', error);
      return handleError(error);
    }
  }
}