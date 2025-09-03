import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { nanoid } from "nanoid";

import { AppContext, Task, TaskRequest, TaskStatus } from "../types";
import { handleError, logError } from "../lib/errors";
import { generateId } from "../lib/utils";

export class CreateTask extends OpenAPIRoute {
  schema = {
    summary: "Create a new task",
    description: "Creates a new task with the provided URL",
    request: {
      body: contentJson(z.object({
        mimeType: z.string(),
        model: z.string(),
        video_quality: z.string(),
        video_url: z.string(),
        enable_upscale: z.boolean(),
      })),
    },
    responses: {
      "200": {
        description: "Successfully created task",
        content: {
          "application/json": {
            schema: z.object({
              taskId: z.string(),
              taskDetails: z.any(),
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
      const taskManagerId = c.env.TASK_MANAGER.idFromName(taskId);
      const taskManager = c.env.TASK_MANAGER.get(taskManagerId);

      const url = new URL(c.req.url);
      const callbackUrl = `${url.protocol}//${url.host}/api/task/${taskId}`;

      const newTask: Task = {
        id: taskId,
        status: TaskStatus.WAITING,
        request: data.body as TaskRequest,
        serverId: "",
        result: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        callbackUrl,
      };
      
      const taskDetails = await taskManager.createTask(newTask);
      return c.json({
        taskId,
        taskDetails
      });
    } catch (error) {
      logError('CreateTask', error);
      return handleError(error);
    }
  }
}

export class GetTask extends OpenAPIRoute {
  schema = {
    summary: "Retrieve task details",
    description: "Gets the current status and details of a task by ID",
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      "200": {
        description: "Successfully retrieved task details",
        content: {
          "application/json": {
            schema: z.object({
              taskId: z.string(),
              taskDetails: z.any(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const taskManagerId = c.env.TASK_MANAGER.idFromName(data.params.id);
      const taskManager = c.env.TASK_MANAGER.get(taskManagerId);
      const taskDetails = await taskManager.getTask();

      if (!taskDetails) {
        throw new Error(`Task ${data.params.id} not found`);
      }

      return c.json({
        taskId: data.params.id,
        taskDetails
      });
    } catch (error) {
      logError('GetTask', error);
      return handleError(error);
    }
  }
}

export class UpdateTask extends OpenAPIRoute {
  schema = {
    summary: "Update task details",
    description: "Updates an existing task with new information",
    request: {
      params: z.object({
        id: z.string(),
      }),
      body: contentJson(z.object({
        backend_task_id: z.string(),
        data: z.record(z.string(), z.any()),
        metadata: z.object({
          server_id: z.string(),
          processing_time: z.number().optional(),
          model_time: z.number().optional(),
          queue_time: z.number().optional(),
          progress: z.number().optional(),
          status: z.enum([TaskStatus.WAITING, TaskStatus.PROCESSING, TaskStatus.FINISHED, TaskStatus.FAILED]),
          message: z.string().optional().nullable(),
          custom_data: z.any().optional()
        })
      })),
    },
    responses: {
      "200": {
        description: "Successfully updated task",
        content: {
          "application/json": {
            schema: z.object({
              taskId: z.string(),
              taskDetails: z.any(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const taskManagerId = c.env.TASK_MANAGER.idFromName(data.params.id);
      const taskManager = c.env.TASK_MANAGER.get(taskManagerId);
      
      const taskUpdate = data.body;
      const updatedTaskDetails = await taskManager.updateTask({...taskUpdate, task_id: data.params.id});

      return c.json({
        taskId: data.params.id,
        taskDetails: updatedTaskDetails
      });
    } catch (error) {
      logError('UpdateTask', error);
      return handleError(error);
    }
  }
}
