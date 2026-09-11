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

接口：

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

当前 `stream: true` 使用 SSE 兼容格式，但会等待完整回答后一次性发送。当前实现主要适用于低并发、纯文本请求，不完整透传多模态、工具调用和全部生成参数。

不要将没有 TLS 的服务直接暴露到公网。
