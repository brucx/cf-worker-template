import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";

import { AppContext, SERVER_REGISTRY_DO_NAME } from "../types";

/**
 * CreateServer route handler for POST /api/servers endpoint
 * Registers a new service in the registry
 */
export class CreateServer extends OpenAPIRoute {
  schema = {
    request: {
      summary: "Register a new service",
      description: "Register a new service in the registry",
      body: contentJson(z.object({
        id: z.string(),
        endpoints: z.object({
          predict: z.string().url(),
          health: z.string().url().optional(),
        }),
        provider: z.string(),
        name: z.string(),
        async: z.boolean().optional(),
        callback: z.boolean().optional(),
      })),
    },
    responses: {
      "200": {
        description: "Successfully registered the service",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              success: z.boolean(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const serverRegistryId = c.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
    const serverRegistry = c.env.SERVER_REGISTRY.get(serverRegistryId);
    
    await serverRegistry.registerServer(data.body.id, {
      ...data.body,
      lastHeartbeat: new Date().toISOString(),
    });

    return c.json({
      id: data.body.id,
      success: true
    });
  }
}

/**
 * ListServers route handler for GET /api/servers endpoint
 * Returns a list of all registered services
 */
export class ListServers extends OpenAPIRoute {
  schema = {
    request: {
      summary: "List all registered services",
      description: "Get a list of all services in the registry",
      query: z.object({}),
    },
    responses: {
      "200": {
        description: "List of registered services",
        content: {
          "application/json": {
            schema: z.object({
              servers: z.array(z.object({
                id: z.string(),
                name: z.string(),
                provider: z.string(),
                endpoints: z.object({
                  predict: z.string().url(),
                  health: z.string().url().optional(),
                }),
                async: z.boolean().optional(),
                callback: z.boolean().optional(),
                lastHeartbeat: z.string().optional(),
              })),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const serverRegistryId = c.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
    const serverRegistry = c.env.SERVER_REGISTRY.get(serverRegistryId);
    
    const serversMap = await serverRegistry.getAllServers();
    const servers = Array.from(serversMap.values());
    
    return c.json({ servers });
  }
}

/**
 * UpdateServerHeartbeat route handler for POST /api/servers/:serverId/heartbeat endpoint
 * Updates the health status of a specific service
 */
export class UpdateServerHeartbeat extends OpenAPIRoute {
  schema = {
    request: {
      summary: "Update service health status",
      description: "Send a heartbeat to update service health status",
      params: z.object({
        serverId: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully updated service health status",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              success: z.boolean(),
              lastHeartbeat: z.string(),
            }),
          },
        },
      },
      "404": {
        description: "Service not found",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const serverRegistryId = c.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
    const serverRegistry = c.env.SERVER_REGISTRY.get(serverRegistryId);

    const server = await serverRegistry.getServer(data.params.serverId);
    
    if (!server) {
      return c.json({ error: "Service not found" }, 404);
    }

    const serverInstanceId = c.env.SERVER_INSTANCE.idFromName(data.params.serverId);
    const serverInstance = c.env.SERVER_INSTANCE.get(serverInstanceId);
    
    await serverInstance.getStatus();
    
    return c.json({
      id: data.params.serverId,
      success: true,
      lastHeartbeat: server?.lastHeartbeat
    });
  }
}

/**
 * GetServer route handler for GET /api/servers/:serverId endpoint
 * Returns details about a specific service
 */
export class GetServer extends OpenAPIRoute {
  schema = {
    request: {
      summary: "Get service details",
      description: "Get details about a specific registered service",
      params: z.object({
        serverId: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Service details",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              name: z.string(),
              provider: z.string(),
              endpoints: z.object({
                predict: z.string(),
                health: z.string().optional(),
              }),
              async: z.boolean().optional(),
              callback: z.boolean().optional(),
              lastHeartbeat: z.string().optional(),
              status: z.string().optional(),
            }),
          },
        },
      },
      "404": {
        description: "Service not found",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const serverRegistryId = c.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
    const serverRegistry = c.env.SERVER_REGISTRY.get(serverRegistryId);
    
    const server = await serverRegistry.getServer(data.params.serverId);
    
    if (!server) {
      return c.json({ error: "Service not found" }, 404);
    }

    const serverInstanceId = c.env.SERVER_INSTANCE.idFromName(data.params.serverId);
    const serverInstance = c.env.SERVER_INSTANCE.get(serverInstanceId);

    const serverStatus = await serverInstance.getStatus();
    
    return c.json({ ...server, status: serverStatus });
  }
}

/**
 * DeleteServer route handler for DELETE /api/servers/:serverId endpoint
 * Deregisters a service from the registry
 */
export class DeleteServer extends OpenAPIRoute {
  schema = {
    request: {
      summary: "Deregister a service",
      description: "Remove a service from the registry",
      params: z.object({
        serverId: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully deregistered the service",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              success: z.boolean(),
            }),
          },
        },
      },
      "404": {
        description: "Service not found",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const serverRegistryId = c.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
    const serverRegistry = c.env.SERVER_REGISTRY.get(serverRegistryId);
    
    // Check if the server exists first
    const server = await serverRegistry.getServer(data.params.serverId);
    
    if (!server) {
      return c.json({ error: "Service not found" }, 404);
    }
    
    await serverRegistry.removeServer(data.params.serverId);
    
    return c.json({
      id: data.params.serverId,
      success: true
    });
  }
}

/**
 * CleanupStaleServers route handler for POST /api/servers/cleanup endpoint
 * Removes servers that haven't sent a heartbeat in the specified time
 */
export class CleanupStaleServers extends OpenAPIRoute {
  schema = {
    request: {
      summary: "Clean up stale servers",
      description: "Remove servers that haven't sent a heartbeat in the specified time",
      body: contentJson(z.object({
        maxAgeMins: z.number().positive().optional(),
      }).optional()),
    },
    responses: {
      "200": {
        description: "Successfully cleaned up stale servers",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              removedServers: z.array(z.string()),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const serverRegistryId = c.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
    const serverRegistry = c.env.SERVER_REGISTRY.get(serverRegistryId);
    
    // Use the provided maxAgeMins or default to the function's default value
    const maxAgeMins = data.body?.maxAgeMins;
    const removedServers = await serverRegistry.cleanupStaleServers(maxAgeMins);
    
    return c.json({
      success: true,
      removedServers,
    });
  }
}
