import { DurableObject } from "cloudflare:workers";
import { ServerMetadata } from "../types";

/**
 * ServerRegistry is used to manage all registered server instances
 * Maintains a collection of server IDs and provides basic operations like registration, query, and deletion
 */
export class ServerRegistry extends DurableObject {
    /** Collection of all registered server IDs */
    private serverRegistry: Map<string, ServerMetadata> = new Map();
    /** Durable Object state object */
    private durableState: DurableObjectState;
    protected env: Cloudflare.Env;
  
    /**
     * Constructor
     * @param state Durable Object state object
     * @param env Environment variables
     */
    constructor(state: DurableObjectState, env: Cloudflare.Env) {
      super(state, env);
      this.durableState = state;
      this.env = env;
      state.blockConcurrencyWhile(async () => {
        try {
          const storedRegistry = await state.storage.get('serverRegistry') as string;
          if (storedRegistry) {
              this.serverRegistry = new Map(JSON.parse(storedRegistry));
          }
        } catch (error) {
          console.error("Failed to load server registry:", error);
          // Resetting to an empty map as a recovery strategy
          this.serverRegistry = new Map();
        }
      });
    }
    
    /**
     * Save the current server collection to persistent storage
     */
    private async persistRegistry(): Promise<void> {
      try {
        await this.durableState.storage.put('serverRegistry', JSON.stringify([...this.serverRegistry]));
      } catch (error) {
        console.error("Failed to persist server registry:", error);
        throw error;
      }
    }

    /**
     * Register a new server
     * @param serverId Server ID
     * @param metadata Server information including endpoint, provider and name
     */
    async registerServer(serverId: string, metadata: ServerMetadata): Promise<void> {
      try {
        // First initialize the server instance
        const serverInstanceId = this.env.SERVER_INSTANCE.idFromName(serverId);
        const serverInstance = this.env.SERVER_INSTANCE.get(serverInstanceId);
        
        // Make sure the metadata has a lastHeartbeat field
        metadata.lastHeartbeat = new Date().toISOString();
        
        // Initialize the server instance first
        await serverInstance.init(metadata);
        
        // Only add to registry after successful initialization
        this.serverRegistry.set(serverId, metadata);
        await this.persistRegistry();
      } catch (error) {
        console.error(`Failed to register server ${serverId}:`, error);
        throw error; // Propagate error to caller
      }
    }
  
    /**
     * Get all registered servers
     * @returns Map of server IDs to their information
     */
    async getAllServers(): Promise<Map<string, ServerMetadata>> {
      return this.serverRegistry;
    }

    /**
     * Check if a server with the specified ID is registered
     * @param serverId Server ID to check
     * @returns Server information if registered, undefined otherwise
     */
    async getServer(serverId: string): Promise<ServerMetadata | undefined> {
      return this.serverRegistry.get(serverId);
    }

    /**
     * Remove a server with the specified ID
     * @param serverId Server ID to remove
     */
    async removeServer(serverId: string): Promise<void> {
      try {
        this.serverRegistry.delete(serverId);
        await this.persistRegistry();
      } catch (error) {
        console.error(`Failed to remove server ${serverId}:`, error);
        throw error;
      }
    }

    /**
     * Update server health status via heartbeat
     * @param serverId Server ID to update
     * @returns Updated server metadata if server exists, undefined otherwise
     */
    async updateHeartbeat(serverId: string): Promise<ServerMetadata | undefined> {
      try {
        const server = this.serverRegistry.get(serverId);
        if (server) {
          server.lastHeartbeat = new Date().toISOString();
          this.serverRegistry.set(serverId, server);
          await this.persistRegistry();
          return server;
        }
        return undefined;
      } catch (error) {
        console.error(`Failed to update heartbeat for server ${serverId}:`, error);
        throw error;
      }
    }

    /**
     * Clean up servers that haven't sent a heartbeat in the specified time
     * @param maxAgeMins Maximum age in minutes before a server is considered stale (default: 5)
     * @returns Array of removed server IDs
     */
    async cleanupStaleServers(maxAgeMins: number = 5): Promise<string[]> {
      try {
        const now = new Date();
        const staleServers: string[] = [];
        
        for (const [serverId, metadata] of this.serverRegistry.entries()) {
          if (metadata.lastHeartbeat) {
            const lastHeartbeat = new Date(metadata.lastHeartbeat);
            const ageMins = (now.getTime() - lastHeartbeat.getTime()) / 60000;
            if (ageMins > maxAgeMins) {
              staleServers.push(serverId);
            }
          } else {
            // If no heartbeat record exists, consider it stale
            staleServers.push(serverId);
          }
        }
        
        // Remove all stale servers
        for (const serverId of staleServers) {
          await this.removeServer(serverId);
        }
        
        return staleServers;
      } catch (error) {
        console.error("Failed to clean up stale servers:", error);
        throw error;
      }
    }
  }