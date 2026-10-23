# FordLLM OpenAI Gateway

这是一个在 Windows 本机运行的 OpenAI 兼容网关。外部客户端访问本程序提供的 `/v1` 接口，本程序再通过本机 OpenCode server 调用已登录的 FordLLM。

网关不会复制或导出 OpenCode OAuth 凭据。Ford 网络/VPN 和 OpenCode 登录状态必须在运行网关的本机上保持有效。

## 目录文件

- `fordllm-openai-gateway.js`：Node.js 网关程序
- `config.example.json`：配置模板，可用于重新创建配置
- `config.json`：当前实际运行配置
- `gateway.key`：网关首次启动时自动生成并持久化的访问密钥，不应提交到 Git
- `start-gateway.bat`：读取 `config.json` 并启动服务
- `README.md`：本说明文档

## 运行要求

- Windows
- Node.js 18 或更高版本
- `opencode` 命令可在 PowerShell 或命令提示符中执行
- 本机已完成 OpenCode/FordLLM 登录
- 需要调用 FordLLM 时，本机连接 Ford 公司网络或 VPN

## 启动服务

双击：

```text
start-gateway.bat
```

或在命令提示符中运行：

```bat
cd /d "%USERPROFILE%\Desktop\OpenCode-OpenAI-LLM-Gateway"
start-gateway.bat
```

当前默认地址：

```text
http://127.0.0.1:8000/v1
```

## 配置文件

实际配置位于 `config.json`：

```json
{
  "gatewayHost": "127.0.0.1",
  "gatewayPort": 8000,
  "model": "gpt-5-nano",
  "opencodePort": 4097,
  "reuseOpenCode": true
}
```

- `gatewayHost`：网关监听地址。
- `gatewayPort`：OpenAI 兼容网关端口，默认 `8000`。
- `gateway.key`：外部客户端访问网关时使用的 Bearer token，不是 FordLLM API key。文件不存在或为空时，网关首次启动会生成一个新的随机密钥；之后每次启动都会复用该文件中的密钥。
- `model`：默认模型，当前为 `gpt-5-nano`。
- `opencodePort`：网关启动的本机 OpenCode server 端口，默认 `4097`。
- `reuseOpenCode`：为 `true` 时，如果 `opencodePort` 已有 OpenCode server 监听，网关直接复用它。

## OpenAI 客户端配置

```text
Base URL: http://127.0.0.1:8000/v1
API Key: gateway.key 文件中的内容
Model: gpt-5-nano
```

不要在 Base URL 后重复添加 `/chat/completions`。OpenAI 客户端会自动拼接接口路径。

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

下面这些常规 OpenAI 路径也已纳入网关路由目录。由于当前 FordLLM/OpenCode 链路只提供文本生成能力，它们会返回 HTTP `501`，而不是伪造成功结果：

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

当前 `stream: true` 使用标准 SSE 格式，但响应内容会在 FordLLM 完成后一次性发送，不是逐 token 实时流。

## 故障排查

### 无法连接 FordLLM

确认本机已连接 Ford 网络或 VPN，并且 OpenCode 可以正常使用 `fordllm/gpt-5-nano`。

### `opencode` 命令找不到

在 PowerShell 执行：

```powershell
Get-Command opencode
```

如果没有结果，需要先安装或配置兼容的 OpenCode/Ford 发行版，并重新打开命令行窗口。

## 运行限制

- 当前 `stream: true` 使用标准 SSE 格式，但响应内容会在 FordLLM 完成后一次性发送，不是逐 token 实时流。
- 每个请求创建一个独立 OpenCode session。
- 当前网关没有 TLS，不适合跨不可信网络传输。
- 当前网关不读取 OpenCode 本地认证文件；认证由本机 OpenCode server 处理。
