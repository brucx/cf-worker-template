import { DurableObject } from "cloudflare:workers";
import {
  IServerRegistry,
  IServerInstance,
  ILoadBalancer,
  ServerConfig,
  ServerInfo,
  ServerFilter,
  Env
} from "../types/index";

export class ServerRegistryDO extends DurableObject implements IServerRegistry {
  private state: DurableObjectState;
  protected env: Env;
  private servers: Map<string, ServerInfo> = new Map();
  private serverGroups: Map<string, Set<string>> = new Map();
  private readonly STALE_THRESHOLD: number;
  private readonly CLEANUP_INTERVAL: number;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    this.STALE_THRESHOLD = env.SERVER_STALE_THRESHOLD || 300000;
    this.CLEANUP_INTERVAL = env.SERVER_CLEANUP_INTERVAL || 60000;
    state.blockConcurrencyWhile(async () => {
      console.log(`[ServerRegistry] Initializing with STALE_THRESHOLD=${this.STALE_THRESHOLD}ms, CLEANUP_INTERVAL=${this.CLEANUP_INTERVAL}ms`);
      
      // Load from storage
      const storedServers = await state.storage.get("servers");
      const storedGroups = await state.storage.get("groups");
      
      if (storedServers instanceof Map) {
        this.servers = storedServers;
        console.log(`[ServerRegistry] Loaded ${this.servers.size} servers from storage`);
      }
      if (storedGroups instanceof Map) {
        this.serverGroups = storedGroups;
        console.log(`[ServerRegistry] Loaded ${this.serverGroups.size} server groups from storage`);
      }
      
      // Schedule periodic cleanup of stale servers
      await state.storage.setAlarm(Date.now() + this.CLEANUP_INTERVAL);
      console.log(`[ServerRegistry] Scheduled cleanup of stale servers`);
    });
  }

  private async saveState(): Promise<void> {
    await this.state.storage.put({
      "servers": this.servers,
      "groups": this.serverGroups
    });
  }

  async registerServer(config: ServerConfig): Promise<string> {
    const serverId = config.id || crypto.randomUUID();
    console.log(`[ServerRegistry] Registering server: ${serverId} (${config.name})`);
    
    // Create ServerInstanceDO
    const instanceId = this.env.SERVER_INSTANCE.idFromName(serverId);
    const instance = this.env.SERVER_INSTANCE.get(instanceId);
    
    // Initialize server instance
    await instance.initialize(config);
    
    // Registration info
    const serverInfo: ServerInfo = {
      id: serverId,
      name: config.name,
      instanceId: instanceId.toString(),
      config,
      status: "online",
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
      groups: config.groups || [],
      priority: config.priority || 1
    };
    
    this.servers.set(serverId, serverInfo);
    
    // Update groups
    for (const group of serverInfo.groups) {
      if (!this.serverGroups.has(group)) {
        this.serverGroups.set(group, new Set());
      }
      this.serverGroups.get(group)!.add(serverId);
    }
    console.log(`[ServerRegistry] Server ${serverId} added to groups: ${serverInfo.groups.join(', ')}`);
    
    await this.saveState();
    
    // Trigger load balancer rebalance
    await this.notifyLoadBalancer();
    console.log(`[ServerRegistry] Successfully registered server ${serverId}`);
    
    return serverId;
  }

  async unregisterServer(serverId: string): Promise<void> {
    const serverInfo = this.servers.get(serverId);
    if (!serverInfo) {
      console.log(`[ServerRegistry] Server ${serverId} not found, skipping unregister`);
      return; // Idempotent operation
    }
    
    console.log(`[ServerRegistry] Unregistering server: ${serverId}`);
    
    // Shutdown server instance
    try {
      const instanceId = this.env.SERVER_INSTANCE.idFromName(serverId);
      const instance = this.env.SERVER_INSTANCE.get(instanceId) as unknown as IServerInstance;
      await instance.shutdown();
      console.log(`[ServerRegistry] Shutdown server ${serverId}`);
    } catch (error) {
      console.error(`[ServerRegistry] Failed to shutdown server ${serverId}:`, error);
    }
    
    // Remove from groups
    for (const group of serverInfo.groups) {
      this.serverGroups.get(group)?.delete(serverId);
      if (this.serverGroups.get(group)?.size === 0) {
        this.serverGroups.delete(group);
      }
    }
    
    // Delete registration info
    this.servers.delete(serverId);
    console.log(`[ServerRegistry] Server ${serverId} unregistered successfully`);
    
    await this.saveState();
    await this.notifyLoadBalancer();
  }

  async getAvailableServers(filter?: ServerFilter): Promise<ServerInfo[]> {
    let servers = Array.from(this.servers.values());
    const now = Date.now();
    
    // Update server status based on heartbeat
    for (const server of servers) {
      const timeSinceHeartbeat = now - server.lastHeartbeat;
      if (timeSinceHeartbeat > this.STALE_THRESHOLD && server.status === "online") {
        // Mark server as offline if no heartbeat for too long
        server.status = "offline";
        this.servers.set(server.id, server);
      }
    }
    
    // Save updated statuses
    if (servers.some(s => s.status === "offline")) {
      this.state.waitUntil(this.saveState());
    }
    
    if (filter) {
      // Status filter
      if (filter.status) {
        servers = servers.filter(s => s.status === filter.status);
      }
      
      // Group filter
      if (filter.group) {
        const groupServers = this.serverGroups.get(filter.group);
        if (groupServers) {
          servers = servers.filter(s => groupServers.has(s.id));
        } else {
          return [];
        }
      }
      
      // Heartbeat age filter
      if (filter.maxAge) {
        const threshold = Date.now() - filter.maxAge;
        servers = servers.filter(s => s.lastHeartbeat > threshold);
      }
    }
    
    // Add calculated time fields and determine actual status
    return servers.map(server => {
      const timeSinceHeartbeat = now - server.lastHeartbeat;
      const effectiveStatus = timeSinceHeartbeat > this.STALE_THRESHOLD ? "offline" : server.status;
      
      return {
        ...server,
        status: effectiveStatus,
        uptime: now - server.registeredAt,
        timeSinceLastHeartbeat: timeSinceHeartbeat
      };
    });
  }

  async updateHeartbeat(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not registered`);
    }
    
    const wasOffline = server.status === "offline";
    server.lastHeartbeat = Date.now();
    if (wasOffline) {
      server.status = "online";
      console.log(`[ServerRegistry] Server ${serverId} back online after heartbeat`);
      await this.notifyLoadBalancer();
    }
    
    // Use waitUntil to avoid blocking
    this.state.waitUntil(
      this.state.storage.put("servers", this.servers)
    );
  }

  async cleanupStaleServers(): Promise<string[]> {
    const now = Date.now();
    const removed: string[] = [];
    console.log(`[ServerRegistry] Running cleanup check for ${this.servers.size} servers`);
    
    for (const [serverId, server] of this.servers) {
      if (now - server.lastHeartbeat > this.STALE_THRESHOLD) {
        console.log(`[ServerRegistry] Removing stale server ${serverId} (last heartbeat: ${Math.floor((now - server.lastHeartbeat) / 1000)}s ago)`);
        await this.unregisterServer(serverId);
        removed.push(serverId);
      }
    }
    
    if (removed.length > 0) {
      console.log(`[ServerRegistry] Cleaned up ${removed.length} stale servers`);
      await this.notifyLoadBalancer();
    }
    
    return removed;
  }

  // Alarm handler: periodic cleanup
  async alarm(): Promise<void> {
    console.log(`[ServerRegistry] Alarm triggered for periodic cleanup`);
    const removed = await this.cleanupStaleServers();
    if (removed.length === 0) {
      console.log(`[ServerRegistry] No stale servers found`);
    }
    
    await this.state.storage.setAlarm(Date.now() + this.CLEANUP_INTERVAL);
    console.log(`[ServerRegistry] Next cleanup scheduled in ${this.CLEANUP_INTERVAL}ms`);
  }

  private async notifyLoadBalancer(): Promise<void> {
    try {
      const loadBalancerId = this.env.LOAD_BALANCER.idFromName("global");
      const loadBalancer = this.env.LOAD_BALANCER.get(loadBalancerId) as unknown as ILoadBalancer;
      await loadBalancer.rebalance();
    } catch (error) {
      console.error("Failed to notify load balancer:", error);
    }
  }
}