import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const methods = new Set(
  JSON.parse(readFileSync(path.join(root, 'electron', 'backend-rpc-methods.json'), 'utf8')),
);
const port = Number(process.env.POLARIS_WEB_BRIDGE_PORT || 43127);
const allowedOrigin = process.env.POLARIS_WEB_ORIGIN || 'http://127.0.0.1:5173';
const stateRoot = path.resolve(process.env.NEWIDE_STATE_ROOT || path.join(root, '.newide', 'web'));
const workspace = path.resolve(process.env.ACP_WORKSPACE || root);
const agentDir = path.join(backendDir, 'agent');
const runnerDir = path.join(backendDir, 'acp-runner');
const driverEnvFile = path.join(stateRoot, 'driver.env');
const pending = new Map();
const clients = new Set();
let nextId = 1;
let childExited = false;

mkdirSync(stateRoot, { recursive: true });
writeFileSync(driverEnvFile, '', { flag: 'a', mode: 0o600 });

const child = spawn(
  path.join(backendDir, 'runtime', 'node'),
  [path.join(backendDir, 'backend-host.cjs')],
  {
    cwd: stateRoot,
    env: {
      ...process.env,
      POLARIS_NODE_BIN: path.join(backendDir, 'runtime', 'node'),
      POLARIS_AGENT_DIR: agentDir,
      NEWIDE_STATE_ROOT: stateRoot,
      NEWIDE_COORDINATION_DB: path.join(stateRoot, 'coordination.sqlite'),
      NEWIDE_LITELLM_CONFIG_DIR: path.join(backendDir, 'config'),
      ACP_DRIVER_RUNNER_DIR: runnerDir,
      ACP_DRIVER_ENV_FILE: driverEnvFile,
      ACP_WORKSPACE: workspace,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  },
);

createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === 'task.event' || message.method === 'run.event') {
    const data = `data: ${JSON.stringify({ method: message.method, params: message.params })}\n\n`;
    for (const client of clients) client.write(data);
    return;
  }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  request.resolve(message);
});

child.once('exit', (code, signal) => {
  childExited = true;
  const error = new Error(`Backend exited (code=${String(code)}, signal=${String(signal)})`);
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  for (const client of clients) client.end();
  clients.clear();
});
child.once('error', (error) => {
  childExited = true;
  for (const request of pending.values()) request.reject(error);
  pending.clear();
});

function call(method, params) {
  if (childExited || !child.stdin.writable) {
    return Promise.reject(new Error('Backend process is not running'));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
      if (!error) return;
      pending.delete(id);
      reject(error);
    });
  });
}

function cors(response, origin) {
  if (origin === allowedOrigin) response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'origin');
}

createServer(async (request, response) => {
  const origin = request.headers.origin;
  cors(response, origin);
  if (origin && origin !== allowedOrigin) {
    response.writeHead(403).end('Forbidden origin');
    return;
  }
  if (request.method === 'OPTIONS') {
    response.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && request.url === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    clients.add(response);
    request.once('close', () => clients.delete(response));
    return;
  }
  if (request.method !== 'POST' || request.url !== '/rpc') {
    response.writeHead(404).end('Not found');
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) {
      response.writeHead(413).end('Request too large');
      return;
    }
    chunks.push(chunk);
  }

  try {
    const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!methods.has(envelope.method)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: envelope.id ?? null,
          error: { code: -32601, message: `Unauthorized RPC method: ${String(envelope.method)}` },
        }),
      );
      return;
    }
    const result = await call(envelope.method, envelope.params ?? {});
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
}).listen(port, '127.0.0.1', () => {
  process.stderr.write(`[web-bridge] http://127.0.0.1:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    child.kill('SIGTERM');
    process.exitCode = 0;
  });
}
