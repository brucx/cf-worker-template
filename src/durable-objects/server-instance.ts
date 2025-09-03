import { DurableObject } from "cloudflare:workers";
import { SECONDS, SERVER_REGISTRY_DO_NAME, ServerMetadata } from "../types";

/** Time constants */
const HEALTH_CHECK_TIMEOUT = 5 * SECONDS; // 5 seconds
const MIN_HEALTH_CHECK_INTERVAL = 10 * SECONDS; // Minimum interval for healthy servers
const MAX_HEALTH_CHECK_INTERVAL = 60 * SECONDS; // Maximum interval for stable servers
const MAX_OFFLINE_DURATION = 3 * 60 * SECONDS; // 3 minutes
const MAX_HEALTH_CHECK_RETRIES = 3; // Maximum retries for health checks
const RETRY_DELAY = 2 * SECONDS; // Delay between retries

/** Server status enum */
export enum ServerStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
}

/**
 * ServerInstance represents a single server instance
 * Manages server status, metadata and health checks
 */
export class ServerInstance extends DurableObject {
  /** Current server status */
  private serverStatus: ServerStatus = ServerStatus.OFFLINE;
  /** Server metadata including endpoint, provider and name */
  private serverMetadata: ServerMetadata | null = null;
  /** Durable Object state */
  private state: DurableObjectState;
  /** Environment variables */
  protected env: Cloudflare.Env;
  /** Timestamp when server last went offline */
  private lastOfflineTime: number | null = null;
  /** Flag to indicate if server is being removed */
  private isBeingRemoved: boolean = false;
  /** Track consecutive successful health checks */
  private consecutiveSuccesses: number = 0;
  /** Track consecutive failed health checks */
  private consecutiveFailures: number = 0;
  /** Current health check interval */
  private currentInterval: number = MIN_HEALTH_CHECK_INTERVAL;

  /**
   * Constructor
   * @param state Durable Object state
   * @param env Environment variables
   */
  constructor(state: DurableObjectState, env: Cloudflare.Env) {
    super(state, env);
    this.state = state;
    this.env = env;
    state.blockConcurrencyWhile(async () => {
      try {
        const storedStatus = await state.storage.get('status');
        this.serverStatus = storedStatus ? storedStatus as ServerStatus : ServerStatus.OFFLINE;

        const metadataStr = await state.storage.get('metadata');
        if (metadataStr) {
          this.serverMetadata = JSON.parse(metadataStr as string);
        }

        const storedOfflineTime = await state.storage.get('lastOfflineTime');
        this.lastOfflineTime = storedOfflineTime ? storedOfflineTime as number : null;
        
        const isBeingRemoved = await state.storage.get('isBeingRemoved');
        this.isBeingRemoved = !!isBeingRemoved;
        
        const storedSuccesses = await state.storage.get('consecutiveSuccesses');
        this.consecutiveSuccesses = storedSuccesses ? storedSuccesses as number : 0;
        
        const storedFailures = await state.storage.get('consecutiveFailures');
        this.consecutiveFailures = storedFailures ? storedFailures as number : 0;
        
        const storedInterval = await state.storage.get('currentInterval');
        this.currentInterval = storedInterval ? storedInterval as number : MIN_HEALTH_CHECK_INTERVAL;
        
        if (this.serverMetadata?.endpoints?.health) {
          await this.checkStatus();
          await this.state.storage.setAlarm(Date.now() + this.currentInterval);
        }

      } catch (error) {
        console.error('Error loading server instance data:', error);
        // Set defaults on error
        this.serverStatus = ServerStatus.OFFLINE;
        this.serverMetadata = null;
        this.lastOfflineTime = null;
        this.isBeingRemoved = false;
      }
    });
  }

  /**
   * Update server metadata and persist to storage
   * @param serverMetadata New server metadata
   */
  private async updateMetadata(serverMetadata: ServerMetadata): Promise<void> {
    try {
      this.serverMetadata = serverMetadata;
      await this.state.storage.put('metadata', JSON.stringify(this.serverMetadata));
    } catch (error) {
      console.error('Failed to update server metadata:', error);
      throw error;
    }
  }

  /**
   * Check server health status by making HTTP request to health endpoint
   * Includes retry mechanism for transient failures
   * @param retryCount Current retry attempt (default: 0)
   */
  async checkStatus(retryCount = 0): Promise<void> {
    if (!this.serverMetadata?.endpoints?.health) {
      await this.handleOfflineStatus('No health endpoint configured');
      return;
    }

    if (this.isBeingRemoved) {
      console.log('Server is being removed, skipping health check');
      return;
    }

    try {
      // Ensure the health check URL is properly formatted
      let healthCheckUrl: string;
      try {
        healthCheckUrl = new URL(this.serverMetadata.endpoints.health).toString();
      } catch (error) {
        // If URL construction fails, use the string directly
        healthCheckUrl = `${this.serverMetadata.endpoints.health}`;
      }

      console.log(`Performing health check for server ${this.serverMetadata.id} at ${healthCheckUrl}`);
      
      const response = await fetch(healthCheckUrl, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
        method: 'GET'
      });

      if (response.ok) {
        await this.updateStatus(ServerStatus.ONLINE);
        
        // Update adaptive interval based on stability
        this.consecutiveSuccesses++;
        this.consecutiveFailures = 0;
        await this.state.storage.put('consecutiveSuccesses', this.consecutiveSuccesses);
        await this.state.storage.put('consecutiveFailures', 0);
        
        // Gradually increase interval for stable servers
        if (this.consecutiveSuccesses > 5) {
          this.currentInterval = Math.min(
            this.currentInterval * 1.5,
            MAX_HEALTH_CHECK_INTERVAL
          );
          await this.state.storage.put('currentInterval', this.currentInterval);
        }
        
        const serverRegistryId = this.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
        const serverRegistry = this.env.SERVER_REGISTRY.get(serverRegistryId);
        
        const server = await serverRegistry.updateHeartbeat(this.serverMetadata.id);

        if (!server) {
          console.error(`Server ${this.state.id} not found in registry`);
          await this.handleOfflineStatus('Server not found in registry');
          return;
        }

        this.lastOfflineTime = null;
        await this.state.storage.delete('lastOfflineTime');
        console.log(`Server ${this.state.id} is online, next check in ${this.currentInterval/1000}s`);
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');
        await this.handleOfflineStatus(`Health check failed with status ${response.status}: ${errorText}`);
      }
    } catch (error) {
      console.error(`Health check failed for server ${this.state.id}:`, error);
      
      // Implement retry logic for transient errors
      if (retryCount < MAX_HEALTH_CHECK_RETRIES) {
        console.log(`Retrying health check (${retryCount + 1}/${MAX_HEALTH_CHECK_RETRIES})...`);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        await this.checkStatus(retryCount + 1);
      } else {
        await this.handleOfflineStatus(`Health check failed after ${MAX_HEALTH_CHECK_RETRIES} retries: ${error}`);
      }
    }
  }

  /**
   * Handle server going offline
   * If offline for too long, remove from registry
   * @param reason Reason for server going offline
   */
  private async handleOfflineStatus(reason: string = 'Unknown reason'): Promise<void> {
    if (this.serverStatus === ServerStatus.ONLINE) {
      console.log(`Server ${this.state.id} went offline: ${reason}`);
    }
    
    // Update adaptive interval - decrease for unstable servers
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    await this.state.storage.put('consecutiveFailures', this.consecutiveFailures);
    await this.state.storage.put('consecutiveSuccesses', 0);
    
    // Quickly retry for recently failed servers
    if (this.consecutiveFailures < 3) {
      this.currentInterval = MIN_HEALTH_CHECK_INTERVAL;
      await this.state.storage.put('currentInterval', this.currentInterval);
    }
    
    await this.updateStatus(ServerStatus.OFFLINE);

    const now = Date.now();
    if (!this.lastOfflineTime) {
      this.lastOfflineTime = now;
      await this.state.storage.put('lastOfflineTime', this.lastOfflineTime);
    }

    const offlineDuration = now - this.lastOfflineTime;
    if (offlineDuration > MAX_OFFLINE_DURATION && !this.isBeingRemoved) {
      console.log(`Server ${this.state.id} has been offline for too long (${offlineDuration}ms), removing from registry`);
      
      // Mark as being removed to prevent concurrent removal attempts
      this.isBeingRemoved = true;
      await this.state.storage.put('isBeingRemoved', true);
      
      try {
        // Remove from ServerRegistry first
        const serverRegistryId = this.env.SERVER_REGISTRY.idFromName(SERVER_REGISTRY_DO_NAME);
        const serverRegistry = this.env.SERVER_REGISTRY.get(serverRegistryId);
        await serverRegistry.removeServer(this.state.id.toString());
        
        // Only after successful removal, clear local storage
        await this.state.storage.deleteAll();
        console.log(`Server ${this.state.id} successfully removed from registry`);
      } catch (error) {
        console.error(`Failed to remove server ${this.state.id} from registry:`, error);
        // Set isBeingRemoved back to false so we can try again later
        this.isBeingRemoved = false;
        await this.state.storage.put('isBeingRemoved', false);
      }
    }
  }

  /**
   * Initialize server instance with metadata and start health checks
   * @param serverMetadata Server metadata
   */
  async init(serverMetadata: ServerMetadata): Promise<void> {
    try {
      if (!serverMetadata?.endpoints?.predict) {
        throw new Error('Server metadata must include a predict endpoint');
      }

      // Validate health endpoint if provided
      if (serverMetadata?.endpoints?.health) {
        try {
          new URL(serverMetadata.endpoints.health);
        } catch (error) {
          console.warn(`Health endpoint URL is invalid: ${serverMetadata.endpoints.health}. Health checks may fail.`);
        }
      }

      await this.updateMetadata(serverMetadata);
      
      // Reset state for re-initialization
      this.isBeingRemoved = false;
      await this.state.storage.delete('isBeingRemoved');
    
    } catch (error) {
      console.error(`Failed to initialize server ${this.state.id}:`, error);
      throw error;
    }
  }

  /**
   * Update server status and persist to storage
   * @param status New server status
   */
  async updateStatus(status: ServerStatus): Promise<void> {
    try {
      this.serverStatus = status;
      await this.state.storage.put('status', status);
    } catch (error) {
      console.error(`Failed to update server ${this.state.id} status:`, error);
      throw error;
    }
  }

  /**
   * Get current server status
   */
  async getStatus(): Promise<ServerStatus> {
    return this.serverStatus;
  }

  /**
   * Get server metadata
   */
  async getMetadata(): Promise<ServerMetadata | null> {
    return this.serverMetadata;
  }

  /**
   * Reset server status and trigger immediate health check
   * Useful for manual recovery after transient issues
   */
  async resetStatus(): Promise<void> {
    try {
      console.log(`Manually resetting status for server ${this.state.id}`);
      this.serverStatus = ServerStatus.OFFLINE;
      this.lastOfflineTime = null;
      this.isBeingRemoved = false;
      
      await this.state.storage.put('status', this.serverStatus);
      await this.state.storage.delete('lastOfflineTime');
      await this.state.storage.delete('isBeingRemoved');
      
      // Trigger immediate health check
      if (this.serverMetadata?.endpoints?.health) {
        await this.checkStatus();
      }
    } catch (error) {
      console.error(`Failed to reset server ${this.state.id} status:`, error);
      throw error;
    }
  }

  /**
   * Alarm handler for periodic health checks
   */
  async alarm(): Promise<void> {
    if (this.isBeingRemoved) {
      console.log(`Server ${this.state.id} is being removed, skipping scheduled health check`);
      return;
    }
    
    await this.checkStatus();
    
    // Only set next alarm if server is not being removed and not offline for too long
    if (this.serverStatus !== ServerStatus.OFFLINE ||
      !this.lastOfflineTime ||
      (Date.now() - this.lastOfflineTime) <= MAX_OFFLINE_DURATION) {
      await this.state.storage.setAlarm(Date.now() + this.currentInterval);
    }
  }
}