const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = process.env.FORD_GATEWAY_HOST || "127.0.0.1";
const PORT = Number(process.env.FORD_GATEWAY_PORT || 8000);
const KEY_FILE = path.join(__dirname, "gateway.key");
const MODEL_DEFAULT = process.env.FORD_GATEWAY_MODEL || "gpt-5-nano";
const OPENCODE_HOST = "127.0.0.1";
const OPENCODE_PORT = Number(process.env.FORD_OPENCODE_PORT || 4097);
const REUSE_OPENCODE = process.env.FORD_REUSE_OPENCODE === "true";
const OPENCODE_BASE = `http://${OPENCODE_HOST}:${OPENCODE_PORT}`;
const LOG_PREFIX = "[gateway]";

const MODELS = [
  "claude-sonnet-latest", "deepseek", "fordllm-claude-latest",
  "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest",
  "gemma", "glm", "gpt-5", "gpt-5-mini", "gpt-5-nano",
];

let opencode;
let shuttingDown = false;

function loadGatewayKey() {
  try {
    const existing = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(KEY_FILE, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Generated gateway key and saved it to ${KEY_FILE}`);
  return generated;
}

const GATEWAY_KEY = loadGatewayKey();

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

function error(res, status, message, type = "invalid_request_error") {
  json(res, status, { error: { message, type } });
}

function authorized(req) {
  return Boolean(GATEWAY_KEY) && req.headers.authorization === `Bearer ${GATEWAY_KEY}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Request body must be valid JSON")); }
    });
    req.on("error", reject);
  });
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part && (part.type === "text" || typeof part.text === "string"))
    .map((part) => part.text || "").join("\n");
}

function promptFromMessages(messages) {
  return messages.map((message) => `${(message.role || "user").toUpperCase()}:\n${textFromContent(message.content)}`).join("\n\n");
}

function logChatContent(request, result) {
  const messages = (request.messages || []).map((message) => ({
    role: message.role || "user",
    content: textFromContent(message.content),
  }));
  console.log(`[chat] request=${JSON.stringify(messages)} response=${JSON.stringify(result.output)}`);
}

function modelId(value) {
  const model = value || MODEL_DEFAULT;
  return model.includes("/") ? model.split("/", 2)[1] : model;
}

async function opencodeRequest(path, options = {}) {
  const response = await fetch(`${OPENCODE_BASE}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text }; }
  if (!response.ok) throw new Error(body?.message || body?.error || `OpenCode returned HTTP ${response.status}`);
  return body;
}

async function complete(request) {
  if (!Array.isArray(request.messages) || request.messages.length === 0) throw new Error("messages must be a non-empty array");
  const selectedModel = modelId(request.model);
  if (!MODELS.includes(selectedModel)) throw new Error(`Unsupported model: ${selectedModel}`);
  const session = await opencodeRequest("/session", { method: "POST", body: JSON.stringify({ title: "OpenAI gateway request" }) });
  const result = await opencodeRequest(`/session/${encodeURIComponent(session.id)}/message`, {
    method: "POST",
     body: JSON.stringify({ model: { providerID: "fordllm", modelID: selectedModel }, parts: [{ type: "text", text: promptFromMessages(request.messages) }] }),
  });
  const output = (result.parts || []).filter((part) => part.type === "text").map((part) => part.text || "").join("");
  return { output, model: selectedModel };
}

function completionResponse(result, stream) {
  const base = { id: `chatcmpl-${Date.now().toString(36)}`, created: Math.floor(Date.now() / 1000), model: result.model };
  if (stream) return base;
  return { ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: result.output }, finish_reason: "stop" }] };
}

function sendSse(res, result) {
  const base = completionResponse(result, true);
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: result.output }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

async function handle(req, res) {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { status: "ok" });
  if (!authorized(req)) return error(res, 401, "Missing or invalid gateway API key", "authentication_error");
  if (req.method === "GET" && req.url === "/v1/models") return json(res, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", created: 0, owned_by: "fordllm" })) });
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") return error(res, 404, "Not found");
  try {
    const request = await readBody(req);
    const result = await complete(request);
    logChatContent(request, result);
    if (request.stream) return sendSse(res, result);
    return json(res, 200, completionResponse(result, false));
  } catch (err) { return error(res, 500, err.message, "server_error"); }
}

function startOpenCode() {
  opencode = spawn("opencode", ["serve", "--hostname", OPENCODE_HOST, "--port", String(OPENCODE_PORT)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: true });
  opencode.stdout.on("data", (data) => process.stdout.write(`[opencode] ${data}`));
  opencode.stderr.on("data", (data) => process.stderr.write(`[opencode] ${data}`));
  opencode.on("exit", (code) => { if (!shuttingDown) { console.error(`OpenCode server exited with code ${code}`); process.exitCode = 1; } });
}

async function start() {
  if (REUSE_OPENCODE && await isPortOpen(OPENCODE_HOST, OPENCODE_PORT)) {
    console.log(`Reusing existing OpenCode server at ${OPENCODE_BASE}`);
  } else {
    startOpenCode();
  }
  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    res.once("finish", () => console.log(`${LOG_PREFIX} ${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - startedAt}ms`));
    handle(req, res).catch((err) => error(res, 500, err.message, "server_error"));
  });
  server.listen(PORT, HOST, () => { console.log(`OpenAI gateway listening at http://${HOST}:${PORT}/v1`); console.log(`Using FordLLM model: ${MODEL_DEFAULT}`); });

  function shutdown() { shuttingDown = true; server.close(); if (opencode) opencode.kill(); }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => { console.error(err.message); process.exit(1); });
