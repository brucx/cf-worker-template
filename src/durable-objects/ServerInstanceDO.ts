import { DurableObject } from "cloudflare:workers";
import {
  IServerInstance,
  ILoadBalancer,
  ServerConfig,
  ServerStatus,
  ServerMetrics,
  HealthStatus,
  TaskExecution,
  Env
} from "../types/index";

export class ServerInstanceDO extends DurableObject implements IServerInstance {
  private state: DurableObjectState;
  protected env: Env;
  private config: ServerConfig | null = null;
  private status: ServerStatus = "initializing";
  private healthScore: number = 100;
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private checkInterval: number = 10000; // Initial 10 seconds
  private readonly MIN_CHECK_INTERVAL = 5000; // Min 5 seconds
  private readonly MAX_CHECK_INTERVAL = 60000; // Max 60 seconds
  private readonly MAX_IDLE_TIME = 3600000; // 1 hour idle before cleanup
  private lastActivityTime: number = Date.now();
  private activeTasks: Set<string> = new Set();
  private metrics: ServerMetrics;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.metrics = this.initMetrics();
    
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get([
        "config", "status", "healthScore", "checkInterval", "lastActivityTime", "metrics", "initialized"
      ]) as any;
      
      if (stored?.config) {
        this.config = stored.config;
        // If we have a config and initialized timestamp, the server should be online
        // unless explicitly set to something else
        if (stored.initialized) {
          this.status = stored.status || "online";
        } else {
          this.status = stored.status || "initializing";
        }
        this.healthScore = stored.healthScore ?? 100;
        this.checkInterval = stored.checkInterval || 10000;
        this.lastActivityTime = stored.lastActivityTime || Date.now();
        
        if (stored.metrics) {
          this.metrics = { ...this.metrics, ...stored.metrics };
        }
        
        console.log(`[ServerInstance] Loaded server ${this.config?.id} with status: ${this.status}`);
        
        // Config loaded, schedule health check
        // If already initialized, start health checks
        await this.scheduleHealthCheck();
      }
    });
  }

  async initialize(config: ServerConfig): Promise<void> {
    this.config = config;
    this.status = "online";
    this.lastActivityTime = Date.now();
    
    // Initialize server with health checks
    
    await this.state.storage.put({
      config,
      status: this.status,
      initialized: Date.now(),
      lastActivityTime: this.lastActivityTime
    });
    
    // Start health checks
    await this.scheduleHealthCheck();
    
    // Register with load balancer
    await this.registerToLoadBalancer();

    console.log(`Server ${this.config?.id} initialized`);
  }

  async executeTask(task: TaskExecution): Promise<void> {
    // If we have a config but status is not online, fix it
    if (this.config && this.status === "initializing") {
      console.log(`[ServerInstance] Fixing status from initializing to online for server ${this.config.id}`);
      this.status = "online";
      await this.state.storage.put("status", this.status);
    }
    
    if (this.status !== "online") {
      throw new Error(`Server is ${this.status}, cannot execute tasks`);
    }
    
    if (this.activeTasks.size >= (this.config?.maxConcurrent || 10)) {
      throw new Error("Server at maximum capacity");
    }
    
    this.activeTasks.add(task.taskId);
    this.lastActivityTime = Date.now();
    const startTime = Date.now();
    
    try {
      // Send task to actual backend server
      const response = await fetch(this.config!.endpoints.predict, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config!.apiKey && { "Authorization": `Bearer ${this.config!.apiKey}` })
        },
        body: JSON.stringify({
          task_id: task.taskId,
          request: task.request,
          callback_url: task.callbackUrl
        }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }
      
      const duration = Date.now() - startTime;
      this.updateMetrics(true, duration);
      
      // If synchronous task, wait for result
      if (!task.request.async) {
        const result = await response.json();
        await this.sendTaskResult(task.taskId, result);
      }
      
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.updateMetrics(false, duration);
      throw error;
    } finally {
      this.activeTasks.delete(task.taskId);
      await this.state.storage.put("lastActivityTime", this.lastActivityTime);
    }
  }

  async performHealthCheck(): Promise<HealthStatus> {
    if (!this.config) {
      return { healthy: false, status: "not-initialized" };
    }
    
    try {
      const response = await fetch(this.config.endpoints.health, {
        method: "GET",
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        // Verify server ID matches
        const healthData = await response.json() as any;
        if (healthData.serverId !== this.config.id) {
          this.handleHealthFailure(`Server ID mismatch: expected ${this.config.id}, got ${healthData.serverId}`);
        } else {
          await this.handleHealthSuccess();
        }
      } else {
        this.handleHealthFailure(`HTTP ${response.status}`);
      }
      
    } catch (error: any) {
      this.handleHealthFailure(error.message);
    }
    
    // Update load balancer
    await this.updateLoadBalancer();
    
    return {
      healthy: this.status === "online",
      status: this.status,
      healthScore: this.healthScore,
      activeTasks: this.activeTasks.size
    };
  }

  async getMetrics(): Promise<ServerMetrics> {
    return {
      ...this.metrics,
      activeTasks: this.activeTasks.size,
      healthScore: this.healthScore,
      status: this.status,
      healthy: this.status === "online",
      capabilities: this.config?.capabilities || [],
      maxCapacity: this.config?.maxConcurrent || 10
    };
  }

  async setMaintenanceMode(enabled: boolean): Promise<void> {
    this.status = enabled ? "maintenance" : "online";
    this.lastActivityTime = Date.now();
    
    await this.state.storage.put({
      status: this.status,
      lastActivityTime: this.lastActivityTime
    });
    
    // Notify load balancer
    const loadBalancerId = this.env.LOAD_BALANCER.idFromName("global");
    const loadBalancer = this.env.LOAD_BALANCER.get(loadBalancerId) as unknown as ILoadBalancer;
    
    if (enabled) {
      await loadBalancer.markServerUnhealthy(this.state.id.toString());
    } else {
      await loadBalancer.updateServerMetrics(this.state.id.toString(), await this.getMetrics());
    }
  }

  async shutdown(): Promise<void> {
    this.status = "offline";
    
    // Wait for active tasks to complete (max 30 seconds)
    const timeout = Date.now() + 30000;
    while (this.activeTasks.size > 0 && Date.now() < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Unregister from load balancer
    const loadBalancerId = this.env.LOAD_BALANCER.idFromName("global");
    const loadBalancer = this.env.LOAD_BALANCER.get(loadBalancerId) as unknown as ILoadBalancer;
    await loadBalancer.markServerUnhealthy(this.state.id.toString());
    
    // Clear storage
    await this.state.storage.deleteAll();
  }

  // Alarm handler: health check or cleanup
  async alarm(): Promise<void> {
    // Make sure config is loaded
    if (!this.config) {
      const storedConfig = await this.state.storage.get("config") as ServerConfig | undefined;
      if (storedConfig) {
        this.config = storedConfig;
      } else {
        console.error("[Health Check] No config found in alarm handler");
        return;
      }
    }
    
    const now = Date.now();
    
    // Check for long idle time
    if (now - this.lastActivityTime > this.MAX_IDLE_TIME && this.activeTasks.size === 0) {
      console.log(`Server ${this.config.id} idle for too long, shutting down`);
      await this.shutdown();
      return;
    }
    
    // Perform health check
    await this.performHealthCheck();
    
    // Schedule next check
    await this.scheduleHealthCheck();
  }

  private async handleHealthSuccess(): Promise<void> {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    
    // Increase health score
    this.healthScore = Math.min(100, this.healthScore + 5);
    
    // Restore online status
    if (this.status === "degraded" && this.consecutiveSuccesses >= 3) {
      this.status = "online";
    }
    
    // Adaptive interval adjustment (longer when healthy)
    this.checkInterval = Math.min(
      this.MAX_CHECK_INTERVAL,
      this.checkInterval * 1.2
    );
    
    // Update heartbeat in ServerRegistry
    if (this.config?.id) {
      try {
        const registryId = this.env.SERVER_REGISTRY.idFromName("global");
        const registry = this.env.SERVER_REGISTRY.get(registryId);
        await registry.updateHeartbeat(this.config.id);
      } catch (error) {
        console.error(`Failed to update heartbeat for server ${this.config.id}:`, error);
      }
    }
  }

  private handleHealthFailure(error: string): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    
    // Decrease health score
    this.healthScore = Math.max(0, this.healthScore - 10);
    
    // Update status
    if (this.consecutiveFailures >= 3) {
      this.status = "offline";
    } else if (this.consecutiveFailures >= 1) {
      this.status = "degraded";
    }
    
    // Adaptive interval adjustment (shorter when failing)
    this.checkInterval = Math.max(
      this.MIN_CHECK_INTERVAL,
      this.checkInterval / 1.5
    );
    
    console.error(`Health check failed for server ${this.config?.id}: ${error}`);
  }

  private async scheduleHealthCheck(): Promise<void> {
    const nextCheckTime = Date.now() + this.checkInterval;
    await this.state.storage.setAlarm(nextCheckTime);
    console.log(`[ServerInstance] Scheduled health check for server ${this.config?.id}`);
  }

  private async registerToLoadBalancer(): Promise<void> {
    const loadBalancerId = this.env.LOAD_BALANCER.idFromName("global");
    const loadBalancer = this.env.LOAD_BALANCER.get(loadBalancerId) as unknown as ILoadBalancer;
    
    await loadBalancer.updateServerMetrics(
      this.state.id.toString(),
      await this.getMetrics()
    );
  }

  private async updateLoadBalancer(): Promise<void> {
    const loadBalancerId = this.env.LOAD_BALANCER.idFromName("global");
    const loadBalancer = this.env.LOAD_BALANCER.get(loadBalancerId) as unknown as ILoadBalancer;
    
    await loadBalancer.updateServerMetrics(
      this.state.id.toString(),
      await this.getMetrics()
    );
  }

  private async sendTaskResult(taskId: string, result: any): Promise<void> {
    console.log(`[ServerInstance] Sending result for task ${taskId}`);
    
    // Update task directly via TaskInstanceDO
    const taskInstanceId = this.env.TASK_INSTANCE.idFromName(taskId);
    const taskInstance = this.env.TASK_INSTANCE.get(taskInstanceId);
    
    await taskInstance.updateTask({
      status: "COMPLETED",
      result: result,
      progress: 100
    });
  }

  private updateMetrics(success: boolean, duration: number): void {
    this.metrics.tasksProcessed++;
    if (success) {
      this.metrics.successCount++;
    } else {
      this.metrics.failureCount++;
    }
    
    this.metrics.totalDuration += duration;
    this.metrics.successRate = this.metrics.successCount / this.metrics.tasksProcessed;
    this.metrics.averageResponseTime = this.metrics.totalDuration / this.metrics.tasksProcessed;
  }

  private initMetrics(): ServerMetrics {
    return {
      tasksProcessed: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageResponseTime: 0,
      totalDuration: 0,
      activeTasks: 0,
      healthScore: 100,
      status: "initializing",
      healthy: false,
      capabilities: [],
      maxCapacity: 10
    };
  }
}