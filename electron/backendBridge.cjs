// BCD 后端桥：主进程拉起 newide-bcd 的 JSON-RPC stdio 服务，并把它的方法/事件转成 IPC。
//
// 为什么走 IPC 而不是 HTTP+WS：BCD 只暴露 stdio 上的行分隔 JSON-RPC。用 IPC 转发
// 就不必开端口、管端口冲突、处理 CORS/鉴权，渲染层的 sandbox 模型也保持不变；
// 且 BCD 崩溃只会让后端不可用，不会拖死应用窗口。
//
// 进程链：renderer ──IPC──> main ──JSON-RPC/stdio──> BCD ──spawn/一次性──> A(ACP runner) ──> 真实 agent CLI
const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');
const fs = require('fs');
const { resolveProjectRoot } = require('./fsBridge.cjs');

const isDev = !app.isPackaged;

/** 仓库根：dev 下是项目根；打包后 packages/ 会随 extraResources 落到 resourcesPath。 */
function repoRoot() {
  return isDev ? path.join(__dirname, '..') : process.resourcesPath;
}

const BCD_DIR = path.join(repoRoot(), 'packages', 'newide-bcd');
const ACP_DIR = path.join(repoRoot(), 'packages', 'acp-client');

/** BCD 只能被创建/取消，没有人类回写通道 —— 这里的方法名即当前后端的全部能力面。 */
const RPC_METHODS = [
  'system.ping',
  'run.create',
  'run.getSnapshot',
  'run.subscribe',
  'run.unsubscribe',
  'run.cancel',
];

/** @type {import('child_process').ChildProcess | null} */
let child = null;
let nextId = 1;
/** @type {Map<number, {resolve: Function, reject: Function}>} */
const pending = new Map();
/** @type {() => import('electron').BrowserWindow | null} */
let getWindow = () => null;

let status = { state: 'stopped', message: '' };
/** 等待后端就绪的订阅者（starting 期间到达的调用挂在这里，而不是被直接拒掉）。 */
let readyWaiters = [];

function setStatus(state, message = '') {
  status = { state, message };
  if (isDev) console.log(`[backend] ${state}${message ? `: ${message}` : ''}`);
  getWindow()?.webContents.send('backend:status', status);
  if (state === 'starting') return;
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const { resolve, reject } of waiters) {
    if (state === 'ready') resolve();
    else reject(new Error(message || `BCD 后端 ${state}`));
  }
}

/**
 * 等后端就绪。
 *
 * 切项目会重启 BCD（ACP_WORKSPACE 只在启动时读一次），重启期间用户完全可能已经点了
 * 「新建需求」。此时直接拒绝会让一次正常操作平白失败 —— 挂起等它起来才是对的。
 */
function waitForReady(timeoutMs = 30_000) {
  if (status.state === 'ready') return Promise.resolve();
  if (status.state !== 'starting') {
    return Promise.reject(new Error(status.message || 'BCD 后端未运行'));
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    readyWaiters.push(waiter);
    setTimeout(() => {
      const i = readyWaiters.indexOf(waiter);
      if (i >= 0) {
        readyWaiters.splice(i, 1);
        reject(new Error('等待 BCD 后端就绪超时'));
      }
    }, timeoutMs);
  });
}

function pushEvent(params) {
  getWindow()?.webContents.send('backend:event', params);
}

/** 还没选项目时的兜底工作区（与 fsBridge 的默认工作区同根）。 */
function defaultWorkspace() {
  return path.join(app.getPath('documents'), 'polaris-workspace', 'default');
}

/** 后端启动前的硬前置：BCD 若找不到 ACP runner 会在启动瞬间抛异常并退出。 */
function preflight() {
  if (!fs.existsSync(BCD_DIR)) return `找不到 BCD 后端目录：${BCD_DIR}`;
  if (!fs.existsSync(ACP_DIR)) return `找不到 ACP runner 目录：${ACP_DIR}`;
  const runnerPkg = path.join(ACP_DIR, 'package.json');
  if (!fs.existsSync(runnerPkg)) return `ACP runner 缺少 package.json：${runnerPkg}`;
  try {
    const pkg = JSON.parse(fs.readFileSync(runnerPkg, 'utf8'));
    if (!pkg.scripts?.['driver:run']) return `ACP runner 没有 driver:run 脚本：${ACP_DIR}`;
  } catch (err) {
    return `ACP runner package.json 解析失败：${err.message}`;
  }
  return null;
}

/**
 * 启动 BCD 子进程。
 * workspace 是 agent 真正写文件的目录；agentId 决定用哪个真实 agent（默认 claude）。
 * 换 workspace/agent 需要重启子进程 —— BCD 的这两个配置只在启动时读一次。
 */
/** 当前子进程实际生效的配置 —— 用于同配置去重（见 start）。 */
let currentConfig = null;

function start({ workspace, agentId } = {}, { force = false } = {}) {
  const problem = preflight();
  if (problem) {
    setStatus('error', problem);
    return;
  }

  const resolvedWorkspace = workspace || defaultWorkspace();
  const resolvedAgentId = agentId || process.env.ACP_AGENT_ID || 'claude';

  // 同配置去重：切项目会触发 configure，而 UI 完全可能对同一项目重复调用。
  // 每次都重启的话，后一次会把前一次正在启动的后端直接杀掉，表现为「run.create 时后端未运行」。
  if (
    !force &&
    currentConfig &&
    currentConfig.workspace === resolvedWorkspace &&
    currentConfig.agentId === resolvedAgentId &&
    (status.state === 'ready' || status.state === 'starting')
  ) {
    return;
  }

  stop();
  setStatus('starting');

  // agent 的写工具（ACP fs/write_text_file）不会 mkdir 工作区本身 —— 目录不存在时
  // 它的 edit 调用直接失败，最终表现为一个语焉不详的 DRIVER_FAILED。这里先建好。
  try {
    fs.mkdirSync(resolvedWorkspace, { recursive: true });
  } catch (err) {
    setStatus('error', `无法创建 agent 工作区 ${resolvedWorkspace}：${err.message}`);
    return;
  }

  currentConfig = { workspace: resolvedWorkspace, agentId: resolvedAgentId };

  const env = {
    ...process.env,
    ACP_DRIVER_RUNNER_DIR: ACP_DIR,
    ACP_AGENT_ID: resolvedAgentId,
    ACP_WORKSPACE: resolvedWorkspace,
  };

  // 用 pnpm --dir 拉起：子进程 cwd 落在 BCD 目录，其 .newide/runs 审计产物也写在那里。
  // detached：pnpm 会再 spawn 一个 node 子进程，只杀 pnpm 会留下孤儿后端。
  // 建独立进程组，停止时按组杀（见 stop）。
  const proc = spawn('pnpm', ['--dir', BCD_DIR, 'backend:rpc'], {
    cwd: BCD_DIR,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  });
  child = proc;

  // 重启时旧子进程的 exit 是异步到达的 —— 若不认门，它会把刚设成 starting 的状态
  // 覆盖回 stopped，并把等待就绪的调用全部拒掉。所以 handler 只处理「当前」子进程。
  const isCurrent = () => child === proc;

  proc.on('error', (err) => {
    if (isCurrent()) setStatus('error', `BCD 启动失败：${err.message}`);
  });

  proc.on('exit', (code) => {
    if (!isCurrent()) return;
    // 未响应的调用必须拒绝，否则渲染层会永久转圈。
    for (const { reject } of pending.values()) {
      reject(new Error(`BCD 后端已退出（code=${code}）`));
    }
    pending.clear();
    child = null;
    if (status.state !== 'error') setStatus('stopped', `BCD 已退出（code=${code}）`);
  });

  let stderrTail = '';
  proc.stderr.on('data', (buf) => {
    const text = String(buf);
    stderrTail = (stderrTail + text).slice(-2000);
    if (isDev) process.stderr.write(`[bcd] ${text}`);
  });

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!isCurrent()) return; // 旧子进程的残留输出不能串进新会话
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // pnpm 自己的输出会混进来，非 JSON 行直接丢弃
    }
    if (msg.method === 'run.event') {
      pushEvent(msg.params);
      return;
    }
    const slot = msg.id != null ? pending.get(msg.id) : undefined;
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) {
      const err = new Error(msg.error.message || 'RPC 错误');
      err.code = msg.error.code;
      err.data = msg.error.data;
      slot.reject(err);
    } else {
      slot.resolve(msg.result);
    }
  });

  // 健康检查：ping 通了才算 ready，避免渲染层对着一个死后端发请求。
  // 这里必须用 send（裸发），不能用 call —— call 会等 ready，而 ready 正由这次 ping 决定。
  send('system.ping')
    .then((res) => setStatus('ready', `protocol ${res?.protocol_version ?? '?'}`))
    .catch((err) =>
      setStatus('error', `BCD 无响应：${err.message}${stderrTail ? `\n${stderrTail}` : ''}`),
    );
}

function stop() {
  if (!child) return;
  const dying = child;
  child = null;
  currentConfig = null;
  // 按进程组杀：pnpm 底下还挂着真正跑 BCD 的 node 进程，只杀 pnpm 会留下孤儿。
  try {
    if (process.platform !== 'win32' && dying.pid) {
      process.kill(-dying.pid, 'SIGTERM');
    } else {
      dying.kill();
    }
  } catch {
    dying.kill(); // 进程组已消失（ESRCH）时回落到直接 kill
  }
}

/** 裸发一条 JSON-RPC 请求（不等就绪；仅供健康检查与 call 内部使用）。 */
function send(method, params) {
  if (!child || !child.stdin.writable) {
    return Promise.reject(new Error('BCD 后端未运行'));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`RPC 超时：${method}`));
    }, 60_000);
  });
}

/** 渲染层的调用入口：方法白名单 + 等后端就绪 + 发请求。 */
async function call(method, params) {
  if (!RPC_METHODS.includes(method)) {
    throw new Error(`未授权的 RPC 方法：${method}`);
  }
  await waitForReady();
  return send(method, params);
}

function setupBackendBridge(windowGetter) {
  getWindow = windowGetter;

  ipcMain.handle('backend:call', async (_event, { method, params }) => {
    try {
      return { ok: true, result: await call(method, params) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code };
    }
  });

  ipcMain.handle('backend:getStatus', () => status);

  // 用户打开项目后把 agent 工作区绑到该项目根目录（BCD 只在启动时读 ACP_WORKSPACE，故需重启）。
  // 复用 fsBridge 的落点解析：agent 写进哪里 = E 观测面板读哪里。
  ipcMain.handle('backend:configure', (_event, options = {}) => {
    const { projectName, rootPath, agentId } = options;
    if (isDev) console.log('[backend] configure', JSON.stringify(options));
    let workspace;
    if (projectName || rootPath) {
      const resolved = resolveProjectRoot({ projectName, rootPath });
      if (resolved.error) {
        setStatus('error', `无法定位项目工作区：${resolved.error}`);
        return status;
      }
      workspace = resolved.root;
    }
    start({ workspace, agentId });
    return status;
  });

  // 手动重启：绕过同配置去重（用户点重启就是要真重启，比如刚补了 .env）。
  ipcMain.handle('backend:restart', () => {
    start(currentConfig || {}, { force: true });
    return status;
  });

  app.on('before-quit', stop);
  app.on('will-quit', stop);

  start({});
}

module.exports = { setupBackendBridge, stopBackend: stop };
