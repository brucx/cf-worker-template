import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AppContext } from "../types";
import { handleError, logError } from "../lib/errors";

export class GetTaskStats extends OpenAPIRoute {
  schema = {
    tags: ['Statistics'],
    summary: "Get task statistics",
    description: "Gets aggregated task processing statistics",
    request: {
      query: z.object({
        date: z.string().optional().describe("Date in YYYY-MM-DD format, defaults to today"),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved statistics",
        content: {
          "application/json": {
            schema: z.object({
              totalTasks: z.number(),
              pendingTasks: z.number(),
              successfulTasks: z.number(),
              failedTasks: z.number(),
              retriedTasks: z.number(),
              averageProcessingTime: z.number(),
              serverCount: z.number().optional(),
              topServers: z.array(z.object({
                serverId: z.string(),
                tasksProcessed: z.number(),
                successRate: z.number(),
              })).optional(),
              hourlyTrend: z.array(z.object({
                hour: z.number(),
                tasks: z.number(),
              })).optional(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const query = c.req.query();
      const date = query.date || new Date().toISOString().slice(0, 10);
      
      // Use TaskInstanceStatsDO with RPC
      const statsId = c.env.TASK_STATS.idFromName(date);
      const stats = c.env.TASK_STATS.get(statsId);
      
      // Get statistics via RPC
      const statistics = await stats.getStats();
      
      return c.json(statistics);
    } catch (error) {
      logError('GetTaskStats', error);
      return handleError(error);
    }
  }
}

export class GetHourlyReport extends OpenAPIRoute {
  schema = {
    tags: ['Statistics'],
    summary: "Get hourly task report",
    description: "Gets task statistics broken down by hour",
    request: {
      query: z.object({
        date: z.string().optional().describe("Date in YYYY-MM-DD format, defaults to today"),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved hourly report",
        content: {
          "application/json": {
            schema: z.array(z.object({
              hour: z.number(),
              period: z.string(),
              tasks: z.number(),
              successful: z.number(),
              failed: z.number(),
              avgDuration: z.number(),
            })),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const query = c.req.query();
      const date = query.date || new Date().toISOString().slice(0, 10);
      
      // Use TaskInstanceStatsDO with RPC
      const statsId = c.env.TASK_STATS.idFromName(date);
      const stats = c.env.TASK_STATS.get(statsId);
      
      // Get hourly report via RPC
      const report = await stats.getHourlyReport();
      
      return c.json(report);
    } catch (error) {
      logError('GetHourlyReport', error);
      return handleError(error);
    }
  }
}

export class GetServerStats extends OpenAPIRoute {
  schema = {
    tags: ['Statistics'],
    summary: "Get server statistics",
    description: "Gets statistics for a specific server",
    request: {
      params: z.object({
        serverId: z.string(),
      }),
      query: z.object({
        date: z.string().optional().describe("Date in YYYY-MM-DD format, defaults to today"),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved server statistics",
        content: {
          "application/json": {
            schema: z.object({
              serverId: z.string(),
              tasksProcessed: z.number(),
              successCount: z.number(),
              failureCount: z.number(),
              successRate: z.number(),
              averageResponseTime: z.number(),
              lastActiveTime: z.number(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const query = c.req.query();
      const date = query.date || new Date().toISOString().slice(0, 10);
      
      // Use TaskInstanceStatsDO with RPC
      const statsId = c.env.TASK_STATS.idFromName(date);
      const stats = c.env.TASK_STATS.get(statsId);
      
      // Get server statistics via RPC
      const serverStats = await stats.getServerStats(data.params.serverId);
      
      return c.json(serverStats);
    } catch (error) {
      logError('GetServerStats', error);
      return handleError(error);
    }
  }
}

export class GetLoadBalancerStatus extends OpenAPIRoute {
  schema = {
    tags: ['Load Balancer'],
    summary: "Get load balancer status",
    description: "Gets current load distribution and algorithm",
    responses: {
      "200": {
        description: "Successfully retrieved load balancer status",
        content: {
          "application/json": {
            schema: z.object({
              algorithm: z.string(),
              healthyServers: z.number(),
              serverLoads: z.record(z.string(), z.number()),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      // Use LoadBalancerDO with RPC
      const loadBalancerId = c.env.LOAD_BALANCER.idFromName("global");
      const loadBalancer = c.env.LOAD_BALANCER.get(loadBalancerId);
      
      // For now, trigger a rebalance to get fresh data
      await loadBalancer.rebalance();
      
      // Return basic status
      return c.json({
        algorithm: "weighted-round-robin",
        healthyServers: 0, // This would need to be tracked in the DO
        serverLoads: {}    // This would need to be exposed via RPC
      });
    } catch (error) {
      logError('GetLoadBalancerStatus', error);
      return handleError(error);
    }
  }
}

export class SetLoadBalancerAlgorithm extends OpenAPIRoute {
  schema = {
    tags: ['Load Balancer'],
    summary: "Set load balancer algorithm",
    description: "Changes the load balancing algorithm",
    request: {
      body: contentJson(z.object({
        algorithm: z.enum(["round-robin", "weighted-round-robin", "least-connections", "response-time", "random"]),
      })),
    },
    responses: {
      "200": {
        description: "Successfully updated algorithm",
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
      
      // Use LoadBalancerDO with RPC
      const loadBalancerId = c.env.LOAD_BALANCER.idFromName("global");
      const loadBalancer = c.env.LOAD_BALANCER.get(loadBalancerId);
      
      // Set algorithm via RPC
      await loadBalancer.setAlgorithm(data.body.algorithm);
      
      return c.json({
        success: true,
        message: `Load balancer algorithm set to ${data.body.algorithm}`
      });
    } catch (error) {
      logError('SetLoadBalancerAlgorithm', error);
      return handleError(error);
    }
  }
}