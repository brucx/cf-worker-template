# Durable Objects 核心概念与特性

## 1. 什么是Durable Object

Durable Object是一种特殊的Cloudflare Worker，它独特地结合了计算和存储能力。与普通Worker一样，Durable Object会在首次请求时自动在地理位置上接近请求源的地方创建，需要时快速启动，空闲时关闭。

### 关键特性
- **全局唯一名称**：每个Durable Object都有一个全局唯一的名称，允许从世界任何地方向特定对象发送请求
- **持久存储**：每个对象都附带持久存储，由于存储与对象共存，因此具有强一致性且访问速度快
- **有状态的无服务器应用**：实现了真正的有状态无服务器应用架构

## 2. 核心优势

### 2.1 无服务器计算，零基础设施管理
- 基于Workers运行时构建，支持相同的代码（JavaScript和WASM）
- 首次访问时隐式创建，应用程序无需关心其生命周期
- 在健康服务器之间自动迁移
- 处理请求期间保持活动状态，空闲几秒后才休眠，可利用内存缓存提升性能

### 2.2 存储与计算共存
- 每个Durable Object拥有独立的持久化、事务性、强一致性存储（最多10GB）
- 存储跨请求持久化，仅在该对象内部可访问

### 2.3 单线程并发模型
- 每个Durable Object实例有唯一标识符（随机生成或用户指定）
- 单线程执行模型，避免并发问题
- 自动排队处理请求，确保顺序执行

### 2.4 全局唯一性与协调能力
- 通过全局唯一ID实现分布式协调
- 适合需要多个客户端协同工作的场景
- WebSocket支持，实现实时通信

### 2.5 地理分布与低延迟
- 自动在请求源附近创建和运行
- 全球分布式部署
- 自动负载均衡和故障转移

## 3. RPC (Remote Procedure Call) 系统

> **注意**: 使用RPC需要设置兼容性日期为`2024-04-03`或更高，或在兼容性标志中包含`rpc`。

### 3.1 RPC概述

Workers提供了内置的JavaScript原生RPC系统，允许您：
- 在Worker上定义公共方法，供同一Cloudflare账户的其他Workers通过Service Bindings调用
- 在Durable Objects上定义公共方法，供绑定到它的其他Workers调用

RPC系统设计得尽可能类似于调用同一Worker中的JavaScript函数。在大多数情况下，您可以像编写单一Worker一样编写代码。

### 3.2 基础示例

#### Durable Object实现

```typescript
import { DurableObject } from "cloudflare:workers";

export class CounterDO extends DurableObject {
  private value: number = 0;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    // 从存储恢复状态
    state.blockConcurrencyWhile(async () => {
      this.value = await state.storage.get("value") || 0;
    });
  }

  // RPC方法：增加计数
  async increment(amount: number = 1): Promise<number> {
    this.value += amount;
    await this.state.storage.put("value", this.value);
    return this.value;
  }

  // RPC方法：获取当前值
  async getValue(): Promise<number> {
    return this.value;
  }

  // RPC方法：重置计数器
  async reset(): Promise<void> {
    this.value = 0;
    await this.state.storage.put("value", 0);
  }
}
```

#### Worker调用DO的RPC方法

```typescript
export default {
  async fetch(request: Request, env: Env) {
    // 获取或创建Durable Object实例
    const id = env.COUNTER.idFromName("global-counter");
    const counter = env.COUNTER.get(id);
    
    // 直接调用RPC方法
    const newValue = await counter.increment(5);
    const currentValue = await counter.getValue();
    
    return Response.json({ 
      newValue, 
      currentValue 
    });
  }
};
```

### 3.3 支持的参数和返回类型

RPC支持大多数可序列化的JavaScript值类型：

#### 基本类型
- `undefined`, `null`
- `boolean`
- `number` (包括 `-0`, `NaN`, `Infinity`, `-Infinity`)
- `bigint`
- `string`

#### 对象和数组
- 普通对象: `{ [key: string]: value }`
- 数组: `Array<value>`
- `Map` 和 `Set`
- `Date`
- `RegExp`
- `ArrayBuffer` 和 TypedArrays
- `URL`

#### 特殊支持
- **Streams**: `ReadableStream` 和 `WritableStream`
- **Errors**: 错误对象会被序列化并在远程重新构造
- **Promises**: 自动处理异步操作

#### 不支持的类型
- Functions（函数）
- Symbols
- WeakMap 和 WeakSet

### 3.4 流（Streams）支持

RPC原生支持流的传输，这对于处理大量数据特别有用：

```typescript
export class DataProcessorDO extends DurableObject {
  // 返回可读流
  async streamData(): Promise<ReadableStream> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue("chunk1");
        controller.enqueue("chunk2");
        controller.close();
      }
    });
  }

  // 接受可写流
  async processStream(stream: ReadableStream): Promise<void> {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log("Received:", value);
    }
  }
}
```

### 3.5 错误处理

RPC系统会自动传播错误，保持原始错误类型和堆栈信息：

```typescript
export class ServiceDO extends DurableObject {
  async riskyOperation(): Promise<void> {
    throw new Error("Something went wrong!");
  }
}

// 调用方
try {
  await service.riskyOperation();
} catch (error) {
  // error保持原始类型和堆栈信息
  console.error("Operation failed:", error);
}
```

### 3.6 RPC方法命名约定

为了通过RPC暴露方法，必须满足以下条件：
1. 方法名不能以下划线开头（`_`开头的方法被视为私有）
2. 方法必须是类的实例方法
3. 不能是构造函数或静态方法

```typescript
export class MyDO extends DurableObject {
  // ✅ 可通过RPC调用
  async publicMethod() { }
  
  // ❌ 不能通过RPC调用（私有方法）
  async _privateMethod() { }
  
  // ❌ 不能通过RPC调用（静态方法）
  static async staticMethod() { }
}
```

### 3.7 使用TypeScript获得类型安全

通过定义接口，可以在调用方获得完整的类型支持：

```typescript
// 定义接口
export interface ITaskManager {
  createTask(request: TaskRequest): Promise<Task>;
  getStatus(taskId: string): Promise<TaskStatus>;
  cancelTask(taskId: string): Promise<void>;
}

// 实现接口
export class TaskManagerDO extends DurableObject implements ITaskManager {
  async createTask(request: TaskRequest): Promise<Task> {
    // 实现逻辑
  }
  
  async getStatus(taskId: string): Promise<TaskStatus> {
    // 实现逻辑
  }
  
  async cancelTask(taskId: string): Promise<void> {
    // 实现逻辑
  }
}

// 调用方获得类型提示
const taskManager = env.TASK_MANAGER.get(id) as DurableObjectStub<ITaskManager>;
const task = await taskManager.createTask(request); // 完整类型支持
```

## 4. 存储API

### 4.1 KV存储
```typescript
// 写入
await state.storage.put("key", value);
await state.storage.put({"key1": value1, "key2": value2});

// 读取
const value = await state.storage.get("key");
const values = await state.storage.get(["key1", "key2"]);

// 删除
await state.storage.delete("key");
await state.storage.deleteAll();

// 列出
const list = await state.storage.list({prefix: "user:"});
```

### 4.2 事务
```typescript
await state.storage.transaction(async (txn) => {
  const value = await txn.get("counter");
  await txn.put("counter", value + 1);
});
```

### 4.3 Alarm（定时器）
```typescript
// 设置alarm
await state.storage.setAlarm(Date.now() + 60000); // 60秒后

// 处理alarm
async alarm() {
  // 定时任务逻辑
}
```

## 5. 生命周期管理

### 5.1 创建与初始化
- 通过`idFromName()`或`newUniqueId()`获取ID
- 首次`get(id)`时自动创建实例
- 构造函数用于初始化

### 5.2 请求处理（RPC模式）
- 直接调用暴露的公共方法
- 自动排队，保证顺序执行
- 支持WebSocket升级

### 5.3 休眠与唤醒
- 空闲后自动休眠（通常30秒）
- 新请求自动唤醒
- 使用`blockConcurrencyWhile()`确保初始化完成

### 5.4 迁移与容错
- 自动在数据中心间迁移
- 故障时自动恢复
- 状态持久化保证数据不丢失

## 6. 并发控制

### 6.1 输入门（Input Gate）
- 自动排队incoming请求
- 保证单线程执行
- 避免竞态条件

### 6.2 阻塞并发
```typescript
constructor(state: DurableObjectState) {
  state.blockConcurrencyWhile(async () => {
    // 异步初始化
    this.data = await state.storage.get("data");
  });
}
```

## 7. 完整RPC示例

### 7.1 定义Durable Object

```typescript
import { DurableObject } from "cloudflare:workers";

// 定义接口（可选，但推荐用于类型安全）
export interface IGameRoom {
  joinPlayer(playerId: string, name: string): Promise<void>;
  makeMove(playerId: string, move: Move): Promise<MoveResult>;
  getState(): Promise<GameState>;
  leavePlayer(playerId: string): Promise<void>;
}

export class GameRoomDO extends DurableObject implements IGameRoom {
  private players: Map<string, Player> = new Map();
  private gameState: GameState;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(async () => {
      this.players = await state.storage.get("players") || new Map();
      this.gameState = await state.storage.get("gameState") || this.initGameState();
    });
  }

  async joinPlayer(playerId: string, name: string): Promise<void> {
    if (this.players.size >= 4) {
      throw new Error("Room is full");
    }
    
    this.players.set(playerId, { id: playerId, name, score: 0 });
    await this.saveState();
    
    // 通知其他玩家
    await this.broadcast({
      type: "player-joined",
      player: { id: playerId, name }
    });
  }

  async makeMove(playerId: string, move: Move): Promise<MoveResult> {
    const player = this.players.get(playerId);
    if (!player) {
      throw new Error("Player not in room");
    }
    
    // 处理游戏逻辑
    const result = this.processMove(player, move);
    
    // 更新状态
    this.gameState = result.newState;
    await this.saveState();
    
    // 广播游戏状态更新
    await this.broadcast({
      type: "state-update",
      state: this.gameState
    });
    
    return result;
  }

  async getState(): Promise<GameState> {
    return this.gameState;
  }

  async leavePlayer(playerId: string): Promise<void> {
    this.players.delete(playerId);
    await this.saveState();
    
    await this.broadcast({
      type: "player-left",
      playerId
    });
  }

  // 私有方法（不通过RPC暴露）
  private async saveState(): Promise<void> {
    await this.state.storage.put({
      players: this.players,
      gameState: this.gameState
    });
  }

  private async broadcast(message: any): Promise<void> {
    // WebSocket广播逻辑
  }

  private processMove(player: Player, move: Move): MoveResult {
    // 游戏逻辑处理
  }

  private initGameState(): GameState {
    // 初始化游戏状态
  }
}
```

### 7.2 在Worker中使用

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname.startsWith("/game/")) {
      const roomId = url.pathname.split("/")[2];
      const playerId = url.searchParams.get("playerId");
      
      // 获取Durable Object实例
      const id = env.GAME_ROOM.idFromName(roomId);
      const room = env.GAME_ROOM.get(id) as DurableObjectStub<IGameRoom>;
      
      try {
        // 根据不同路径调用不同的RPC方法
        if (url.pathname.endsWith("/join")) {
          const { name } = await request.json();
          await room.joinPlayer(playerId, name);
          return Response.json({ success: true });
        }
        
        if (url.pathname.endsWith("/move")) {
          const move = await request.json();
          const result = await room.makeMove(playerId, move);
          return Response.json(result);
        }
        
        if (url.pathname.endsWith("/state")) {
          const state = await room.getState();
          return Response.json(state);
        }
        
        if (url.pathname.endsWith("/leave")) {
          await room.leavePlayer(playerId);
          return Response.json({ success: true });
        }
        
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 400 }
        );
      }
    }
    
    return new Response("Not Found", { status: 404 });
  }
};
```

## 8. 限制与配额

### 8.1 资源限制
- CPU时间：30秒（付费计划可更高）
- 内存：128MB-512MB
- 存储：10GB per DO
- 并发请求：取决于计划

### 8.2 RPC限制
- 参数大小：最大1MB（可配置）
- 返回值大小：最大1MB（可配置）
- 嵌套深度：有限制

## 9. 最佳实践

### 9.1 RPC设计原则
1. **保持方法简单**：每个RPC方法应该有单一职责
2. **使用TypeScript接口**：定义清晰的接口获得类型安全
3. **合理的错误处理**：使用自定义错误类传递详细信息
4. **避免大数据传输**：使用流处理大量数据
5. **幂等性设计**：确保方法可以安全重试

### 9.2 性能优化
- 利用内存缓存减少存储访问
- 批量操作减少RPC调用次数
- 使用事务保证数据一致性
- 合理使用alarm进行后台处理

### 9.3 状态管理
- 在构造函数中使用`blockConcurrencyWhile`加载状态
- 定期持久化重要状态
- 使用事务处理复杂状态更新
- 实现状态版本控制和迁移

## 10. 总结

Durable Objects配合RPC系统提供了强大的分布式状态管理能力：

- **全局唯一性**：实现分布式协调
- **强一致性**：事务性存储保证数据准确
- **类型安全**：RPC提供完整的TypeScript支持
- **高性能**：内存缓存和直接方法调用
- **易于使用**：像调用本地函数一样简单

这是构建现代分布式应用的理想选择，特别适合需要实时协作、状态同步和全球分布的场景。
