import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AppContext } from "../types";
import { handleError, logError } from "../lib/errors";
import { generateId } from "../lib/utils";

// Schema for new task creation matching the RPC architecture
const TaskRequestSchema = z.object({
  type: z.string().default('video-processing'),
  priority: z.number().default(0),
  payload: z.object({
    mimeType: z.string(),
    model: z.string(),
    video_quality: z.string(),
    video_url: z.string(),
    enable_upscale: z.boolean(),
  }),
  capabilities: z.array(z.string()).optional(),
  async: z.boolean().default(true)
});

export class CreateTask extends OpenAPIRoute {
  schema = {
    tags: ['Tasks'],
    summary: "Create a new task",
    description: "Creates a new task using RPC-based Durable Objects",
    request: {
      body: contentJson(TaskRequestSchema),
    },
    responses: {
      "200": {
        description: "Successfully created task",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              status: z.string(),
              createdAt: z.number(),
              updatedAt: z.number(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const taskId = generateId('task');
      
      // Use new TaskInstanceDO with RPC
      const taskInstanceId = c.env.TASK_INSTANCE.idFromName(taskId);
      const taskInstance = c.env.TASK_INSTANCE.get(taskInstanceId);
      
      // Create task via RPC
      const task = await taskInstance.createTask(data.body, taskId);
      
      // Record task start in statistics
      const statsId = c.env.TASK_STATS.idFromName(new Date().toISOString().slice(0, 10));
      const stats = c.env.TASK_STATS.get(statsId);
      await stats.recordTaskStart({ 
        taskId: task.id,
        serverId: task.serverId 
      });
      
      return c.json({
        id: task.id,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      });
    } catch (error) {
      logError('CreateTask', error);
      return handleError(error);
    }
  }
}

export class GetTask extends OpenAPIRoute {
  schema = {
    tags: ['Tasks'],
    summary: "Get task status",
    description: "Gets the current status of a task using RPC",
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved task status",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              status: z.string(),
              progress: z.number().optional(),
              result: z.any().optional(),
              error: z.string().optional(),
              createdAt: z.number(),
              updatedAt: z.number(),
              attempts: z.number(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new TaskInstanceDO with RPC
      const taskInstanceId = c.env.TASK_INSTANCE.idFromName(data.params.id);
      const taskInstance = c.env.TASK_INSTANCE.get(taskInstanceId);
      
      // Get status via RPC
      const status = await taskInstance.getStatus();
      
      return c.json(status);
    } catch (error) {
      logError('GetTask', error);
      return handleError(error);
    }
  }
}

export class UpdateTask extends OpenAPIRoute {
  schema = {
    tags: ['Tasks'],
    summary: "Update task",
    description: "Updates a task (typically called by backend callback)",
    request: {
      params: z.object({
        id: z.string(),
      }),
      body: contentJson(z.object({
        status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "TIMEOUT", "CANCELLED"]),
        result: z.any().optional(),
        progress: z.number().optional(),
        error: z.string().optional(),
      })),
    },
    responses: {
      "200": {
        description: "Successfully updated task",
        content: {
          "application/json": {
            schema: z.object({
              id: z.string(),
              status: z.string(),
              updatedAt: z.number(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      
      // Use new TaskInstanceDO with RPC
      const taskInstanceId = c.env.TASK_INSTANCE.idFromName(data.params.id);
      const taskInstance = c.env.TASK_INSTANCE.get(taskInstanceId);
      
      // Update task via RPC
      const task = await taskInstance.updateTask(data.body);
      
      return c.json({
        id: task.id,
        status: task.status,
        updatedAt: task.updatedAt
      });
    } catch (error) {
      logError('UpdateTask', error);
      return handleError(error);
    }
  }
}

export class RetryTask extends OpenAPIRoute {
  schema = {
    tags: ['Tasks'],
    summary: "Retry failed task",
    description: "Retries a failed or timed out task",
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully initiated retry",
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
      
      // Use new TaskInstanceDO with RPC
      const taskInstanceId = c.env.TASK_INSTANCE.idFromName(data.params.id);
      const taskInstance = c.env.TASK_INSTANCE.get(taskInstanceId);
      
      // Retry via RPC
      const success = await taskInstance.retry();
      
      return c.json({
        success,
        message: success ? "Task retry initiated" : "Task cannot be retried"
      });
    } catch (error) {
      logError('RetryTask', error);
      return handleError(error);
    }
  }
}

export class CancelTask extends OpenAPIRoute {
  schema = {
    tags: ['Tasks'],
    summary: "Cancel task",
    description: "Cancels a pending or processing task",
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully cancelled task",
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
      
      // Use new TaskInstanceDO with RPC
      const taskInstanceId = c.env.TASK_INSTANCE.idFromName(data.params.id);
      const taskInstance = c.env.TASK_INSTANCE.get(taskInstanceId);
      
      // Cancel via RPC
      await taskInstance.cancel();
      
      return c.json({
        success: true,
        message: "Task cancelled successfully"
      });
    } catch (error) {
      logError('CancelTask', error);
      return handleError(error);
    }
  }
}