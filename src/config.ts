/**
 * Centralized configuration for the application
 */

export const config = {
  // JWT Configuration
  jwt: {
    algorithm: 'HS256' as const,
    expiresIn: '1h',
  },
  
  // CORS Configuration
  cors: {
    credentials: true,
    // Will be set dynamically based on environment
    getAllowedOrigins: (env?: string) => {
      if (env === 'production') {
        return [
          'https://app.example.com',
          'https://admin.example.com'
        ];
      }
      return [
        'http://localhost:3000',
        'http://localhost:8787',
        'http://127.0.0.1:8787'
      ];
    }
  },
  
  // Health Check Configuration
  healthCheck: {
    minInterval: 10 * 1000,  // 10 seconds
    maxInterval: 60 * 1000,  // 60 seconds
    maxFailuresBeforeOffline: 3,
    offlineTimeout: 3 * 60 * 1000, // 3 minutes
  },
  
  // Task Configuration
  task: {
    defaultTimeout: 60 * 60 * 1000, // 1 hour
    maxRetries: 3,
    retryDelay: {
      base: 1000,     // 1 second
      max: 30000,     // 30 seconds
    }
  },
  
  // Database Configuration
  database: {
    tasksTable: 'Tasks',
    batchSize: 100,
  },
  
  // Server Registry Configuration
  registry: {
    cleanupInterval: 5 * 60 * 1000, // 5 minutes
    staleServerTimeout: 10 * 60 * 1000, // 10 minutes
  },
  
  // API Configuration
  api: {
    basePath: '/api',
    docsPath: '/docs',
    version: '1.0.0',
    title: 'Task Processing API',
    description: 'Distributed task processing system with Cloudflare Workers',
  },
  
  // Durable Object Names
  durableObjects: {
    serverRegistry: 'SERVER-REGISTRY-SINGLETON',
    taskManagerPrefix: 'task-',
    serverInstancePrefix: 'server-',
  },
  
  // Limits
  limits: {
    maxConcurrentTasks: 100,
    maxServersPerRegistry: 1000,
    maxTaskPayloadSize: 1024 * 1024, // 1MB
  }
};

// Type exports for better type safety
export type Config = typeof config;
export type CorsConfig = typeof config.cors;
export type HealthCheckConfig = typeof config.healthCheck;
export type TaskConfig = typeof config.task;