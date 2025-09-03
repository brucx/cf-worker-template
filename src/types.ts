import { Context } from "hono";

export type Bindings = Pick<Cloudflare.Env, keyof Cloudflare.Env>;
export type AppContext = Context<{ Bindings: Bindings }>;

// 改这里
export interface TaskRequest {
  mimeType: string;
  model: string;
  video_quality: string;
  video_url: string;
  enable_upscale: boolean;
}

export interface TaskCustomData {
  [key: string]: string | number | boolean;
}

export interface ServerMetadata {
  id: string;
  endpoints: {
    predict: string;
    health?: string;
  };
  provider: string;
  name: string;
  async?: boolean;
  callback?: boolean;
  lastHeartbeat?: string;
}

export enum TaskStatus {
	UNKNOWN = 'UNKNOWN',
  WAITING = "WAITING",
  PROCESSING = "PROCESSING",
  FINISHED = "FINISHED",
  FAILED = "FAILED",
}


export interface TaskResult {
  task_id: string;
  backend_task_id: string;
  data: Record<string, any>;
  metadata: {
    server_id: string;
    processing_time?: number;
    model_time?: number;
    queue_time?: number;
    progress?: number;
    status: TaskStatus;
    message?: string | null | undefined;
    custom_data?: any;
  };
}

export interface Task {
  id: string;
  status: TaskStatus;
  request: TaskRequest;
  serverId?: string;
  result: TaskResult | null;
  createdAt: number;
  updatedAt: number;
  callbackUrl?: string;
  error?: string;
}

export const SERVER_REGISTRY_DO_NAME = "SERVER_REGISTRY";
export const SECONDS = 1000;
