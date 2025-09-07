import { DurableObject } from "cloudflare:workers";
import { 
  Task, 
  TaskRequest, 
  TaskUpdate, 
  TaskStatus,
  ITaskInstance,
  Env,
  TaskCompleteEvent,
  SelectionCriteria,
  TaskExecution
} from "../types/index";

export class TaskInstanceDO extends DurableObject implements ITaskInstance {
  private state: DurableObjectState;
  protected env: Env;
  private task: Task | null = null;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 3;
  private readonly TASK_TIMEOUT = 3600000; // 1 hour
  private readonly CLEANUP_DELAY = 300000; // 5 minutes after completion
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      this.task = await state.storage.get("task") || null;
      this.retryCount = await state.storage.get("retryCount") || 0;
      
      if (this.task) {
        console.log(`[TaskInstanceDO] Loaded task ${this.task.id} with status: ${this.task.status}`);
      }
      
      // If task is complete, schedule cleanup
      if (this.task && this.isTaskComplete(this.task.status)) {
        console.log(`[TaskInstanceDO] Task ${this.task.id} is complete, scheduling cleanup`);
        await this.scheduleCleanup();
      }
    });
  }

  async createTask(request: TaskRequest, taskId?: string): Promise<Task> {
    if (this.task) {
      console.log(`[TaskInstanceDO] Task ${this.task.id} already exists, returning existing task`);
      // Use global unique ID to prevent duplicates
      return this.task;
    }

    // Use provided taskId or extract from DO name
    const id = taskId || this.state.id.name || this.state.id.toString();
    console.log(`[TaskInstanceDO] Creating new task ${id} with type: ${request.type}, async: ${request.async}`);

    this.task = {
      id,
      status: "PENDING",
      request,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempts: []
    };

    // Transactional save for atomicity
    await this.state.storage.transaction(async (txn) => {
      await txn.put("task", this.task);
      await txn.put("retryCount", 0);
      await txn.put("createdAt", Date.now());
    });

    // Set timeout alarm
    await this.state.storage.setAlarm(Date.now() + this.TASK_TIMEOUT);

    // Assign server and start execution
    try {
      await this.assignAndExecute();
      
      // For synchronous tasks, wait for completion
      if (!request.async) {
        console.log(`[TaskInstanceDO] Waiting for synchronous task ${this.task.id} to complete`);
        const result = await this.waitForCompletion();
        return result;
      }
    } catch (error: any) {
      console.error(`[TaskInstanceDO] Task ${this.task.id} initial assignment failed:`, error);
      this.task.status = "FAILED";
      this.task.error = error.message;
      await this.state.storage.put("task", this.task);
    }

    return this.task;
  }

  async getStatus(): Promise<TaskStatus> {
    if (!this.task) {
      throw new Error("Task not found");
    }

    return {
      id: this.task.id,
      status: this.task.status,
      progress: this.task.progress || 0,
      serverId: this.task.serverId,
      result: this.task.result,
      error: this.task.error,
      createdAt: this.task.createdAt,
      updatedAt: this.task.updatedAt,
      attempts: this.task.attempts.length
    } as any;
  }

  async updateTask(update: TaskUpdate): Promise<Task> {
    if (!this.task) {
      throw new Error("Task not found");
    }

    console.log(`[TaskInstanceDO] Updating task ${this.task.id}: status ${this.task.status} -> ${update.status}`);
    
    // Only allow updates for processing tasks
    if (this.task.status !== "PROCESSING") {
      throw new Error(`Cannot update task in ${this.task.status} status`);
    }

    this.task = {
      ...this.task,
      status: update.status,
      result: update.result,
      progress: update.progress,
      error: update.error,
      updatedAt: Date.now()
    };

    await this.state.storage.put("task", this.task);

    // If task is complete, notify stats and schedule cleanup
    if (this.isTaskComplete(update.status)) {
      console.log(`[TaskInstanceDO] Task ${this.task.id} completed with status: ${update.status}`);
      await this.notifyCompletion();
      await this.scheduleCleanup();
    }

    return this.task;
  }

  async retry(): Promise<boolean> {
    if (!this.task || this.retryCount >= this.MAX_RETRIES) {
      if (this.task) {
        console.log(`[TaskInstanceDO] Task ${this.task.id} reached max retries (${this.MAX_RETRIES})`);
      }
      return false;
    }

    if (!this.isRetryableStatus(this.task.status)) {
      console.log(`[TaskInstanceDO] Task ${this.task.id} status ${this.task.status} is not retryable`);
      return false;
    }

    this.retryCount++;
    console.log(`[TaskInstanceDO] Retrying task ${this.task.id}, attempt ${this.retryCount}/${this.MAX_RETRIES}`);
    
    this.task.attempts.push({
      attemptNumber: this.retryCount,
      startedAt: Date.now(),
      previousStatus: this.task.status,
      previousError: this.task.error
    });

    this.task.status = "PENDING";
    this.task.error = undefined;
    this.task.updatedAt = Date.now();

    await this.state.storage.put("task", this.task);
    await this.state.storage.put("retryCount", this.retryCount);

    // Reassign and execute
    try {
      await this.assignAndExecute();
      return true;
    } catch (error: any) {
      console.error(`[TaskInstanceDO] Retry failed for task ${this.task.id}:`, error);
      return false;
    }
  }

  async cancel(): Promise<void> {
    if (!this.task) {
      throw new Error("Task not found");
    }

    if (this.isTaskComplete(this.task.status)) {
      throw new Error("Cannot cancel completed task");
    }
    
    console.log(`[TaskInstanceDO] Cancelling task ${this.task.id}`);

    this.task.status = "CANCELLED";
    this.task.updatedAt = Date.now();
    await this.state.storage.put("task", this.task);
    
    await this.notifyCompletion();
    await this.scheduleCleanup();
  }

  // Alarm handler: timeout or cleanup
  async alarm(): Promise<void> {
    const createdAt = await this.state.storage.get<number>("createdAt");
    const now = Date.now();
    
    if (this.task) {
      console.log(`[TaskInstanceDO] Alarm triggered for task ${this.task.id} (status: ${this.task.status})`);
    }

    // Check if this is a timeout alarm
    if (this.task && this.task.status === "PROCESSING") {
      if (createdAt && now - createdAt >= this.TASK_TIMEOUT) {
        console.log(`[TaskInstanceDO] Task ${this.task.id} timeout after ${Math.floor(this.TASK_TIMEOUT / 1000)}s`);
        
        this.task.status = "TIMEOUT";
        this.task.error = "Task execution timeout";
        this.task.updatedAt = now;
        await this.state.storage.put("task", this.task);

        // Try to retry
        const retried = await this.retry();
        if (!retried) {
          await this.notifyCompletion();
          await this.scheduleCleanup();
        }
        return;
      }
    }

    // Check if this is a cleanup alarm
    if (this.task && this.isTaskComplete(this.task.status)) {
      const completedAt = this.task.updatedAt;
      if (now - completedAt >= this.CLEANUP_DELAY) {
        console.log(`[TaskInstanceDO] Cleaning up completed task ${this.task.id}`);
        await this.cleanup();
      }
    }
  }

  // Private method: assign server and execute
  private async assignAndExecute(): Promise<void> {
    // Select server through LoadBalancer
    const loadBalancerId = this.env.LOAD_BALANCER.idFromName("global");
    const loadBalancer = this.env.LOAD_BALANCER.get(loadBalancerId);
    
    const criteria: SelectionCriteria = {
      taskType: this.task!.request.type,
      priority: this.task!.request.priority || 0,
      requiredCapabilities: this.task!.request.capabilities
    };
    
    console.log(`[TaskInstanceDO] Selecting server for task ${this.task!.id} with criteria:`, JSON.stringify(criteria));
    
    const serverId = await loadBalancer.selectServer(criteria);
    
    console.log(`[TaskInstanceDO] Selected server: ${serverId}`);

    if (!serverId) {
      console.error(`[TaskInstanceDO] No available servers for task ${this.task!.id}`);
      throw new Error("No available servers");
    }

    this.task!.serverId = serverId;
    this.task!.status = "PROCESSING";
    await this.state.storage.put("task", this.task);
    console.log(`[TaskInstanceDO] Task ${this.task!.id} assigned to server ${serverId} and marked as PROCESSING`);

    // Send task to server
    const serverInstanceId = this.env.SERVER_INSTANCE.idFromName(serverId);
    const serverInstance = this.env.SERVER_INSTANCE.get(serverInstanceId);
    
    const execution: TaskExecution = {
      taskId: this.task!.id,
      request: this.task!.request,
      callbackUrl: `${this.env.WORKER_URL}/api/task/${this.task!.id}`
    };
    
    await serverInstance.executeTask(execution);
  }

  // Private method: notify statistics service
  private async notifyCompletion(): Promise<void> {
    console.log(`[TaskInstanceDO] Notifying completion for task ${this.task?.id}`);
    const statsId = this.env.TASK_STATS.idFromName(
      new Date().toISOString().slice(0, 10)
    );
    const stats = this.env.TASK_STATS.get(statsId);
    
    const event: TaskCompleteEvent = {
      taskId: this.task!.id,
      serverId: this.task!.serverId!,
      success: this.task!.status === "COMPLETED",
      duration: Date.now() - this.task!.createdAt,
      retries: this.retryCount
    };
    
    await stats.recordTaskComplete(event);
  }

  // Private method: schedule cleanup alarm
  private async scheduleCleanup(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + this.CLEANUP_DELAY);
    console.log(`[TaskInstanceDO] Scheduled cleanup for task ${this.task?.id} in ${Math.floor(this.CLEANUP_DELAY / 1000)}s`);
  }

  // Private method: cleanup DO
  private async cleanup(): Promise<void> {
    console.log(`[TaskInstanceDO] Starting cleanup for task ${this.task?.id}`);
    // Clear all storage
    await this.state.storage.deleteAll();
    // DO will automatically be destroyed when idle
    console.log(`[TaskInstanceDO] Cleanup completed`);
  }

  private isTaskComplete(status: TaskStatus): boolean {
    return ["COMPLETED", "FAILED", "TIMEOUT", "CANCELLED"].includes(status);
  }

  private isRetryableStatus(status: TaskStatus): boolean {
    return ["FAILED", "TIMEOUT"].includes(status);
  }

  // Wait for synchronous task completion
  private async waitForCompletion(): Promise<Task> {
    const maxWaitTime = 30000; // 30 seconds max wait
    const checkInterval = 100; // Check every 100ms
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      // Reload task from storage to get latest status
      this.task = await this.state.storage.get("task") || this.task;
      
      if (this.isTaskComplete(this.task!.status)) {
        console.log(`[TaskInstanceDO] Synchronous task ${this.task!.id} completed with status: ${this.task!.status}`);
        return this.task!;
      }
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    // Timeout waiting for completion
    console.error(`[TaskInstanceDO] Synchronous task ${this.task!.id} timed out waiting for completion`);
    this.task!.status = "TIMEOUT";
    this.task!.error = "Synchronous task timeout";
    await this.state.storage.put("task", this.task);
    return this.task!;
  }
}