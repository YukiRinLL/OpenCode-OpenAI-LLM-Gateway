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

const SUPPORTED_ENDPOINTS = new Set([
  "GET /health",
  "GET /v1",
  "GET /v1/models",
  "GET /v1/models/:model",
  "POST /v1/chat/completions",
  "POST /v1/completions",
  "POST /v1/responses",
]);

const STANDARD_ENDPOINTS = [
  "GET /v1/models",
  "GET /v1/models/:model",
  "DELETE /v1/models/:model",
  "POST /v1/chat/completions",
  "POST /v1/completions",
  "POST /v1/responses",
  "GET /v1/responses/:response_id",
  "DELETE /v1/responses/:response_id",
  "POST /v1/responses/:response_id/cancel",
  "POST /v1/embeddings",
  "POST /v1/moderations",
  "POST /v1/images/generations",
  "POST /v1/images/edits",
  "POST /v1/images/variations",
  "POST /v1/audio/speech",
  "POST /v1/audio/transcriptions",
  "POST /v1/audio/translations",
  "GET /v1/files",
  "POST /v1/files",
  "GET /v1/files/:file_id",
  "DELETE /v1/files/:file_id",
  "GET /v1/files/:file_id/content",
  "GET /v1/batches",
  "POST /v1/batches",
  "GET /v1/batches/:batch_id",
  "POST /v1/batches/:batch_id/cancel",
  "POST /v1/fine_tuning/jobs",
  "GET /v1/fine_tuning/jobs",
  "GET /v1/fine_tuning/jobs/:fine_tuning_job_id",
  "POST /v1/fine_tuning/jobs/:fine_tuning_job_id/cancel",
  "GET /v1/fine_tuning/jobs/:fine_tuning_job_id/events",
  "GET /v1/assistants",
  "POST /v1/assistants",
  "GET /v1/assistants/:assistant_id",
  "POST /v1/assistants/:assistant_id",
  "DELETE /v1/assistants/:assistant_id",
  "GET /v1/threads/:thread_id",
  "POST /v1/threads",
  "POST /v1/threads/:thread_id",
  "DELETE /v1/threads/:thread_id",
  "GET /v1/threads/:thread_id/messages",
  "POST /v1/threads/:thread_id/messages",
  "GET /v1/threads/:thread_id/messages/:message_id",
  "POST /v1/threads/:thread_id/messages/:message_id",
  "DELETE /v1/threads/:thread_id/messages/:message_id",
  "GET /v1/threads/:thread_id/runs",
  "POST /v1/threads/:thread_id/runs",
  "GET /v1/threads/:thread_id/runs/:run_id",
  "POST /v1/threads/:thread_id/runs/:run_id",
  "POST /v1/threads/:thread_id/runs/:run_id/cancel",
  "GET /v1/threads/:thread_id/runs/:run_id/steps",
  "GET /v1/threads/:thread_id/runs/:run_id/steps/:step_id",
  "GET /v1/vector_stores",
  "POST /v1/vector_stores",
  "GET /v1/vector_stores/:vector_store_id",
  "POST /v1/vector_stores/:vector_store_id",
  "DELETE /v1/vector_stores/:vector_store_id",
  "GET /v1/vector_stores/:vector_store_id/files",
  "POST /v1/vector_stores/:vector_store_id/files",
  "GET /v1/vector_stores/:vector_store_id/files/:file_id",
  "DELETE /v1/vector_stores/:vector_store_id/files/:file_id",
  "POST /v1/vector_stores/:vector_store_id/files/:file_id",
  "POST /v1/vector_stores/:vector_store_id/file_batches",
  "GET /v1/vector_stores/:vector_store_id/file_batches/:batch_id",
  "POST /v1/vector_stores/:vector_store_id/file_batches/:batch_id/cancel",
  "GET /v1/vector_stores/:vector_store_id/file_batches/:batch_id/files",
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
  res.writeHead(status, {
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

function error(res, status, message, type = "invalid_request_error", code = null) {
  const body = { message, type };
  if (code) body.code = code;
  json(res, status, { error: body });
}

class RequestError extends Error {
  constructor(message, code = "invalid_request") {
    super(message);
    this.code = code;
  }
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
      try { resolve(JSON.parse(data || "{}")); } catch { reject(new RequestError("Request body must be valid JSON")); }
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
  if (!Array.isArray(request.messages) || request.messages.length === 0) throw new RequestError("messages must be a non-empty array");
  const selectedModel = modelId(request.model);
  if (!MODELS.includes(selectedModel)) throw new RequestError(`The model '${selectedModel}' does not exist`, "model_not_found");
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

function sendSseEvents(res, events) {
  res.writeHead(200, {
    "access-control-allow-origin": "*",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  for (const event of events) {
    if (event.name) res.write(`event: ${event.name}\n`);
    res.write(`data: ${typeof event.data === "string" ? event.data : JSON.stringify(event.data)}\n\n`);
  }
  res.end();
}

function sendChatSse(res, result) {
  const base = completionResponse(result, true);
  sendSseEvents(res, [
    { data: { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: result.output }, finish_reason: null }] } },
    { data: { ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] } },
    { data: "[DONE]" },
  ]);
}

function modelInfo(id) {
  return { id, object: "model", created: 0, owned_by: "fordllm" };
}

function endpointMatches(method, pathname, endpoint) {
  const [endpointMethod, endpointPath] = endpoint.split(" ");
  if (method !== endpointMethod) return false;
  const pattern = endpointPath.split("/").map((part) => part.startsWith(":") ? "[^/]+" : part).join("\\/");
  return new RegExp(`^${pattern}$`).test(pathname);
}

function endpointCatalog() {
  return STANDARD_ENDPOINTS.map((endpoint) => ({
    endpoint,
    status: SUPPORTED_ENDPOINTS.has(endpoint) || endpoint === "GET /v1/models/:model" ? "supported" : "not_implemented",
  }));
}

function completionResult(result, promptIndex = 0) {
  return { index: promptIndex, text: result.output, logprobs: null, finish_reason: "stop" };
}

function responseMessages(input, instructions) {
  if (typeof input === "string") {
    return [
      ...(instructions ? [{ role: "system", content: instructions }] : []),
      { role: "user", content: input },
    ];
  }
  if (!Array.isArray(input) || input.length === 0) return null;
  const messages = instructions ? [{ role: "system", content: instructions }] : [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    if (item.role && (typeof item.content === "string" || Array.isArray(item.content))) {
      messages.push({ role: item.role, content: item.content });
      continue;
    }
    if (item.type === "message" && item.role && item.content !== undefined) {
      messages.push({ role: item.role, content: item.content });
      continue;
    }
    return null;
  }
  return messages;
}

function responsePayload(result) {
  return {
    id: `resp-${Date.now().toString(36)}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: result.model,
    status: "completed",
    output: [{
      id: `msg-${Date.now().toString(36)}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", annotations: [], text: result.output }],
    }],
    output_text: result.output,
  };
}

async function handleChatCompletions(request, res) {
  const result = await complete(request);
  logChatContent(request, result);
  if (request.stream) return sendChatSse(res, result);
  return json(res, 200, completionResponse(result, false));
}

async function handleCompletions(request, res) {
  if (typeof request.prompt !== "string" && !Array.isArray(request.prompt)) throw new RequestError("prompt must be a string or a non-empty array");
  const prompts = Array.isArray(request.prompt) ? request.prompt : [request.prompt];
  if (prompts.length === 0 || prompts.some((prompt) => typeof prompt !== "string")) throw new RequestError("prompt must contain only strings");
  const results = await Promise.all(prompts.map((prompt) => complete({ model: request.model, messages: [{ role: "user", content: prompt }] })));
  const id = `cmpl-${Date.now().toString(36)}`;
  if (request.stream) {
    return sendSseEvents(res, [
      ...results.map((result, index) => ({ data: { id, object: "text_completion", created: Math.floor(Date.now() / 1000), model: result.model, choices: [{ ...completionResult(result, index), finish_reason: null }] } })),
      { data: "[DONE]" },
    ]);
  }
  return json(res, 200, { id, object: "text_completion", created: Math.floor(Date.now() / 1000), model: results[0].model, choices: results.map(completionResult) });
}

async function handleResponses(request, res) {
  const messages = responseMessages(request.input, request.instructions);
  if (!messages) throw new RequestError("input must be a string or an array of supported messages");
  const result = await complete({ model: request.model, messages });
  logChatContent({ messages }, result);
  const response = responsePayload(result);
  if (!request.stream) return json(res, 200, response);
  return sendSseEvents(res, [
    { name: "response.created", data: { type: "response.created", response } },
    { name: "response.output_text.delta", data: { type: "response.output_text.delta", delta: result.output, output_index: 0, content_index: 0 } },
    { name: "response.completed", data: { type: "response.completed", response } },
    { data: "[DONE]" },
  ]);
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-origin": "*",
    });
    return res.end();
  }
  const pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  if (req.method === "GET" && pathname === "/health") return json(res, 200, { status: "ok" });
  if (!authorized(req)) return error(res, 401, "Missing or invalid gateway API key", "authentication_error");
  if (req.method === "GET" && pathname === "/v1") return json(res, 200, { object: "gateway", endpoints: endpointCatalog() });
  if (req.method === "GET" && pathname === "/v1/models") return json(res, 200, { object: "list", data: MODELS.map(modelInfo) });
  if (req.method === "GET" && pathname.startsWith("/v1/models/")) {
    const id = decodeURIComponent(pathname.slice("/v1/models/".length));
    if (!MODELS.includes(id)) return error(res, 404, `The model '${id}' does not exist`, "invalid_request_error", "model_not_found");
    return json(res, 200, modelInfo(id));
  }
  if (STANDARD_ENDPOINTS.some((endpoint) => endpointMatches(req.method, pathname, endpoint)) &&
      !endpointMatches(req.method, pathname, "GET /v1/models") &&
      !endpointMatches(req.method, pathname, "GET /v1/models/:model") &&
      !endpointMatches(req.method, pathname, "POST /v1/chat/completions") &&
      !endpointMatches(req.method, pathname, "POST /v1/completions") &&
      !endpointMatches(req.method, pathname, "POST /v1/responses")) {
    return error(res, 501, `Endpoint ${req.method} ${pathname} is not implemented by this gateway`, "server_error", "endpoint_not_supported");
  }
  if (req.method !== "POST" || !["/v1/chat/completions", "/v1/completions", "/v1/responses"].includes(pathname)) return error(res, 404, "Not found");
  try {
    const request = await readBody(req);
    if (pathname === "/v1/chat/completions") return await handleChatCompletions(request, res);
    if (pathname === "/v1/completions") return await handleCompletions(request, res);
    return await handleResponses(request, res);
  } catch (err) {
    if (err instanceof RequestError) return error(res, 400, err.message, "invalid_request_error", err.code);
    return error(res, 500, err.message, "server_error");
  }
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
