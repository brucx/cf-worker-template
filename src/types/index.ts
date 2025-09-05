export type Env = Cloudflare.Env

// Task-related types
export interface Task {
  id: string;
  status: TaskStatus;
  request: TaskRequest;
  result?: any;
  serverId?: string;
  progress?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  attempts: TaskAttempt[];
}

export type TaskStatus = 
  | "PENDING" 
  | "PROCESSING" 
  | "COMPLETED" 
  | "FAILED" 
  | "TIMEOUT" 
  | "CANCELLED";

export interface TaskRequest {
  type: string;
  priority?: number;
  payload: any;
  capabilities?: string[];
  async?: boolean;
}

export interface TaskAttempt {
  attemptNumber: number;
  startedAt: number;
  previousStatus?: string;
  previousError?: string;
}

export interface TaskUpdate {
  status: TaskStatus;
  result?: any;
  progress?: number;
  error?: string;
}

export interface TaskExecution {
  taskId: string;
  request: TaskRequest;
  callbackUrl: string;
}

export interface TaskStartEvent {
  taskId: string;
  serverId?: string;
}

export interface TaskCompleteEvent {
  taskId: string;
  serverId: string;
  success: boolean;
  duration: number;
  retries: number;
}

// Server-related types
export interface ServerConfig {
  id?: string;
  name: string;
  endpoints: {
    predict: string;
    health: string;
    metrics?: string;
  };
  apiKey?: string;
  maxConcurrent: number;
  capabilities?: string[];
  groups?: string[];
  priority?: number;
}

export interface ServerInfo {
  id: string;
  name: string;
  instanceId: string;
  config: ServerConfig;
  status: ServerStatus;
  registeredAt: number;
  lastHeartbeat: number;
  groups: string[];
  priority: number;
}

export type ServerStatus = 
  | "initializing"
  | "online" 
  | "offline" 
  | "maintenance" 
  | "degraded";

export interface ServerMetrics {
  tasksProcessed: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageResponseTime: number;
  totalDuration: number;
  healthScore: number;
  activeTasks: number;
  status: string;
  healthy: boolean;
  capabilities?: string[];
  maxCapacity: number;
  taskCompleted?: boolean;
  lastUpdate?: number;
}

export interface HealthStatus {
  healthy: boolean;
  status: string;
  healthScore?: number;
  activeTasks?: number;
}

export interface ServerFilter {
  status?: ServerStatus;
  group?: string;
  maxAge?: number;
}

// Load balancer types
export type LoadBalanceAlgorithm = 
  | "round-robin"
  | "weighted-round-robin"
  | "least-connections"
  | "response-time"
  | "random";

export interface SelectionCriteria {
  taskType?: string;
  priority?: number;
  requiredCapabilities?: string[];
}

// Statistics types
export interface Statistics {
  totalTasks: number;
  pendingTasks: number;
  successfulTasks: number;
  failedTasks: number;
  retriedTasks: number;
  averageProcessingTime: number;
  totalSuccessDuration: number;
  serverCount?: number;
  topServers?: ServerStatistics[];
  hourlyTrend?: Array<{ hour: number; tasks: number }>;
}

export interface ServerStatistics {
  serverId: string;
  tasksProcessed: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageResponseTime: number;
  totalDuration: number;
  lastActiveTime: number;
}

export interface HourlyStatistics {
  hour: number;
  tasks: number;
  successful: number;
  failed: number;
  totalDuration: number;
  avgDuration: number;
}

export interface HourlyReport extends HourlyStatistics {
  period: string;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface StatsEvent {
  type: "START" | "COMPLETE";
  timestamp: number;
  [key: string]: any;
}

// RPC interface definitions
export interface ITaskInstance {
  createTask(request: TaskRequest): Promise<Task>;
  getStatus(): Promise<TaskStatus>;
  updateTask(update: TaskUpdate): Promise<Task>;
  retry(): Promise<boolean>;
  cancel(): Promise<void>;
}

export interface ILoadBalancer {
  selectServer(criteria: SelectionCriteria): Promise<string | null>;
  updateServerMetrics(serverId: string, metrics: ServerMetrics): Promise<void>;
  markServerUnhealthy(serverId: string): Promise<void>;
  rebalance(): Promise<void>;
  setAlgorithm(algorithm: LoadBalanceAlgorithm): Promise<void>;
}

export interface IServerInstance {
  initialize(config: ServerConfig): Promise<void>;
  executeTask(task: TaskExecution): Promise<void>;
  performHealthCheck(): Promise<HealthStatus>;
  getMetrics(): Promise<ServerMetrics>;
  setMaintenanceMode(enabled: boolean): Promise<void>;
  shutdown(): Promise<void>;
}

export interface IServerRegistry {
  registerServer(config: ServerConfig): Promise<string>;
  unregisterServer(serverId: string): Promise<void>;
  getAvailableServers(filter?: ServerFilter): Promise<ServerInfo[]>;
  updateHeartbeat(serverId: string): Promise<void>;
  cleanupStaleServers(): Promise<string[]>;
}

export interface ITaskStats {
  recordTaskStart(event: TaskStartEvent): Promise<void>;
  recordTaskComplete(event: TaskCompleteEvent): Promise<void>;
  getStats(timeRange?: TimeRange): Promise<Statistics>;
  getServerStats(serverId: string): Promise<ServerStatistics>;
  getHourlyReport(): Promise<HourlyReport[]>;
}

// Re-export cloudflare types  
export type { DurableObjectState, DurableObjectNamespace, D1Database } from '@cloudflare/workers-types';
