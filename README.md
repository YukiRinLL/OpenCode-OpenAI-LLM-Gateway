# OpenCode OpenAI LLM Gateway

这是一个在 Windows 本机运行的 OpenAI 兼容网关。外部客户端访问本程序提供的 `/v1` 接口，本程序再通过本机 OpenCode server 调用已配置的 LLM provider。

网关不会复制或导出 OpenCode OAuth 凭据。所需网络/VPN 和 OpenCode 登录状态必须在运行网关的本机上保持有效。

## 文件

- `llm-openai-gateway.js`：Node.js 网关程序
- `config.example.json`：配置模板
- `config.json`：当前运行配置
- `gateway.key`：首次启动时自动生成的访问密钥，不应上传
- `start-gateway.bat`：启动脚本

## 要求

- Windows
- Node.js 18 或更高版本
- `opencode` 命令可在 PowerShell 或命令提示符中执行
- 本机已完成 OpenCode/provider 登录

## 启动

双击 `start-gateway.bat`，或在命令提示符中执行：

```bat
cd /d "%USERPROFILE%\Desktop\OpenCode-OpenAI-LLM-Gateway"
start-gateway.bat
```

默认地址：`http://127.0.0.1:8000/v1`

## 配置

```json
{
  "gatewayHost": "127.0.0.1",
  "gatewayPort": 8000,
  "model": "gpt-5-nano",
  "providerId": "your-provider-id",
  "opencodePort": 4097,
  "reuseOpenCode": true
}
```

- `gatewayHost`：网关监听地址。
- `gatewayPort`：OpenAI 兼容网关端口。
- `model`：默认模型。
- `providerId`：OpenCode 配置中的 provider ID，请按本机配置填写。
- `opencodePort`：本机 OpenCode server 端口。
- `reuseOpenCode`：是否复用已运行的 OpenCode server。

首次启动时，如果 `gateway.key` 不存在，程序会生成随机访问密钥。不要将该文件上传到外部网络。

## 客户端配置

```text
Base URL: http://127.0.0.1:8000/v1
API Key: gateway.key 文件中的内容
Model: gpt-5-nano
```

## 接口

网关提供一个 OpenAI 风格的 `/v1` API 面。使用 `GET /v1` 可以查看完整接口目录及每个接口当前的状态：

```text
GET  /health                         健康检查，无需认证
GET  /v1                             接口目录
GET  /v1/models                      获取模型列表
GET  /v1/models/:model               获取单个模型
POST /v1/chat/completions            聊天补全
POST /v1/completions                 Legacy 文本补全
POST /v1/responses                   Responses API
```

下面这些常规 OpenAI 路径也已纳入网关路由目录。由于当前 OpenCode provider 链路只提供文本生成能力，它们会返回 HTTP `501`，而不是伪造成功结果：

```text
POST /v1/embeddings                  向量嵌入
POST /v1/moderations                 内容审核
POST /v1/images/generations          图片生成
POST /v1/images/edits                图片编辑
POST /v1/images/variations           图片变体
POST /v1/audio/speech                语音合成
POST /v1/audio/transcriptions        语音转文本
POST /v1/audio/translations          音频翻译
GET/POST/DELETE /v1/files            文件管理
GET/POST /v1/batches                  批处理
GET/POST /v1/fine_tuning/jobs        微调任务
GET/POST/DELETE /v1/assistants       Assistants
/v1/threads/*                        Threads、Messages、Runs
/v1/vector_stores/*                  Vector Stores
```

未实现接口会返回 `501 endpoint_not_supported`。因此，“接口完整”与“底层能力完整”是两件事：当前实际支持模型列表、文本聊天、Legacy 文本补全和 Responses。

当前 `stream: true` 使用标准 SSE 格式，但会等待完整回答后一次性发送。当前实现主要适用于低并发、纯文本请求，不完整透传多模态、工具调用和全部生成参数。

不要将没有 TLS 的服务直接暴露到公网。
