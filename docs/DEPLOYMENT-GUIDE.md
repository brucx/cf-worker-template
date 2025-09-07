# 🚀 Cloudflare Worker 任务调度系统部署教程

本教程将手把手教你如何使用这个模板部署一个属于自己的分布式任务调度系统。即使你是新手，只要按照步骤操作，也能在 30 分钟内完成部署！

## 📋 目录

1. [系统简介](#系统简介)
2. [准备工作](#准备工作)
3. [快速部署](#快速部署)
4. [自定义配置](#自定义配置)
5. [常见应用场景](#常见应用场景)
6. [测试验证](#测试验证)
7. [常见问题](#常见问题)

## 🎯 系统简介

### 这个系统能做什么？

这是一个基于 Cloudflare Workers 的**分布式任务调度系统**，可以：

- 🔄 **自动分发任务**：将任务智能分配给多个后端服务器
- 💪 **负载均衡**：确保每个服务器的负载均匀
- 🏥 **健康检查**：自动监控服务器状态，剔除故障服务器
- 📊 **任务统计**：实时统计任务执行情况
- 🔁 **失败重试**：任务失败后自动重试

### 适用场景

- **AI 模型推理服务**：管理多个 GPU 服务器，分发推理任务
- **视频处理集群**：分发视频转码、剪辑任务
- **数据处理管道**：批量数据处理任务调度
- **Web 爬虫系统**：分发爬虫任务到多个节点
- **任何需要任务调度的场景**

## 🛠 准备工作

### 1. 注册 Cloudflare 账号

1. 访问 [Cloudflare 注册页面](https://dash.cloudflare.com/sign-up)
2. 创建免费账号
3. 验证邮箱

### 2. 安装必要工具

打开终端（Mac/Linux）或命令提示符（Windows），执行以下命令：

```bash
# 安装 Node.js (如果还没安装)
# 访问 https://nodejs.org/ 下载并安装 LTS 版本

# 验证安装
node --version  # 应该显示 v18.0.0 或更高版本

# 安装 Wrangler (Cloudflare 的命令行工具)
npm install -g wrangler

# 登录 Cloudflare
wrangler login
```

### 3. 下载项目代码

```bash
# 克隆项目（需要先安装 Git）
git clone https://github.com/your-username/cf-worker-template.git

# 或者直接下载 ZIP 文件并解压

# 进入项目目录
cd cf-worker-template

# 安装依赖
npm install
```

## 🚀 快速部署

### 第 1 步：配置项目名称

编辑 `wrangler.jsonc` 文件：

```jsonc
{
  "name": "my-task-scheduler",  // 改成你的项目名称
  // ... 其他配置
}
```

### 第 2 步：创建数据库

```bash
# 创建 D1 数据库
wrangler d1 create my-tasks-db

# 命令会输出类似这样的信息：
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把输出的 `database_id` 复制到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "TASK_DATABASE",
    "database_name": "my-tasks-db",
    "database_id": "粘贴你的 database_id",  // <-- 这里
    "migrations_dir": "src/migrations"
  }
]
```

### 第 3 步：设置环境变量

创建 `.dev.vars` 文件（本地开发用）：

```env
JWT_SECRET=your-super-secret-key-change-this
```

设置生产环境密钥：

```bash
wrangler secret put JWT_SECRET
# 输入一个安全的密钥（至少 32 个字符）
```

### 第 4 步：初始化数据库

```bash
# 本地测试
npx wrangler d1 migrations apply TASK_DATABASE --local

# 生产环境
npx wrangler d1 migrations apply TASK_DATABASE --remote
```

### 第 5 步：部署到 Cloudflare

```bash
# 部署到生产环境
npm run deploy

# 部署成功后会显示你的 Worker URL:
# https://my-task-scheduler.your-subdomain.workers.dev
```

🎉 **恭喜！你的任务调度系统已经部署成功了！**

## ⚙️ 自定义配置

### 1. 调整服务器超时设置

编辑 `wrangler.jsonc`：

```jsonc
"vars": {
  "SERVER_STALE_THRESHOLD": 300000,  // 5分钟无心跳视为离线
  "SERVER_CLEANUP_INTERVAL": 60000   // 每分钟清理一次
}
```

### 2. 修改任务重试次数

编辑 `src/durable-objects/TaskInstanceDO.ts`：

```typescript
private readonly MAX_RETRIES = 3;  // 最大重试次数
private readonly TASK_TIMEOUT = 3600000;  // 任务超时时间（1小时）
```

### 3. 自定义负载均衡算法

系统支持多种算法：

- `weighted-round-robin`：加权轮询（默认）
- `least-connections`：最少连接
- `response-time`：响应时间最短
- `random`：随机

通过 API 切换：

```bash
curl -X PUT https://your-worker.workers.dev/api/loadbalancer/algorithm \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"algorithm": "least-connections"}'
```

## 🔄 自定义 Payload 格式

系统的 payload 是完全灵活的，可以根据你的后端服务需求自由定义。以下是不同类型推理服务的 payload 示例：

### 通用 Payload 结构

```javascript
{
  type: "任务类型",           // 必填：用于标识任务类型
  priority: 1,                // 可选：优先级（0-10，数字越大优先级越高）
  payload: {                   // 必填：实际传递给后端的数据
    // 你的自定义字段
  },
  capabilities: ["能力1"],     // 必填：后端服务需要具备的能力
  async: true                  // 可选：是否异步执行
}
```

### 不同推理服务的 Payload 示例

#### 1. OpenAI 兼容 API（ChatGPT、文心一言等）

```javascript
const llmTask = {
  type: "chat-completion",
  payload: {
    model: "gpt-3.5-turbo",
    messages: [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    temperature: 0.7,
    max_tokens: 1000,
    stream: false
  },
  capabilities: ["llm", "chat"],
  async: true
};
```

#### 2. Stable Diffusion（图像生成）

```javascript
const sdTask = {
  type: "txt2img",
  payload: {
    prompt: "masterpiece, best quality, 1girl, sunset",
    negative_prompt: "low quality, blurry",
    width: 512,
    height: 768,
    cfg_scale: 7,
    steps: 20,
    sampler: "DPM++ 2M Karras",
    seed: -1,
    model: "animagine-xl-3.1"
  },
  capabilities: ["stable-diffusion", "txt2img"],
  async: true
};
```

#### 3. Whisper（语音识别）

```javascript
const whisperTask = {
  type: "speech-to-text",
  payload: {
    audio_url: "https://example.com/audio.mp3",
    // 或者 base64 编码的音频
    audio_base64: "data:audio/mp3;base64,//...",
    language: "zh",
    task: "transcribe",  // transcribe 或 translate
    model: "whisper-large-v3"
  },
  capabilities: ["whisper", "speech-recognition"],
  async: true
};
```

#### 4. BERT/Transformers（文本分类）

```javascript
const bertTask = {
  type: "text-classification",
  payload: {
    text: "这个产品质量很好，物流也很快",
    model: "bert-base-chinese",
    labels: ["positive", "negative", "neutral"],
    multi_label: false
  },
  capabilities: ["bert", "text-classification"],
  async: false
};
```

#### 5. YOLO（目标检测）

```javascript
const yoloTask = {
  type: "object-detection",
  payload: {
    image_url: "https://example.com/image.jpg",
    // 或者 base64 编码
    image_base64: "data:image/jpeg;base64,//...",
    model: "yolov8n",
    confidence_threshold: 0.5,
    nms_threshold: 0.45,
    max_detections: 100
  },
  capabilities: ["yolo", "object-detection"],
  async: true
};
```

#### 6. OCR（文字识别）

```javascript
const ocrTask = {
  type: "ocr",
  payload: {
    image_url: "https://example.com/document.png",
    languages: ["chi_sim", "eng"],
    detect_layout: true,
    return_format: "json"  // json, text, pdf
  },
  capabilities: ["ocr", "paddle-ocr"],
  async: true
};
```

#### 7. 自定义 ML 模型

```javascript
const customTask = {
  type: "custom-prediction",
  payload: {
    // 完全自定义的数据格式
    input_features: [1.2, 3.4, 5.6, 7.8],
    preprocessing: {
      normalize: true,
      scaling_method: "standard"
    },
    model_name: "my-custom-model-v2",
    output_format: "probabilities"
  },
  capabilities: ["custom-ml"],
  async: false
};
```

### 后端服务集成指南

#### 步骤 1：修改后端接收格式

你的后端服务需要能够接收以下格式的请求：

```javascript
// POST /predict
{
  task_id: "系统生成的任务ID",
  request: {
    type: "任务类型",
    payload: {
      // 你的自定义字段
    }
  },
  callback_url: "回调URL（异步任务用）"
}
```

#### 步骤 2：实现健康检查接口

```javascript
// GET /health
// 返回格式：
{
  status: "healthy",
  serverId: "你的服务器ID",  // 必须与注册时的ID匹配
  capabilities: ["能力列表"]
}
```

#### 步骤 3：处理异步回调（可选）

对于异步任务，处理完成后需要回调：

```javascript
// PUT {callback_url}
{
  status: "COMPLETED",  // 或 "FAILED"
  result: {
    // 处理结果
  },
  metadata: {
    processing_time: 1234,  // 毫秒
    model_version: "1.0"
  }
}
```

### 实际集成示例

#### 示例：集成 Hugging Face 模型

```javascript
// 1. 注册 Hugging Face 推理服务器
const hfServer = {
  name: "HF-Inference-Server",
  endpoints: {
    predict: "http://your-server:8080/api/predict",
    health: "http://your-server:8080/api/health"
  },
  apiKey: "your-api-key",  // 可选
  capabilities: ["huggingface", "llm", "nlp"],
  maxConcurrent: 10
};

// 2. 创建推理任务
const hfTask = {
  type: "text-generation",
  payload: {
    inputs: "The future of AI is",
    parameters: {
      max_new_tokens: 100,
      temperature: 0.8,
      top_p: 0.9,
      do_sample: true
    },
    model_id: "meta-llama/Llama-2-7b-chat-hf"
  },
  capabilities: ["huggingface", "llm"],
  async: true
};

// 3. 后端处理逻辑（Python示例）
@app.post("/api/predict")
async def predict(request: Request):
    data = await request.json()
    task_id = data["task_id"]
    payload = data["request"]["payload"]
    
    # 调用 Hugging Face 模型
    result = pipeline(
        task="text-generation",
        model=payload["model_id"]
    )(payload["inputs"], **payload["parameters"])
    
    # 如果是异步任务，回调结果
    if data.get("callback_url"):
        await callback(data["callback_url"], {
            "status": "COMPLETED",
            "result": result
        })
    
    return {"status": "processing"}
```

## 📚 常见应用场景

### 场景 1：AI 图像处理服务

```javascript
// 1. 注册 GPU 服务器
const server = {
  name: "GPU-Server-1",
  endpoints: {
    predict: "http://gpu1.example.com:5000/predict",
    health: "http://gpu1.example.com:5000/health",
    metrics: "http://gpu1.example.com:5000/metrics"
  },
  capabilities: ["image", "stable-diffusion"],
  maxConcurrent: 5,
  priority: 2
};

// 2. 创建图像生成任务
const task = {
  type: "image-generation",
  payload: {
    prompt: "A beautiful sunset over mountains",
    model: "stable-diffusion-xl",
    steps: 50
  },
  capabilities: ["stable-diffusion"],
  async: true
};
```

### 场景 2：视频处理集群

```javascript
// 1. 注册视频处理节点
const videoServer = {
  name: "Video-Worker-1",
  endpoints: {
    predict: "http://video1.example.com:8080/process",
    health: "http://video1.example.com:8080/health"
  },
  capabilities: ["video", "transcoding", "1080p", "4k"],
  maxConcurrent: 3
};

// 2. 创建视频转码任务
const videoTask = {
  type: "video-transcoding",
  payload: {
    input_url: "s3://bucket/input.mp4",
    output_format: "webm",
    resolution: "1080p",
    bitrate: "5000k"
  },
  capabilities: ["video", "transcoding", "1080p"]
};
```

### 场景 3：数据处理管道

```javascript
// ETL 任务
const etlTask = {
  type: "etl-processing",
  payload: {
    source: "database://source",
    transform: "aggregate",
    destination: "warehouse://destination"
  },
  priority: 1,  // 高优先级
  capabilities: ["etl", "sql"]
};
```

## 🧪 测试验证

### 1. 生成测试 Token

```javascript
// generate-jwt.js
const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    sub: 'admin',
    roles: ['admin']
  },
  'your-jwt-secret',
  { expiresIn: '1h' }
);

console.log('Token:', token);
```

运行：`node generate-jwt.js`

### 2. 注册测试服务器

```bash
curl -X POST https://your-worker.workers.dev/api/servers \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test-Server",
    "endpoints": {
      "predict": "http://localhost:8080/predict",
      "health": "http://localhost:8080/health"
    },
    "capabilities": ["test"],
    "maxConcurrent": 10
  }'
```

### 3. 创建测试任务

```bash
curl -X POST https://your-worker.workers.dev/api/task \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "test",
    "payload": {"message": "Hello World"},
    "capabilities": ["test"]
  }'
```

### 4. 查看任务状态

```bash
curl https://your-worker.workers.dev/api/task/{task-id} \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## ❓ 常见问题

### Q1: 如何添加新的任务类型？

只需要确保你的后端服务器能处理该类型，然后在创建任务时指定 `type` 和所需的 `capabilities`。

### Q2: 如何监控系统状态？

1. 查看服务器列表：`GET /api/servers`
2. 查看任务统计：`GET /api/stats`
3. 查看 API 文档：`GET /docs`

### Q3: 如何处理任务失败？

系统会自动重试失败的任务（最多 3 次）。你也可以手动重试：

```bash
curl -X POST https://your-worker.workers.dev/api/task/{task-id}/retry \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Q4: 如何扩展到更多服务器？

只需注册更多服务器即可，系统会自动进行负载均衡：

```javascript
// 批量注册服务器
for (let i = 1; i <= 10; i++) {
  await registerServer({
    name: `Server-${i}`,
    endpoints: {
      predict: `http://server${i}.example.com/predict`,
      health: `http://server${i}.example.com/health`
    }
  });
}
```

### Q5: 费用如何？

Cloudflare Workers 免费套餐包括：
- 每天 100,000 次请求
- 10ms CPU 时间
- 适合小型项目和测试

生产环境建议使用付费套餐（$5/月起）。

## 🔧 故障排查

### 问题：任务一直是 PENDING 状态

**原因**：没有可用的服务器或服务器能力不匹配

**解决**：
1. 检查是否有服务器注册：`GET /api/servers`
2. 确认服务器的 `capabilities` 包含任务所需的能力
3. 检查服务器健康状态

### 问题：服务器频繁离线

**原因**：健康检查失败或网络问题

**解决**：
1. 确保服务器的健康检查端点正常工作
2. 调整 `SERVER_STALE_THRESHOLD` 为更大的值
3. 检查服务器日志

### 问题：JWT 认证失败

**原因**：Token 过期或密钥不匹配

**解决**：
1. 重新生成 Token
2. 确认 `JWT_SECRET` 一致
3. 检查 Token 是否过期

## 📖 下一步

恭喜你完成了部署！接下来你可以：

1. **阅读 API 文档**：访问 `https://your-worker.workers.dev/docs`
2. **集成到你的应用**：使用任何语言的 HTTP 客户端调用 API
3. **监控和优化**：通过 Cloudflare Dashboard 查看性能指标
4. **扩展功能**：根据需求修改代码，添加新功能

## 💬 获取帮助

- 查看 [完整 API 文档](./API-REFERENCE.md)
- 提交 [GitHub Issue](https://github.com/your-username/cf-worker-template/issues)
- 加入社区讨论

---

🎉 **祝你使用愉快！** 如果这个项目对你有帮助，欢迎给个 Star ⭐