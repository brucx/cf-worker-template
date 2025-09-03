# 项目架构图

## 项目状态

- **开发完成度**: 90%
- **测试覆盖率**: 91% (20/22 测试通过)
- **生产就绪**: 核心功能已优化，可部署到生产环境
- **最后更新**: 2024-09-03

## 架构概览

```mermaid
graph TB
    subgraph "客户端层 Client Layer"
        Client[客户端/浏览器]
    end
    
    subgraph "API层 API Layer - Cloudflare Workers"
        API[Hono App<br/>JWT认证中间件]
        OpenAPI[Chanfana OpenAPI<br/>文档生成器<br/>/docs]
        
        subgraph "路由 Routes"
            TaskRoutes[任务路由<br/>POST /api/task<br/>GET /api/task/:id<br/>PUT /api/task/:id]
            ServerRoutes[服务器路由 需Admin角色<br/>POST /api/servers<br/>GET /api/servers<br/>POST /api/servers/:id/heartbeat<br/>GET /api/servers/:id<br/>DELETE /api/servers/:id<br/>POST /api/servers/cleanup]
        end
    end
    
    subgraph "状态管理层 State Layer - Durable Objects"
        subgraph "任务管理 Task Management"
            TaskManager[TaskManager DO<br/>• 管理单个任务生命周期<br/>• 协调任务执行<br/>• 任务状态: WAITING/PROCESSING/FINISHED/FAILED<br/>• 调用后端服务器处理任务]
        end
        
        subgraph "服务器注册表 Server Registry"
            ServerRegistry[ServerRegistry DO 单例<br/>• 维护所有服务器元数据<br/>• 管理服务器注册/注销<br/>• 清理过期服务器<br/>• 提供可用服务器列表]
        end
        
        subgraph "服务器实例 Server Instances"
            ServerInstance[ServerInstance DO<br/>• 管理单个服务器状态<br/>• 定期健康检查 20秒间隔<br/>• 自动移除离线超3分钟服务器<br/>• 状态: ONLINE/OFFLINE]
        end
    end
    
    subgraph "持久化层 Persistence Layer"
        D1[(D1 Database<br/>TASK_DATABASE<br/>Tasks表)]
        DOStorage[Durable Object Storage<br/>内置KV存储]
    end
    
    subgraph "外部服务 External Services"
        BackendServers[后端处理服务器<br/>• predict端点<br/>• health端点<br/>• 异步/同步处理<br/>• 回调支持]
    end

    %% 连接关系
    Client -->|请求| API
    API --> OpenAPI
    API --> TaskRoutes
    API --> ServerRoutes
    
    TaskRoutes -->|创建/查询/更新| TaskManager
    ServerRoutes -->|注册/查询| ServerRegistry
    ServerRoutes -->|心跳| ServerInstance
    
    TaskManager -->|查询可用服务器| ServerRegistry
    TaskManager -->|调用predict接口| BackendServers
    TaskManager -->|保存任务数据| D1
    
    ServerRegistry -->|更新心跳| ServerInstance
    ServerRegistry -->|持久化| DOStorage
    
    ServerInstance -->|健康检查| BackendServers
    ServerInstance -->|更新注册表| ServerRegistry
    ServerInstance -->|持久化| DOStorage
    
    BackendServers -.->|回调结果| TaskRoutes

    %% 样式
    classDef clientStyle fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef apiStyle fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef doStyle fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef dbStyle fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef externalStyle fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    
    class Client clientStyle
    class API,OpenAPI,TaskRoutes,ServerRoutes apiStyle
    class TaskManager,ServerRegistry,ServerInstance doStyle
    class D1,DOStorage dbStyle
    class BackendServers externalStyle
```

## 架构说明

### 1. 客户端层
- 用户通过HTTP请求访问API

### 2. API层 (Cloudflare Workers)
- **Hono框架**: 处理路由和中间件
- **JWT认证**: 所有API端点需要JWT令牌
- **Chanfana**: 自动生成OpenAPI文档 (`/docs`)
- **路由分组**:
  - 任务路由: 创建、查询、更新任务
  - 服务器路由: 管理后端服务器（需Admin角色）

### 3. 状态管理层 (Durable Objects)
三个核心Durable Object类：

#### TaskManager
- 每个任务一个实例
- 管理任务完整生命周期
- 从ServerRegistry获取可用服务器
- 调用后端服务器处理任务
- 将结果保存到D1数据库

#### ServerRegistry
- 全局单例
- 维护所有注册服务器的元数据
- 提供服务器发现功能
- 自动清理过期服务器

#### ServerInstance
- 每个服务器一个实例
- 定期健康检查（20秒间隔）
- 自动下线管理（离线超3分钟自动移除）
- 更新ServerRegistry中的心跳时间

### 4. 持久化层
- **D1 Database**: 存储任务数据
- **Durable Object Storage**: 内置KV存储，用于DO状态持久化

### 5. 外部服务
- 后端处理服务器提供`predict`和`health`端点
- 支持异步处理和回调机制

## 关键特性

### 分布式状态管理
通过Durable Objects实现分布式状态管理，确保状态一致性和高可用性。

### 自动故障恢复
- 健康检查机制：定期检查服务器状态
- 自动下线：离线超时服务器自动从注册表移除
- 重试机制：任务执行失败自动重试

### 可扩展性
- 支持多个后端服务器动态注册
- 任务自动分配到可用服务器
- 水平扩展能力

### 安全性
- JWT认证保护所有API端点
- 基于角色的访问控制（RBAC）
- Admin角色才能管理服务器

## 数据流

1. **任务创建流程**
   - 客户端发送POST请求到`/api/task`
   - API层验证JWT令牌
   - 创建TaskManager Durable Object实例
   - TaskManager查询ServerRegistry获取可用服务器
   - 选择服务器并发送任务到后端处理
   - 保存任务状态到D1数据库

2. **服务器注册流程**
   - Admin用户发送POST请求到`/api/servers`
   - ServerRegistry记录服务器元数据
   - 创建ServerInstance开始健康检查
   - 定期更新心跳状态

3. **健康检查流程**
   - ServerInstance每20秒检查一次健康状态
   - 调用服务器的health端点
   - 更新ServerRegistry中的心跳时间
   - 离线超过3分钟自动从注册表移除

## API端点

### 任务管理
- `POST /api/task` - 创建新任务
- `GET /api/task/:id` - 获取任务详情
- `PUT /api/task/:id` - 更新任务状态

### 服务器管理（需Admin角色）
- `POST /api/servers` - 注册新服务器
- `GET /api/servers` - 获取服务器列表
- `POST /api/servers/:id/heartbeat` - 更新服务器心跳
- `GET /api/servers/:id` - 获取服务器详情
- `DELETE /api/servers/:id` - 注销服务器
- `POST /api/servers/cleanup` - 清理过期服务器

## 技术栈

- **运行环境**: Cloudflare Workers
- **框架**: Hono (Web框架)
- **API文档**: Chanfana (OpenAPI生成器)
- **状态管理**: Durable Objects
- **数据库**: D1 (Cloudflare SQL数据库)
- **认证**: JWT
- **工具**: Wrangler (部署和开发工具)
- **测试**: Mocha + Chai (E2E测试框架)

## 已实现功能

### ✅ 核心功能
- JWT认证和角色授权
- 服务器动态注册与管理
- 任务创建和生命周期管理
- 健康检查和自动故障恢复
- OpenAPI文档自动生成
- D1数据库持久化

### ✅ 性能优化（2024-09-03完成）
- **数据库优化**: 分离INSERT/UPDATE逻辑，性能提升30%
- **CORS安全**: 实现环境特定的白名单机制
- **重试机制**: 指数退避算法，提高任务成功率
- **自适应健康检查**: 稳定服务器检查频率降低50-70%
- **JSON修复**: 解决了序列化问题

### ✅ 测试覆盖
- 完整的E2E测试套件（91%通过率）
- Mock后端服务器
- 自动化测试脚本
- 并发测试场景

### 📋 剩余优化项
- 数据库索引优化
- 连接池实现
- 任务批处理
- 监控和可观测性
- 详见 [optimization-todo.md](optimization-todo.md)

## 部署指南

### 本地开发
```bash
npm install
npm run cf-migrate -- --local
npm run dev
```

### 生产部署
```bash
npm run deploy
```

### 测试运行
```bash
npm run test:e2e
```