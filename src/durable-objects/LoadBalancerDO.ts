import { DurableObject } from "cloudflare:workers";
import {
  ILoadBalancer,
  IServerRegistry,
  LoadBalanceAlgorithm,
  SelectionCriteria,
  ServerMetrics,
  ServerFilter,
  Env
} from "../types/index";

export class LoadBalancerDO extends DurableObject implements ILoadBalancer {
  private state: DurableObjectState;
  protected env: Env;
  private algorithm: LoadBalanceAlgorithm = "weighted-round-robin";
  private serverWeights: Map<string, number> = new Map();
  private serverLoads: Map<string, number> = new Map();
  private serverMetrics: Map<string, ServerMetrics> = new Map();
  private roundRobinIndex: number = 0;
  private healthyServers: Set<string> = new Set();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get([
        "algorithm", "weights", "metrics", "healthyServers"
      ]) as any;
      this.algorithm = stored?.algorithm || "weighted-round-robin";
      this.serverWeights = stored?.weights || new Map();
      this.serverMetrics = stored?.metrics || new Map();
      this.healthyServers = new Set(stored?.healthyServers || []);
      
      console.log(`[LoadBalancerDO] Initialized with algorithm: ${this.algorithm}, ${this.healthyServers.size} healthy servers`);
      
      // Schedule periodic server state sync
      await state.storage.setAlarm(Date.now() + 30000);
      console.log(`[LoadBalancerDO] Scheduled server state sync`);
    });
  }

  async selectServer(criteria: SelectionCriteria): Promise<string | null> {
    // Leverage single-threaded model, no locking needed
    
    console.log(`[LoadBalancerDO] Selecting server with criteria:`, JSON.stringify(criteria));
    console.log(`[LoadBalancerDO] Current healthy servers before refresh:`, Array.from(this.healthyServers));
    
    // Always refresh server list to ensure we have the latest state
    console.log(`[LoadBalancerDO] Refreshing server list...`);
    await this.refreshServerList();
    console.log(`[LoadBalancerDO] After refresh, healthy servers:`, Array.from(this.healthyServers));

    const availableServers = Array.from(this.healthyServers).filter(serverId => {
      const metrics = this.serverMetrics.get(serverId);
      console.log(`[LoadBalancerDO] Checking server ${serverId}, metrics:`, JSON.stringify(metrics));
      
      if (!metrics) {
        console.log(`[LoadBalancerDO] Server ${serverId} has no metrics, skipping`);
        return false;
      }
      
      // Check server capacity
      if (metrics.activeTasks >= metrics.maxCapacity) {
        console.log(`[LoadBalancerDO] Server ${serverId} at capacity: ${metrics.activeTasks}/${metrics.maxCapacity}`);
        return false;
      }
      
      // Check capability matching
      if (criteria.requiredCapabilities) {
        const hasCapabilities = criteria.requiredCapabilities.every((cap: string) => 
          metrics.capabilities?.includes(cap)
        );
        if (!hasCapabilities) {
          console.log(`[LoadBalancerDO] Server ${serverId} doesn't have required capabilities. Required: ${criteria.requiredCapabilities}, Has: ${metrics.capabilities}`);
          return false;
        }
      }
      
      console.log(`[LoadBalancerDO] Server ${serverId} is available`);
      return true;
    });

    console.log(`[LoadBalancerDO] Available servers after filtering:`, availableServers);

    if (availableServers.length === 0) {
      console.error(`[LoadBalancerDO] No available servers found`);
      return null;
    }

    // Select server based on algorithm
    let selected: string;
    switch (this.algorithm) {
      case "weighted-round-robin":
        selected = this.weightedRoundRobinSelect(availableServers);
        break;
      case "least-connections":
        selected = this.leastConnectionsSelect(availableServers);
        break;
      case "response-time":
        selected = this.responseTimeSelect(availableServers);
        break;
      default:
        selected = this.randomSelect(availableServers);
    }

    // Update load count (memory operation, high performance)
    const currentLoad = this.serverLoads.get(selected) || 0;
    this.serverLoads.set(selected, currentLoad + 1);
    console.log(`[LoadBalancerDO] Selected server ${selected} using ${this.algorithm} algorithm, new load: ${currentLoad + 1}`);

    // Async persist (non-blocking)
    this.state.waitUntil(
      this.state.storage.put("loads", this.serverLoads)
    );

    return selected;
  }

  async updateServerMetrics(serverId: string, metrics: ServerMetrics): Promise<void> {
    console.log(`[LoadBalancerDO] Updating metrics for server ${serverId}`);
    // Update memory cache
    this.serverMetrics.set(serverId, {
      ...this.serverMetrics.get(serverId),
      ...metrics,
      lastUpdate: Date.now()
    });

    // Dynamically adjust weight
    if (metrics.successRate !== undefined) {
      const weight = this.calculateWeight(metrics);
      this.serverWeights.set(serverId, weight);
    }

    // Update health status
    if (metrics.healthy) {
      this.healthyServers.add(serverId);
    } else {
      this.healthyServers.delete(serverId);
    }

    // Task completed, decrease load count
    if (metrics.taskCompleted) {
      const load = this.serverLoads.get(serverId) || 0;
      this.serverLoads.set(serverId, Math.max(0, load - 1));
    }
  }

  async markServerUnhealthy(serverId: string): Promise<void> {
    console.log(`[LoadBalancerDO] Marking server ${serverId} as unhealthy`);
    this.healthyServers.delete(serverId);
    this.serverWeights.set(serverId, 0);
    
    // Persist state
    await this.state.storage.put({
      healthyServers: Array.from(this.healthyServers),
      weights: this.serverWeights
    });
  }

  async rebalance(): Promise<void> {
    console.log(`[LoadBalancerDO] Rebalancing servers`);
    // Get latest server list from registry
    const registryId = this.env.SERVER_REGISTRY.idFromName("global");
    const registry = this.env.SERVER_REGISTRY.get(registryId) as unknown as IServerRegistry;
    
    const filter: ServerFilter = { status: "online" };
    const servers = await registry.getAvailableServers(filter);
    console.log(`[LoadBalancerDO] Got ${servers.length} servers from registry for rebalancing`);
    
    // Recalculate weights
    this.healthyServers.clear();
    for (const server of servers) {
      this.healthyServers.add(server.id);
      
      const metrics = this.serverMetrics.get(server.id);
      if (metrics) {
        const weight = this.calculateWeight(metrics);
        this.serverWeights.set(server.id, weight);
      } else {
        this.serverWeights.set(server.id, 1);
      }
    }
    
    await this.state.storage.put({
      healthyServers: Array.from(this.healthyServers),
      weights: this.serverWeights
    });
    console.log(`[LoadBalancerDO] Rebalance complete: ${this.healthyServers.size} healthy servers`);
  }

  async setAlgorithm(algorithm: LoadBalanceAlgorithm): Promise<void> {
    console.log(`[LoadBalancerDO] Setting algorithm from ${this.algorithm} to ${algorithm}`);
    this.algorithm = algorithm;
    await this.state.storage.put("algorithm", algorithm);
  }

  // Selection algorithm implementations
  private weightedRoundRobinSelect(servers: string[]): string {
    const weightedList: string[] = [];
    
    for (const serverId of servers) {
      const weight = this.serverWeights.get(serverId) || 1;
      for (let i = 0; i < weight; i++) {
        weightedList.push(serverId);
      }
    }
    
    if (weightedList.length === 0) return servers[0];
    
    this.roundRobinIndex = (this.roundRobinIndex + 1) % weightedList.length;
    return weightedList[this.roundRobinIndex];
  }

  private leastConnectionsSelect(servers: string[]): string {
    let minLoad = Infinity;
    let selected = servers[0];
    
    for (const serverId of servers) {
      const load = this.serverLoads.get(serverId) || 0;
      if (load < minLoad) {
        minLoad = load;
        selected = serverId;
      }
    }
    
    return selected;
  }

  private responseTimeSelect(servers: string[]): string {
    let minTime = Infinity;
    let selected = servers[0];
    
    for (const serverId of servers) {
      const metrics = this.serverMetrics.get(serverId);
      const responseTime = metrics?.averageResponseTime || Infinity;
      if (responseTime < minTime) {
        minTime = responseTime;
        selected = serverId;
      }
    }
    
    return selected;
  }

  private randomSelect(servers: string[]): string {
    return servers[Math.floor(Math.random() * servers.length)];
  }

  private calculateWeight(metrics: ServerMetrics): number {
    // Calculate weight based on success rate and response time
    const successWeight = (metrics.successRate || 0) * 10;
    const responseWeight = Math.max(0, 10 - (metrics.averageResponseTime || 10000) / 1000);
    return Math.round((successWeight + responseWeight) / 2);
  }

  // Alarm handler: periodic server state refresh
  async alarm(): Promise<void> {
    console.log(`[LoadBalancerDO] Alarm triggered for periodic server state refresh`);
    await this.refreshServerList();
    await this.state.storage.setAlarm(Date.now() + 30000);
    console.log(`[LoadBalancerDO] Next refresh scheduled in 30s`);
  }

  private async refreshServerList(): Promise<void> {
    console.log(`[LoadBalancerDO] Refreshing server list from registry`);
    const registryId = this.env.SERVER_REGISTRY.idFromName("global");
    const registry = this.env.SERVER_REGISTRY.get(registryId) as unknown as IServerRegistry;
    
    const filter: ServerFilter = { status: "online" };
    const servers = await registry.getAvailableServers(filter);
    
    console.log(`[LoadBalancerDO] Got ${servers.length} servers from registry`);
    
    // Update healthy servers list
    this.healthyServers.clear();
    for (const server of servers) {
      this.healthyServers.add(server.id);
      
      // Initialize metrics if not exists
      if (!this.serverMetrics.has(server.id)) {
        console.log(`[LoadBalancerDO] Initializing metrics for server ${server.id} with capabilities:`, server.config.capabilities);
        this.serverMetrics.set(server.id, {
          tasksProcessed: 0,
          successCount: 0,
          failureCount: 0,
          successRate: 100,
          averageResponseTime: 0,
          totalDuration: 0,
          healthScore: 100,
          activeTasks: 0,
          status: "online",
          healthy: true,
          capabilities: server.config.capabilities || [],
          maxCapacity: server.config.maxConcurrent || 10,
          lastUpdate: Date.now()
        });
      }
    }
    
    // Clean up non-existent server data
    for (const serverId of this.serverWeights.keys()) {
      if (!this.healthyServers.has(serverId)) {
        this.serverWeights.delete(serverId);
        this.serverLoads.delete(serverId);
        this.serverMetrics.delete(serverId);
      }
    }
  }
}