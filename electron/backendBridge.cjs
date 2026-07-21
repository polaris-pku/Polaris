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
// settings.json 的读写只有这一个入口（串行 + 原子写）。见 electron/settings.cjs 顶部注释。
const { readSettings, writeSettings } = require('./settings.cjs');

const isDev = !app.isPackaged;

/**
 * 自包含后端目录（scripts/build-backend.mjs 产出，打包时随 extraResources 落到 resourcesPath）。
 *
 *   backend/backend-host.cjs   BCD 后端（driver 已注入为「包内 node 跑包内 A」）
 *   backend/acp-runner.cjs     A 的 ACP runner
 *   backend/runtime/node       Node 运行时
 *   backend/agent/             claude-agent-acp + Claude Code 原生二进制
 *
 * 用户机器上**不需要** pnpm / tsc / npx / node，也不需要预先安装 Claude Code。
 */
const BACKEND_DIR = isDev
  ? path.join(__dirname, '..', 'backend')
  : path.join(process.resourcesPath, 'backend');

const NODE_BIN = path.join(
  BACKEND_DIR,
  'runtime',
  process.platform === 'win32' ? 'node.exe' : 'node',
);
const BACKEND_HOST = path.join(BACKEND_DIR, 'backend-host.cjs');
const ACP_RUNNER = path.join(BACKEND_DIR, 'acp-runner.cjs');
const AGENT_DIR = path.join(BACKEND_DIR, 'agent');

/** BCD 只能被创建/取消，没有人类回写通道 —— 这里的方法名即当前后端的全部能力面。 */
const RPC_METHODS = [
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
];

/** @type {import('child_process').ChildProcess | null} */
let child = null;
let nextId = 1;
/** @type {Map<number, {resolve: Function, reject: Function}>} */
const pending = new Map();
/** @type {() => import('electron').BrowserWindow | null} */
let getWindow = () => null;

let status = {
  state: 'stopped',
  message: '',
  workspace: '',
  auth: {
    providerId: 'anthropic',
    hasKey: false,
    incomplete: false,
    hasLocalCredentials: false,
    ready: false,
    baseUrl: '',
    model: '',
    fastModel: '',
  },
  agents: [],
  providers: [],
};
/** 等待后端就绪的订阅者（starting 期间到达的调用挂在这里，而不是被直接拒掉）。 */
let readyWaiters = [];

function setStatus(state, message = '') {
  // workspace 必须随状态一起暴露给渲染层：「agent 写到哪」是后端的全局状态，
  // 用户在界面上看不见它的话，文件写错项目也毫无察觉（run 照样显示 completed）。
  //
  // auth 同理，而且更要命：没配 key 的用户提交需求后只会看到一个语焉不详的失败，
  // 完全不知道自己缺什么。把「认证是否就绪」做成可观测状态，界面才能提前拦住他。
  status = {
    state,
    message,
    workspace: currentConfig?.workspace ?? '',
    auth: authState(),
    agents: AGENTS,
    providers: PROVIDERS,
  };
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

// ── 认证 ──
//
// 分发出去的用户机器上没有 Claude Code 登录态，只能靠 API key。存在 userData 下，
// 启动后端时注入到子进程环境；A 的 adapter 会把它转交给 agent（base-adapter 的 authEnvMap）。

/**
 * 模型服务商。
 *
 * Claude Code 只会说 **Anthropic 的 Messages API** —— 不能直接塞一个 DeepSeek 的 key 进去。
 * 但它认 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`，所以任何提供
 * **Anthropic 兼容端点**的服务都能接（DeepSeek 官方就提供了一个）。
 *
 * 模型名会变（deepseek-v4-pro 之类），所以 defaults 只是预填，用户可改。
 */
const PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic（官方）',
    keyLabel: 'Anthropic API Key',
    keyHint: '以 sk-ant- 开头',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleName: 'Anthropic Console',
    /** 官方端点：不需要 base URL / 模型名，直接用 ANTHROPIC_API_KEY */
    baseUrl: '',
    editableBaseUrl: false,
    defaultModel: '',
    defaultFastModel: '',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    keyLabel: 'DeepSeek API Key',
    keyHint: '以 sk- 开头',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    consoleName: 'DeepSeek 开放平台',
    baseUrl: 'https://api.deepseek.com/anthropic',
    editableBaseUrl: false,
    defaultModel: 'deepseek-v4-pro',
    defaultFastModel: 'deepseek-v4-flash',
  },
  {
    id: 'custom',
    name: '自定义（Anthropic 兼容端点）',
    keyLabel: 'API Key / Token',
    keyHint: '',
    consoleUrl: '',
    consoleName: '',
    baseUrl: '',
    editableBaseUrl: true,
    defaultModel: '',
    defaultFastModel: '',
  },
];

/**
 * 随包分发的 agent。
 *
 * 打包版只带了 claude —— 其余 agent（gemini / codex …）的 CLI 要靠 npx 现拉，
 * 而打包后的机器上没有 npx。**不要列出来给用户选一个跑不起来的东西**。
 */
const AGENTS = [{ id: 'claude', name: 'Claude Code' }];

/** 当前服务商 + 它的配置（key / baseUrl / model）。 */
function currentProvider() {
  const s = readSettings();
  const id = s.provider ?? 'anthropic';
  const def = PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
  const cfg = s.providers?.[id] ?? {};
  return {
    def,
    key: cfg.key ?? '',
    baseUrl: def.editableBaseUrl ? (cfg.baseUrl ?? '') : def.baseUrl,
    model: cfg.model || def.defaultModel,
    fastModel: cfg.fastModel || def.defaultFastModel || cfg.model || def.defaultModel,
  };
}

/**
 * 本机是否已有 Claude Code 的登录态（开发机常见）。
 * 只有走 Anthropic 官方端点时才算数 —— 指向 DeepSeek 却用本机 Anthropic 登录态是矛盾的。
 */
function hasLocalCredentials(providerId) {
  if (providerId !== 'anthropic') return false;
  try {
    return fs.existsSync(path.join(app.getPath('home'), '.claude', '.credentials.json'));
  } catch {
    return false;
  }
}

/** 配置是否完整：非官方端点必须同时有 key / baseUrl / model，缺一不可。 */
function providerComplete(p) {
  if (!p.key) return false;
  if (p.def.id === 'anthropic') return true;
  return !!p.baseUrl && !!p.model;
}

/** 认证是否就绪：配置完整，或本机已有登录态。 */
function authState() {
  const p = currentProvider();
  const local = hasLocalCredentials(p.def.id);
  return {
    providerId: p.def.id,
    hasKey: !!p.key,
    /** 填了 key 但 baseUrl/模型没填全 —— 界面要能指出来，别让人以为配好了 */
    incomplete: !!p.key && !providerComplete(p),
    hasLocalCredentials: local,
    ready: providerComplete(p) || local,
    /** 回显给界面（不含 key） */
    baseUrl: p.baseUrl,
    model: p.model,
    fastModel: p.fastModel,
  };
}

/**
 * 认证环境变量。
 *
 * 返回 `unset`：走第三方端点时必须**清掉** ANTHROPIC_API_KEY 与本机登录态相关的变量 ——
 * 否则 Claude Code 可能优先拿它去打 Anthropic 官方，用户会看到一个莫名其妙的 401，
 * 而且完全想不到是因为「本机还留着旧凭据」。
 */
function readAuthEnv() {
  const p = currentProvider();
  if (!providerComplete(p)) return { set: {}, unset: [] };

  if (p.def.id === 'anthropic') {
    return { set: { ANTHROPIC_API_KEY: p.key }, unset: ['ANTHROPIC_BASE_URL'] };
  }

  return {
    set: {
      ANTHROPIC_BASE_URL: p.baseUrl,
      ANTHROPIC_AUTH_TOKEN: p.key,
      ANTHROPIC_MODEL: p.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: p.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: p.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: p.fastModel,
      CLAUDE_CODE_SUBAGENT_MODEL: p.fastModel,
    },
    unset: ['ANTHROPIC_API_KEY'],
  };
}

/** 还没选项目时的兜底工作区（与 fsBridge 的默认工作区同根）。 */
function defaultWorkspace() {
  return path.join(app.getPath('documents'), 'polaris-workspace', 'default');
}

/** 后端启动前的硬前置：BCD 若找不到 ACP runner 会在启动瞬间抛异常并退出。 */
function preflight() {
  const missing = [
    [NODE_BIN, 'Node 运行时'],
    [BACKEND_HOST, 'BCD 后端'],
    [ACP_RUNNER, 'ACP runner'],
    [AGENT_DIR, 'agent 运行时'],
  ].find(([p]) => !fs.existsSync(p));

  if (missing) {
    const hint = isDev ? '\n开发环境请先运行：pnpm build:backend' : '';
    return `后端不完整，缺少${missing[1]}：${missing[0]}${hint}`;
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

  // 只认随包分发的 agent。A 的其余 adapter（gemini/codex/…）默认命令是 `npx -y …`，
  // 而打包后的机器上没有 npx —— 放进去只会换来一个 ENOENT。宁可在这里就说清楚。
  if (!AGENTS.some((a) => a.id === resolvedAgentId)) {
    setStatus(
      'error',
      `未知的 agent「${resolvedAgentId}」；本版本只随包分发：${AGENTS.map((a) => a.id).join('、')}`,
    );
    return;
  }

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
  // 先记下目标配置，再置 starting —— setStatus 会把 workspace 一起播给渲染层，
  // 早一步记下，界面在「启动中」阶段就能显示 agent 即将写入哪个目录。
  currentConfig = { workspace: resolvedWorkspace, agentId: resolvedAgentId };
  setStatus('starting');

  // agent 的写工具（ACP fs/write_text_file）不会 mkdir 工作区本身 —— 目录不存在时
  // 它的 edit 调用直接失败，最终表现为一个语焉不详的 DRIVER_FAILED。这里先建好。
  try {
    fs.mkdirSync(resolvedWorkspace, { recursive: true });
  } catch (err) {
    setStatus('error', `无法创建 agent 工作区 ${resolvedWorkspace}：${err.message}`);
    return;
  }

  // BCD 把审计（.newide/runs）和物化产物（.newide/worktrees）写在 **cwd 的相对路径**下，
  // 而且这个默认值散在好几处（coordinator / run-audit-writer / run-terminal-output-writer /
  // council 输出各有一份），逐个注入是打地鼠。直接把 cwd 挪到 userData 下的状态目录，
  // 所有相对默认值自然跟着走 —— 一处改动，全覆盖，且不用动 BCD 一行源码。
  //
  // 为什么必须挪：原来的 cwd 是包内 backend 目录，也就是**已安装的应用目录**。今天没炸只是因为
  // NSIS 默认装到 %LOCALAPPDATA%\Programs 恰好可写；一旦按机器安装（Program Files）或 macOS
  // 只读挂载，mkdir 直接 EPERM，而 BCD 把它吞进 try/catch 变成 MATERIALIZATION_FAILED ——
  // 又是一次没有报错栈的静默失败。而且每次自动更新都会把这些产物冲掉。
  const stateDir = path.join(app.getPath('userData'), 'backend-state');
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (err) {
    setStatus('error', `无法创建后端状态目录 ${stateDir}：${err.message}`);
    return;
  }

  const auth = readAuthEnv();
  const env = {
    ...process.env,
    // 后端宿主自己会据此拼出 agent 的路径（见 electron/backend-host.ts）
    POLARIS_NODE_BIN: NODE_BIN,
    POLARIS_ACP_RUNNER: ACP_RUNNER,
    POLARIS_AGENT_DIR: AGENT_DIR,
    POLARIS_STATE_DIR: stateDir,
    ACP_AGENT_ID: resolvedAgentId,
    ACP_WORKSPACE: resolvedWorkspace,
    // 用户在设置里配的服务商 + key —— 分发出去的用户没有本机登录态，只能靠它认证
    ...auth.set,
  };
  // 走第三方端点时必须**删掉** ANTHROPIC_API_KEY（而不是置空）——
  // 留着它 Claude Code 可能优先拿去打 Anthropic 官方，用户会看到一个莫名其妙的 401，
  // 而且完全想不到是「本机还留着旧凭据」。
  for (const name of auth.unset) delete env[name];

  // 直接用包内的 Node 跑编译好的后端 —— 不再经过 pnpm（打包后的机器上没有 pnpm）。
  // cwd 落在 stateDir（见上）：BCD 所有相对路径的产物都写在那里，不碰安装目录。
  // detached：后端还会 spawn agent 子进程，按进程组杀才不留孤儿（见 stop）。
  const proc = spawn(NODE_BIN, [BACKEND_HOST], {
    cwd: stateDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // shell:false —— 直接执行二进制。Windows 上开 shell 反而会因路径含空格出问题。
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

  // 未响应的调用必须当场拒绝。
  //
  // 不能指望子进程的 exit handler 来做这件事：那个 handler 一开头就是 `if (!isCurrent()) return`，
  // 而 stop() 已经把 child 置空、start() 随后又同步把 child 指向新进程 —— 等旧进程的 exit
  // 真正到达时 isCurrent() 早就是 false 了，拒绝逻辑被整段跳过。
  // 结果是调用方挂满 60 秒，最后拿到一句驴唇不对马嘴的「RPC 超时」，而真相是「后端被重启了」。
  for (const { reject } of pending.values()) {
    reject(new Error('BCD 后端已重启或退出，本次调用未完成'));
  }
  pending.clear();

  // 杀掉整棵进程树：BCD 底下还挂着 A（ACP runner）和真实 agent CLI，只杀 BCD 会留下孤儿 ——
  // 孤儿 agent 会继续往**旧工作区**写文件，而用户已经切到别的项目了。
  try {
    if (process.platform === 'win32' && dying.pid) {
      // Windows 没有进程组信号。dying.kill() 只结束 BCD 自己，claude.exe 会活下来继续写盘。
      // taskkill /T 才是杀整棵树（A 自己的 terminal-handler 也是这么干的）。
      spawn('taskkill', ['/T', '/F', '/PID', String(dying.pid)], { stdio: 'ignore' }).on(
        'error',
        () => dying.kill(),
      );
    } else if (dying.pid) {
      process.kill(-dying.pid, 'SIGTERM'); // 按进程组杀（spawn 时 detached，BCD 即组长）
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

  // 设置：agent 的 API key。存 userData，不进仓库、不进日志。
  // 读设置：**绝不把 key 本身回给渲染层**，只回「填没填」+ baseUrl/模型这些非机密项。
  ipcMain.handle('backend:getSettings', () => {
    const s = readSettings();
    return {
      provider: s.provider ?? 'anthropic',
      // 每个服务商各自的配置（key 一律只回布尔）
      configured: Object.fromEntries(
        PROVIDERS.map((p) => {
          const cfg = s.providers?.[p.id] ?? {};
          return [
            p.id,
            {
              hasKey: !!cfg.key,
              baseUrl: p.editableBaseUrl ? (cfg.baseUrl ?? '') : p.baseUrl,
              model: cfg.model || p.defaultModel,
              fastModel: cfg.fastModel || p.defaultFastModel,
            },
          ];
        }),
      ),
    };
  });

  /**
   * 存设置。
   *
   * key 传空串 = 删除该服务商的 key；不传 key = 保留原值（切服务商 / 改模型时不必重填 key）。
   * 存完必须重启后端 —— 子进程的环境变量只在启动时读一次。
   */
  ipcMain.handle('backend:saveSettings', async (_event, next = {}) => {
    const current = readSettings();
    const providers = { ...(current.providers ?? {}) };

    for (const [id, patch] of Object.entries(next.providers ?? {})) {
      if (!PROVIDERS.some((p) => p.id === id)) continue; // 未知服务商：忽略，不写进配置
      const cfg = { ...(providers[id] ?? {}) };
      if (typeof patch.key === 'string') {
        if (patch.key === '') delete cfg.key;
        else cfg.key = patch.key;
      }
      if (typeof patch.baseUrl === 'string') cfg.baseUrl = patch.baseUrl.trim();
      if (typeof patch.model === 'string') cfg.model = patch.model.trim();
      if (typeof patch.fastModel === 'string') cfg.fastModel = patch.fastModel.trim();
      providers[id] = cfg;
    }

    // 只提交本模块负责的两个顶层键：settings.cjs 的合并语义会保留 python 等其它顶层块，
    // 且写入是串行的 —— 与 Python 安装器的并发回写不会互相吃掉对方（这正是原实现的 bug）。
    await writeSettings({
      providers,
      provider: next.provider ?? current.provider ?? 'anthropic',
    });

    start(currentConfig ?? {}, { force: true });
    return status;
  });

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
