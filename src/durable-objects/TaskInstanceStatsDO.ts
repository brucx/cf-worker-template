import { DurableObject } from "cloudflare:workers";
import {
  ITaskStats,
  TaskStartEvent,
  TaskCompleteEvent,
  TimeRange,
  Statistics,
  ServerStatistics,
  HourlyStatistics,
  HourlyReport,
  StatsEvent,
  Env
} from "../types/index";

export class TaskInstanceStatsDO extends DurableObject implements ITaskStats {
  private state: DurableObjectState;
  protected env: Env;
  private buffer: StatsEvent[] = [];
  private stats!: Statistics;
  private serverStats: Map<string, ServerStatistics> = new Map();
  private hourlyStats: Map<number, HourlyStatistics> = new Map();
  private readonly BUFFER_SIZE = 1000;
  private readonly FLUSH_INTERVAL = 10000; // 10 seconds
  
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get(["stats", "serverStats", "hourlyStats"]) as any;
      this.stats = stored.stats || this.initStats();
      this.serverStats = stored.serverStats || new Map();
      this.hourlyStats = stored.hourlyStats || new Map();
      
      console.log(`[TaskInstanceStatsDO] Initialized with ${this.stats.totalTasks} total tasks, ${this.serverStats.size} servers tracked`);
      
      // Schedule periodic buffer flush
      await state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
      console.log(`[TaskInstanceStatsDO] Scheduled buffer flush in ${this.FLUSH_INTERVAL}ms`);
    });
  }

  async recordTaskStart(event: TaskStartEvent): Promise<void> {
    console.log(`[TaskInstanceStatsDO] Recording task start: ${event.taskId}`);
    // Add to buffer
    this.buffer.push({
      type: "START",
      ...event,
      timestamp: Date.now()
    });
    
    // Real-time memory stats update (high performance)
    this.stats.totalTasks++;
    this.stats.pendingTasks++;
    
    // Update hourly stats
    this.updateHourlyStats("START", event);
    
    // Batch write when buffer is full
    if (this.buffer.length >= this.BUFFER_SIZE) {
      console.log(`[TaskInstanceStatsDO] Buffer full (${this.BUFFER_SIZE}), flushing`);
      await this.flush();
    }
  }

  async recordTaskComplete(event: TaskCompleteEvent): Promise<void> {
    console.log(`[TaskInstanceStatsDO] Recording task complete: ${event.taskId}, success=${event.success}, duration=${event.duration}ms`);
    this.buffer.push({
      type: "COMPLETE",
      ...event,
      timestamp: Date.now()
    });
    
    // Real-time stats update
    this.stats.pendingTasks = Math.max(0, this.stats.pendingTasks - 1);
    
    if (event.success) {
      this.stats.successfulTasks++;
      this.stats.totalSuccessDuration += event.duration;
    } else {
      this.stats.failedTasks++;
      if (event.retries > 0) {
        this.stats.retriedTasks++;
      }
    }
    
    // Update average processing time
    const completedTasks = this.stats.successfulTasks + this.stats.failedTasks;
    if (completedTasks > 0) {
      this.stats.averageProcessingTime = 
        (this.stats.totalSuccessDuration + event.duration) / completedTasks;
    }
    
    // Update server stats
    this.updateServerStats(event.serverId, event.success, event.duration);
    
    // Update hourly stats
    this.updateHourlyStats("COMPLETE", event);
    
    if (this.buffer.length >= this.BUFFER_SIZE) {
      console.log(`[TaskInstanceStatsDO] Buffer full (${this.BUFFER_SIZE}), flushing`);
      await this.flush();
    }
  }

  async getStats(timeRange?: TimeRange): Promise<Statistics> {
    // Ensure latest data is flushed
    await this.flush();
    
    if (!timeRange) {
      return {
        ...this.stats,
        serverCount: this.serverStats.size,
        topServers: this.getTopServers(5),
        hourlyTrend: this.getHourlyTrend()
      };
    }
    
    // Filter stats by time range
    return this.calculateStatsForRange(timeRange);
  }

  async getServerStats(serverId: string): Promise<ServerStatistics> {
    await this.flush();
    
    return this.serverStats.get(serverId) || {
      serverId,
      tasksProcessed: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageResponseTime: 0,
      totalDuration: 0,
      lastActiveTime: 0
    };
  }

  async getHourlyReport(): Promise<HourlyReport[]> {
    await this.flush();
    
    const reports: HourlyReport[] = [];
    
    for (let hour = 0; hour < 24; hour++) {
      const stats = this.hourlyStats.get(hour) || {
        hour,
        tasks: 0,
        successful: 0,
        failed: 0,
        totalDuration: 0,
        avgDuration: 0
      };
      
      reports.push({
        period: `${hour}:00-${hour}:59`,
        ...stats
      });
    }
    
    return reports;
  }

  // Alarm handler: periodic buffer flush
  async alarm(): Promise<void> {
    console.log(`[TaskInstanceStatsDO] Alarm triggered for periodic buffer flush`);
    await this.flush();
    
    // Clear old hourly stats at midnight
    const currentHour = new Date().getHours();
    if (currentHour === 0) {
      console.log(`[TaskInstanceStatsDO] Midnight reached, clearing hourly stats`);
      // New day, clear yesterday's hourly stats
      this.hourlyStats.clear();
    }
    
    await this.state.storage.setAlarm(Date.now() + this.FLUSH_INTERVAL);
    console.log(`[TaskInstanceStatsDO] Next flush scheduled in ${this.FLUSH_INTERVAL}ms`);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    
    const bufferSize = this.buffer.length;
    console.log(`[TaskInstanceStatsDO] Flushing ${bufferSize} events to storage`);
    
    // Batch save (reduces storage operations)
    const timestamp = Date.now();
    await this.state.storage.transaction(async (txn) => {
      await txn.put("stats", this.stats);
      await txn.put("serverStats", this.serverStats);
      await txn.put("hourlyStats", this.hourlyStats);
      await txn.put(`events-${timestamp}`, this.buffer);
    });
    
    // Clear buffer
    this.buffer = [];
    console.log(`[TaskInstanceStatsDO] Flush complete`);
  }

  private updateServerStats(
    serverId: string,
    success: boolean,
    duration: number
  ): void {
    const stats = this.serverStats.get(serverId) || this.initServerStats(serverId);
    
    stats.tasksProcessed++;
    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }
    
    stats.totalDuration += duration;
    stats.successRate = stats.successCount / stats.tasksProcessed;
    stats.averageResponseTime = stats.totalDuration / stats.tasksProcessed;
    stats.lastActiveTime = Date.now();
    
    this.serverStats.set(serverId, stats);
  }

  private updateHourlyStats(type: string, event: any): void {
    const hour = new Date().getHours();
    const stats = this.hourlyStats.get(hour) || this.initHourlyStats(hour);
    
    if (type === "START") {
      stats.tasks++;
    } else if (type === "COMPLETE") {
      if (event.success) {
        stats.successful++;
      } else {
        stats.failed++;
      }
      stats.totalDuration += event.duration;
      const completed = stats.successful + stats.failed;
      if (completed > 0) {
        stats.avgDuration = stats.totalDuration / completed;
      }
    }
    
    this.hourlyStats.set(hour, stats);
  }

  private getTopServers(limit: number): ServerStatistics[] {
    return Array.from(this.serverStats.values())
      .sort((a, b) => b.tasksProcessed - a.tasksProcessed)
      .slice(0, limit);
  }

  private getHourlyTrend(): Array<{ hour: number; tasks: number }> {
    return Array.from(this.hourlyStats.entries())
      .map(([hour, stats]) => ({ hour, tasks: stats.tasks }))
      .sort((a, b) => a.hour - b.hour);
  }

  private calculateStatsForRange(timeRange: TimeRange): Statistics {
    // This would filter stats based on timeRange
    // For now, returning all stats
    return {
      ...this.stats,
      serverCount: this.serverStats.size,
      topServers: this.getTopServers(5),
      hourlyTrend: this.getHourlyTrend()
    };
  }

  private initStats(): Statistics {
    return {
      totalTasks: 0,
      pendingTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      retriedTasks: 0,
      averageProcessingTime: 0,
      totalSuccessDuration: 0,
      serverCount: 0,
      topServers: [],
      hourlyTrend: []
    };
  }

  private initServerStats(serverId: string): ServerStatistics {
    return {
      serverId,
      tasksProcessed: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageResponseTime: 0,
      totalDuration: 0,
      lastActiveTime: Date.now()
    };
  }

  private initHourlyStats(hour: number): HourlyStatistics {
    return {
      hour,
      tasks: 0,
      successful: 0,
      failed: 0,
      totalDuration: 0,
      avgDuration: 0
    };
  }
}