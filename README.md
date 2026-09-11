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

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

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
