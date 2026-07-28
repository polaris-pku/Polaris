import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = Number(process.env.POLARIS_WEB_BRIDGE_PORT || 4318);
const backendRoot = path.resolve(root, '../newide-scaffold');
const backendEntry = path.join(backendRoot, 'src/app/backend-rpc-stdio.ts');
const driverRunnerDir = path.resolve(root, '../acp-client-prototype');
const driverEnvFile = path.resolve(
  process.env.ACP_DRIVER_ENV_FILE || path.join(driverRunnerDir, '.env'),
);
const driverEnvironment = readDriverEnvironment(driverEnvFile);
const stateDir = path.join(root, '.newide/web-backend-state');
const defaultWorkspace = path.join(os.homedir(), 'Documents/polaris-workspace/default');
const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
const rpcMethods = new Set([
  'system.ping',
  'run.create',
  'run.getSnapshot',
  'run.subscribe',
  'run.unsubscribe',
  'run.cancel',
  'memory.listAgents',
  'memory.getAgent',
  'memory.listSkills',
  'memory.listExperiences',
  'memory.listMaintenance',
  'memory.promoteSkills',
  'memory.getCapabilities',
  // task.* ── 断点续跑所需的最小集合。
  'task.get',
  'task.list',
  'task.subscribe',
  'task.unsubscribe',
  'task.resume',
  'task.cancel',
]);
const ignoredDirectories = new Set(['.git', '.newide', 'node_modules', 'dist', 'release']);
const authorizedRoots = new Set();
const eventClients = new Set();
const pending = new Map();
let nextId = 1;
let child;
let currentWorkspace = defaultWorkspace;
let status = backendStatus('stopped', '');

function readDriverEnvironment(filePath) {
  if (!fsSync.existsSync(filePath)) return {};
  return parseEnv(fsSync.readFileSync(filePath, 'utf8'));
}

function configuredValue(name) {
  return driverEnvironment[name] || process.env[name] || '';
}

function anthropicSettings() {
  return {
    hasKey: Boolean(
      configuredValue('ANTHROPIC_API_KEY') || configuredValue('ANTHROPIC_AUTH_TOKEN'),
    ),
    baseUrl: configuredValue('ANTHROPIC_BASE_URL'),
    model: configuredValue('ANTHROPIC_MODEL'),
    fastModel: configuredValue('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
  };
}

function localCredentials() {
  return fsSync.existsSync(path.join(os.homedir(), '.claude/.credentials.json'));
}

function authReady() {
  return anthropicSettings().hasKey || localCredentials();
}

function backendStatus(state, message) {
  const configured = anthropicSettings();
  return {
    state,
    message,
    workspace: currentWorkspace,
    auth: {
      providerId: 'anthropic',
      hasKey: configured.hasKey,
      incomplete: false,
      hasLocalCredentials: localCredentials(),
      ready: authReady(),
      baseUrl: configured.baseUrl,
      model: configured.model,
      fastModel: configured.fastModel,
    },
    agents: [{ id: 'claude', name: 'Claude Code' }],
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic（本机环境）',
        keyLabel: 'Anthropic API Key',
        keyHint: '由启动进程环境或 Claude Code 登录态提供',
        consoleUrl: 'https://console.anthropic.com/settings/keys',
        consoleName: 'Anthropic Console',
        baseUrl: '',
        editableBaseUrl: false,
        defaultModel: '',
        defaultFastModel: '',
      },
    ],
  };
}

function emit(type, payload) {
  const line = `data: ${JSON.stringify({ type, payload })}\n\n`;
  for (const client of eventClients) client.write(line);
}

function setStatus(state, message = '') {
  status = backendStatus(state, message);
  emit('backend.status', status);
  console.log(`[web-bridge] backend ${state}${message ? `: ${message}` : ''}`);
}

function stopBackend() {
  if (!child) return;
  const dying = child;
  child = undefined;
  for (const slot of pending.values()) slot.reject(new Error('BCD 后端已重启'));
  pending.clear();
  try {
    if (dying.pid && process.platform !== 'win32') process.kill(-dying.pid, 'SIGTERM');
    else dying.kill();
  } catch {
    dying.kill();
  }
}

async function startBackend(workspace = currentWorkspace) {
  for (const required of [backendEntry, driverRunnerDir]) {
    if (!fsSync.existsSync(required)) {
      setStatus('error', `缺少开发后端文件：${required}`);
      return status;
    }
  }
  stopBackend();
  currentWorkspace = path.resolve(workspace);
  await fs.mkdir(currentWorkspace, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  setStatus('starting');

  const proc = spawn(process.execPath, ['--import', 'tsx', backendEntry], {
    cwd: backendRoot,
    env: {
      ...process.env,
      ACP_WORKSPACE: currentWorkspace,
      ACP_DRIVER_RUNNER_DIR: driverRunnerDir,
      NEWIDE_COORDINATION_DB: path.join(stateDir, 'coordination.sqlite'),
      // Use deterministic hash embeddings by default so the bridge starts
      // without an embedding API key; override via shell env.
      NEWIDE_B_EMBEDDING_PROVIDER: process.env.NEWIDE_B_EMBEDDING_PROVIDER || 'hash',
      // Default 2-minute driver timeout is too short for complex tasks.
      // Override via ACP_DRIVER_TIMEOUT_MS in the shell that starts the bridge.
      ACP_DRIVER_TIMEOUT_MS: process.env.ACP_DRIVER_TIMEOUT_MS || '300000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child = proc;
  const isCurrent = () => child === proc;

  proc.stderr.on('data', (chunk) => process.stderr.write(`[bcd] ${String(chunk)}`));
  proc.on('error', (error) => isCurrent() && setStatus('error', error.message));
  proc.on('exit', (code) => {
    if (!isCurrent()) return;
    child = undefined;
    for (const slot of pending.values()) slot.reject(new Error(`BCD 已退出 code=${code}`));
    pending.clear();
    setStatus('stopped', `BCD 已退出 code=${code}`);
  });

  const lines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!isCurrent()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method === 'run.event') {
      emit('run.event', message.params);
      return;
    }
    if (message.method === 'task.event') {
      emit('task.event', message.params);
      return;
    }
    const slot = pending.get(message.id);
    if (!slot) return;
    pending.delete(message.id);
    if (message.error) {
      const error = new Error(message.error.message || 'RPC 错误');
      error.code = message.error.code;
      slot.reject(error);
    } else slot.resolve(message.result);
  });

  try {
    const pong = await sendRpc('system.ping');
    setStatus('ready', `protocol ${pong?.protocol_version || '?'}`);
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error));
  }
  return status;
}

function sendRpc(method, params) {
  if (!rpcMethods.has(method)) return Promise.reject(new Error(`未授权的 RPC 方法：${method}`));
  if (!child?.stdin.writable) return Promise.reject(new Error('BCD 后端未运行'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`RPC 超时：${method}`));
    }, 300_000);
  });
}

function isInside(absolutePath, rootPath) {
  return absolutePath === rootPath || absolutePath.startsWith(rootPath + path.sep);
}

async function authorizeRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('请输入绝对目录路径');
  const resolved = path.resolve(value);
  await fs.mkdir(resolved, { recursive: true });
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error('目标不是目录');
  authorizedRoots.add(resolved);
  return resolved;
}

function targetPath(payload) {
  const rootPath = path.resolve(payload.rootPath || currentWorkspace);
  if (!authorizedRoots.has(rootPath) && rootPath !== currentWorkspace)
    throw new Error('目录未经授权');
  const absolutePath = path.resolve(rootPath, String(payload.path || ''));
  if (!isInside(absolutePath, rootPath)) throw new Error('非法路径');
  return absolutePath;
}

async function scanDirectory(directory, depth = 0, budget = { remaining: 2000 }) {
  if (depth > 8 || budget.remaining <= 0) return [];
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const visible = entries
    .filter((entry) => !entry.name.startsWith('.') && !ignoredDirectories.has(entry.name))
    .sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
    );
  const nodes = [];
  for (const entry of visible) {
    if (budget.remaining-- <= 0) break;
    nodes.push(
      entry.isDirectory()
        ? {
            name: entry.name,
            children: await scanDirectory(path.join(directory, entry.name), depth + 1, budget),
          }
        : { name: entry.name },
    );
  }
  return nodes;
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('请求体过大');
  }
  return raw ? JSON.parse(raw) : {};
}

function json(response, statusCode, value) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function route(request, response) {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
    return json(response, 403, { error: '不允许的来源' });
  }
  if (url.pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': request.headers.origin || allowedOrigins.values().next().value,
    });
    eventClients.add(response);
    response.write(`data: ${JSON.stringify({ type: 'backend.status', payload: status })}\n\n`);
    request.on('close', () => eventClients.delete(response));
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': request.headers.origin || '',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    return response.end();
  }
  response.setHeader(
    'access-control-allow-origin',
    request.headers.origin || 'http://127.0.0.1:5173',
  );

  const body = request.method === 'POST' ? await readBody(request) : {};
  if (url.pathname === '/health') return json(response, 200, { ok: true });
  if (url.pathname === '/backend/status') return json(response, 200, status);
  if (url.pathname === '/backend/call') {
    try {
      return json(response, 200, { ok: true, result: await sendRpc(body.method, body.params) });
    } catch (error) {
      return json(response, 200, { ok: false, error: error.message, code: error.code });
    }
  }
  if (url.pathname === '/backend/configure') {
    const workspace = body.rootPath
      ? await authorizeRoot(body.rootPath)
      : path.join(
          os.homedir(),
          'Documents/polaris-workspace',
          String(body.projectName || 'default'),
        );
    if (workspace !== currentWorkspace || status.state !== 'ready') await startBackend(workspace);
    return json(response, 200, status);
  }
  if (url.pathname === '/backend/restart') {
    await startBackend(currentWorkspace);
    return json(response, 200, status);
  }
  if (url.pathname === '/backend/settings') {
    return json(response, 200, {
      provider: 'anthropic',
      configured: { anthropic: anthropicSettings() },
    });
  }
  if (url.pathname === '/fs/authorize') {
    const rootPath = await authorizeRoot(body.path);
    return json(response, 200, { path: rootPath, name: path.basename(rootPath) });
  }
  if (url.pathname === '/fs/tree') {
    const rootPath = await authorizeRoot(body.rootPath);
    const budget = { remaining: 2000 };
    const tree = await scanDirectory(rootPath, 0, budget);
    return json(response, 200, { ok: true, tree, truncated: budget.remaining <= 0 });
  }
  if (url.pathname === '/fs/read') {
    const absolutePath = targetPath(body);
    const stat = await fs.stat(absolutePath);
    if (stat.size > 512 * 1024)
      return json(response, 200, { ok: false, error: '文件过大，暂不支持预览' });
    const content = await fs.readFile(absolutePath, 'utf8');
    return json(
      response,
      200,
      content.includes('\0')
        ? { ok: false, error: '二进制文件' }
        : { ok: true, content, absPath: absolutePath },
    );
  }
  if (url.pathname === '/fs/write') {
    const absolutePath = targetPath(body);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, String(body.content || ''), 'utf8');
    return json(response, 200, { ok: true, absPath: absolutePath });
  }
  if (url.pathname === '/fs/reveal') {
    if (process.platform === 'darwin')
      spawn('open', ['-R', String(body.path)], { stdio: 'ignore' });
    return json(response, 200, { ok: true });
  }
  return json(response, 404, { error: 'Not found' });
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) =>
    json(response, 500, { error: error.message || String(error) }),
  );
});

server.listen(port, host, async () => {
  console.log(`[web-bridge] http://${host}:${port}`);
  await startBackend();
});

function shutdown() {
  stopBackend();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
