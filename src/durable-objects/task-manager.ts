import { DurableObject } from "cloudflare:workers";
import {
  SECONDS,
  SERVER_REGISTRY_DO_NAME,
  ServerMetadata,
  Task,
  TaskResult,
  TaskStatus,
} from "../types";

/**
 * TaskManager Durable Object responsible for managing task lifecycle and execution.
 * Handles a single task at a time and coordinates execution across multiple available servers.
 */
export class TaskManager extends DurableObject<Cloudflare.Env> {
  private task: Task | null = null;
  private state: DurableObjectState;
  private servers: Map<string, ServerMetadata> = new Map();
  protected env:Cloudflare.Env;

  constructor(state: DurableObjectState, env:Cloudflare.Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.task = (await state.storage.get("task")) || null;
    });
  }

  /**
   * Save task to SQL database with optimized queries
   * @param task Task to save
   */
  private async saveTaskToDatabase(task: Task): Promise<void> {
    try {
      // Convert request and result objects to JSON strings for storage
      const requestJson = JSON.stringify(task.request);
      const resultJson = task.result ? JSON.stringify(task.result) : null;

      // First check if task exists
      const existingTask = await this.env.TASK_DATABASE
        .prepare("SELECT id FROM Tasks WHERE id = ?")
        .bind(task.id)
        .first();

      if (existingTask) {
        // Update existing task - only update changed fields
        const statement = this.env.TASK_DATABASE.prepare(
          "UPDATE Tasks SET status = ?, result = ?, serverId = ?, updatedAt = ? WHERE id = ?"
        ).bind(
          task.status,
          resultJson,
          task.serverId || null,
          task.updatedAt,
          task.id
        );
        await statement.run();
      } else {
        // Insert new task
        const statement = this.env.TASK_DATABASE.prepare(
          "INSERT INTO Tasks (id, status, request, serverId, result, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          task.id,
          task.status,
          requestJson,
          task.serverId || null,
          resultJson,
          task.createdAt,
          task.updatedAt
        );
        await statement.run();
      }
      
      console.log(`Task ${task.id} saved to database`);
    } catch (error) {
      console.error(`Failed to save task ${task.id} to database:`, error);
      throw new Error(`Database operation failed: ${error}`);
    }
  }

  /**
   * Refreshes the internal list of available servers from the registry
   */
  private async updateServers(): Promise<void> {
    const serverRegistryId = this.env.SERVER_REGISTRY.idFromName(
      SERVER_REGISTRY_DO_NAME
    );
    const serverRegistryStub = this.env.SERVER_REGISTRY.get(serverRegistryId);
    const servers = await serverRegistryStub.getAllServers();
    this.servers = servers;
  }

  /**
   * Selects a random server from the available pool and removes it from consideration
   * Returns the selected server's ID and metadata, or undefined if no servers are available
   */
  private async pickRandomServer(): Promise<
    { id: string; metadata: ServerMetadata } | undefined
  > {
    const serverIds = Array.from(this.servers.keys());
    if (serverIds.length === 0) return undefined;

    const randomServerId =
      serverIds[Math.floor(Math.random() * serverIds.length)];
    const server = this.servers.get(randomServerId);
    if (!server) {
      throw new Error("Server not found");
    }
    this.servers.delete(randomServerId);
    return { id: randomServerId, metadata: server };
  }

  /**
   * Implements exponential backoff for retries
   */
  private async delay(attempt: number): Promise<void> {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Attempts to execute a task by trying available servers with retry logic and exponential backoff
   * Implements retry logic with a maximum attempt limit equal to the number of available servers
   */
  private async executeTask(task: Task): Promise<void> {
    await this.updateServers();

    const maxRetries = Math.min(this.servers.size * 2, 5); // Try each server up to 2 times, max 5 total
    let retryCount = 0;
    const errors: string[] = [];

    while (this.servers.size > 0 && retryCount < maxRetries) {
      const server = await this.pickRandomServer();
      if (!server) continue;

      retryCount++;
      
      try {
        // Create proper JSON payload for the mock server
        const payload = {
          task_id: task.id,
          request: task.request,
          async: server.metadata.async || false,
          callback_url: server.metadata.callback ? task.callbackUrl : undefined
        };

        const response = await fetch(server.metadata.endpoints.predict, {
          method: "POST",
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server responded with status ${response.status}, ${response.statusText}, ${errorText}`);
        }

        task.status = TaskStatus.PROCESSING;
        task.serverId = server.id;
        task.updatedAt = Date.now();
        this.task = task;
        await this.saveTaskToDatabase(this.task);
        await this.state.storage.put("task", task);
        return;
      } catch (error) {
        const errorMsg = `Task execution failed on server ${server.id}: ${error}`;
        console.error(errorMsg, server);
        errors.push(errorMsg);
        
        // If there are more servers to try, add a delay before retrying
        if (this.servers.size > 0 && retryCount < maxRetries) {
          await this.delay(retryCount);
        }
        continue;
      }
    }

    task.status = TaskStatus.FAILED;
    task.updatedAt = Date.now();
    task.error = errors.join('; ');
    this.task = task;
    await this.saveTaskToDatabase(this.task);
    await this.state.storage.put("task", this.task);
    throw new Error(
      `Task execution failed after ${retryCount} attempts: ${errors.join('; ')}`
    );
  }

  /**
   * Retrieves the currently managed task, if any
   */
  async getTask(): Promise<Task | null> {
    return this.task;
  }

  /**
   * Initializes and begins execution of a new task
   * Throws an error if another task is already in progress
   */
  async createTask(task: Task): Promise<Task> {
    if (this.task) {
      throw new Error("A task is already in progress");
    }

    this.state.storage.setAlarm(Date.now() + 60 * 60 * SECONDS);

    this.task = task;
    this.task.status = TaskStatus.WAITING;
    this.task.createdAt = Date.now();
    this.task.updatedAt = Date.now();
    await this.state.storage.put("task", this.task);

    try {
      await this.executeTask(this.task);
      return this.task;
    } catch (error) {
      console.error("Task execution failed:", error);
      this.task.status = TaskStatus.FAILED;
      this.task.updatedAt = Date.now();
      await this.state.storage.put("task", this.task);
      throw error;
    }
  }

  /**
   * Updates the properties of an existing task
   * Throws an error if no task currently exists
   */
  async updateTask(taskResult : TaskResult): Promise<Task | null> {
    if (!this.task) {
      throw new Error("No task exists to update");
    }
    this.task.status = taskResult.metadata.status;
    this.task.result = taskResult;
    this.task.updatedAt = Date.now();
    await this.state.storage.put("task", this.task);
    await this.saveTaskToDatabase(this.task);
    return this.task;
  }

  /**
   * Removes the current task and clears all associated storage
   * Returns the deleted task, if any
   */
  async deleteTask(): Promise<Task | null> {
    const oldTask = this.task;
    this.task = null;
    await this.state.storage.deleteAll();
    return oldTask;
  }

  /**
   * Handles the periodic alarm for the Durable Object
   * Deletes the current task and clears all associated storage
   */
  async alarm() {
    await this.deleteTask();
  }
}
