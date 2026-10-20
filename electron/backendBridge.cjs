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
const { drainBackend } = require('./backendLifecycle.cjs');
const { readModelProxyConfig, resolveModelProxyConfig } = require('./modelProxy.cjs');
let resolvedProxy;
const CREDENTIAL_ENV_NAMES = [
  'NEWIDE_LLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_PROFILE',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
];

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
const ACP_RUNNER_DIR = path.join(BACKEND_DIR, 'acp-runner');
const LITELLM_CONFIG_DIR = path.join(BACKEND_DIR, 'config');
const AGENT_DIR = path.join(BACKEND_DIR, 'agent');

const RPC_METHODS = require('./backend-rpc-methods.json');
const RPC_METHOD_SET = new Set(RPC_METHODS);
const RPC_NOTIFICATIONS = new Set(['task.event', 'run.event']);

/** @type {import('child_process').ChildProcess | null} */
let child = null;
let lifecycle = Promise.resolve();
const expectedExits = new WeakSet();
let nextId = 1;
/** @type {Map<number, {resolve: Function, reject: Function}>} */
const pending = new Map();
const activeCalls = new Set();
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
    const waiter = {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    readyWaiters.push(waiter);
    const timer = setTimeout(() => {
      const i = readyWaiters.indexOf(waiter);
      if (i >= 0) {
        readyWaiters.splice(i, 1);
        reject(new Error('等待 BCD 后端就绪超时'));
      }
    }, timeoutMs);
  });
}

function pushNotification(method, params) {
  getWindow()?.webContents.send('backend:notification', { method, params });
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
    id: 'local-proxy',
    name: '本地代理测试（无凭据）',
    keyLabel: '无需 API Key',
    keyHint: '使用本机已登录的模型代理，不发送 API Key。',
    consoleUrl: '',
    consoleName: '',
    baseUrl: '',
    editableBaseUrl: true,
    defaultModel: '',
    defaultFastModel: '',
  },
  {
    id: 'anthropic',
    name: 'Anthropic（官方）',
    keyLabel: 'Anthropic API Key',
    keyHint: '以 sk-ant- 开头',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleName: 'Anthropic Console',
    baseUrl: '',
    editableBaseUrl: false,
    defaultModel: 'claude-opus-5',
    defaultFastModel: 'claude-haiku-4-5',
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
  const def = PROVIDERS.find((p) => p.id === id) ?? PROVIDERS.find((p) => p.id === 'anthropic');
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
function hasLocalCredentials() {
  return false;
}

/** 配置是否完整：非官方端点必须同时有 key / baseUrl / model，缺一不可。 */
function providerComplete(p) {
  if (!p.key) return false;
  return !!p.model && (p.def.id === 'anthropic' || !!p.baseUrl);
}

/** 认证是否就绪：配置完整，或本机已有登录态。 */
function authState() {
  try {
    const proxy = readModelProxyConfig(readSettings());
    if (proxy) {
      return {
        providerId: 'local-proxy',
        hasKey: false,
        incomplete: !resolvedProxy,
        hasLocalCredentials: false,
        ready: !!resolvedProxy,
        baseUrl: proxy.root,
        model: proxy.model,
        fastModel: proxy.model,
      };
    }
  } catch (error) {
    return {
      providerId: 'local-proxy',
      hasKey: false,
      incomplete: true,
      hasLocalCredentials: false,
      ready: false,
      baseUrl: '',
      model: '',
      fastModel: '',
      error: error.message,
    };
  }
  const p = currentProvider();
  const local = hasLocalCredentials();
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
 * 只服务 Polaris 内部调用（规划 / 记忆 / 合议），不会注入 driver。
 * driver（Claude Code）使用它自己的配置（~/.claude/settings.json、环境变量）。
 * 不覆盖、不删除用户 shell 里已有的 ANTHROPIC_* 变量。
 */
function readAuthEnv() {
  if (resolvedProxy) {
    return {
      set: {
        POLARIS_MODEL_PROXY_BASE_URL: resolvedProxy.root,
        POLARIS_MODEL_PROXY_MODEL: resolvedProxy.model,
        NEWIDE_LLM_PROVIDER: 'anthropic',
        NEWIDE_LLM_MODEL: resolvedProxy.model,
        NEWIDE_LLM_BASE_URL: resolvedProxy.apiBase,
        NEWIDE_LLM_CREDENTIALLESS: '1',
      },
      unset: CREDENTIAL_ENV_NAMES,
    };
  }
  const p = currentProvider();
  if (!providerComplete(p) && !hasLocalCredentials()) return { set: {}, unset: [] };

  const model = p.model || 'claude-opus-5';
  // 只有官方 'anthropic' provider 才注入 ANTHROPIC_BASE_URL（BCD 会识别它走 anthropic.messages）。
  // 'custom' 端点是用户自配的第三方 OpenAI 兼容服务，走 OpenAI 接口；不应强制改成 Anthropic。
  const isAnthropicProvider = p.def.id === 'anthropic';
  const anthropicBaseUrl = isAnthropicProvider && p.baseUrl
    ? p.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
    : '';

  // ANTHROPIC_AUTH_TOKEN：只有 custom provider 才注入（用户明确配置了 key），
  // 'anthropic' 官方和 'deepseek' 保持不注入，让 BCD 的 resolveProductionLlmRuntime
  // fallback 到 driver 的 token。
  const shouldInjectAuthToken = p.def.id === 'custom' && Boolean(p.key);

  return {
    set: {
      // 只服务 Polaris 内部调用，不会进入 driver。
      // NEWIDE_LLM_API_KEY 是 BCD resolveProductionLlmRuntime 的专用通道信号。
      ...(shouldInjectAuthToken ? { NEWIDE_LLM_API_KEY: p.key } : {}),
      ...(anthropicBaseUrl ? { ANTHROPIC_BASE_URL: anthropicBaseUrl } : {}),
      ...(shouldInjectAuthToken ? { ANTHROPIC_AUTH_TOKEN: p.key } : {}),
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: p.fastModel || model,
      CLAUDE_CODE_SUBAGENT_MODEL: p.fastModel || model,
    },
    // 不覆盖、不删除 driver 已有的 ANTHROPIC_*：它们属于 driver 自己
    unset: [],
  };
}

/**
 * Embedding 配置的默认值：确定性哈希向量，32 维，不打任何外部服务。
 *
 * 这是**能离线跑通**的配置，不是好配置 —— HashEmbeddingProvider 产出的是哈希占位向量，
 * 语义检索（memory.searchMemory / marketSearch）在它下面只是在比哈希碰撞。想要真正的
 * 语义召回必须在设置里换成 openai 端点。默认留 hash 是因为它不需要任何 key 就能起后端。
 */
const EMBEDDING_DEFAULTS = { provider: 'hash', dimensions: 32 };

/** 只认这两种 provider：hash（本地占位）与 openai（BCD 的 LiteLLM 只实现了 openai 嵌入）。 */
const EMBEDDING_PROVIDERS = ['hash', 'openai'];

/** 读出规范化后的 embedding 设置；任何非法值都退回默认，绝不让后端带着坏配置启动。 */
function readEmbeddingSettings() {
  const raw = readSettings().embedding ?? {};
  const provider = EMBEDDING_PROVIDERS.includes(raw.provider)
    ? raw.provider
    : EMBEDDING_DEFAULTS.provider;
  const dimensions =
    Number.isInteger(raw.dimensions) && raw.dimensions > 0
      ? raw.dimensions
      : provider === 'hash'
        ? EMBEDDING_DEFAULTS.dimensions
        : 1536;
  return {
    provider,
    dimensions,
    model: typeof raw.model === 'string' ? raw.model.trim() : '',
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : '',
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
  };
}

/**
 * 生成后端实际读取的 LiteLLM 配置目录，并返回它的路径。
 *
 * 为什么要复制一份而不是就地改 `BACKEND_DIR/config`：那是**已安装的应用目录**。
 * 按机器安装（Program Files）或 macOS 只读挂载下写它会 EPERM，而且每次自动更新都会被冲掉
 * —— 跟当初把 cwd 挪到 userData 是同一个理由。
 *
 * 覆盖手法：config-loader 把目录下所有 .yaml 按**文件名排序**合并，同名 task 后写的赢
 * （model-config.js 里是 Map.set）。所以只要落一个排序在最后的文件，就能盖掉包内
 * embedding.yaml 里写死的 `openai/text-embedding-v3`，不必改上游任何一行。
 */
function prepareLitellmConfigDir(stateDir, embedding) {
  const target = path.join(stateDir, 'litellm-config');
  fs.mkdirSync(target, { recursive: true });

  // 每次重建：包内配置可能随版本更新而变，残留的旧副本会悄悄盖住新默认值
  for (const name of fs.readdirSync(target)) {
    fs.rmSync(path.join(target, name), { force: true, recursive: true });
  }
  // 只复制文件：config-loader 只读顶层 .yaml，上游哪天塞进子目录也不该让这里抛
  for (const entry of fs.readdirSync(LITELLM_CONFIG_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(LITELLM_CONFIG_DIR, entry.name), path.join(target, entry.name));
  }

  // hash provider 根本不走 LiteLLM（production-b-runtime 在解析路由之前就短路了），
  // 不需要也不该写 embed 覆盖 —— 写了只会在用户切回 openai 时留下一个陈旧的模型名。
  if (embedding.provider === 'openai' && embedding.model) {
    // 文件名以 zz- 开头保证排序在最后（合并时后写的 task 赢）
    fs.writeFileSync(
      path.join(target, 'zz-polaris-embedding.yaml'),
      [
        '# 由 Polaris 设置生成，请勿手改 —— 每次启动后端都会重写。',
        'tasks:',
        '  embed:',
        '    models:',
        '      - provider: openai',
        `        model: ${JSON.stringify(embedding.model)}`,
        '        order: 1',
        '    strategy: order',
        '    timeoutMs: 30000',
        '    maxRetries: 2',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
  }
  return target;
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
    [ACP_RUNNER_DIR, 'ACP runner'],
    [LITELLM_CONFIG_DIR, '模型配置'],
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

async function startNow({ workspace, agentId } = {}, { force = false } = {}) {
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

  setStatus('starting');
  try {
    // PGlite 不允许两个进程同时打开同一数据目录。必须等旧 BCD 完成资源关闭后再启动，
    // 不能只发出终止信号就立刻 spawn 新进程。
    await stopChild({ restarting: true });
  } catch (err) {
    throw new Error(`无法停止旧 BCD 后端：${err.message}`, { cause: err });
  }
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
  const stateDir = path.join(app.getPath('userData'), 'backend-state', 'rpc-v1');
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (err) {
    setStatus('error', `无法创建后端状态目录 ${stateDir}：${err.message}`);
    return;
  }

  try {
    resolvedProxy = await resolveModelProxyConfig(readSettings());
  } catch (error) {
    resolvedProxy = undefined;
    setStatus('error', `本地代理测试不可用：${error.message}`);
    return;
  }
  const auth = readAuthEnv();
  if (!authState().ready) {
    setStatus('error', '请先在设置中完成模型与认证配置。');
    return;
  }
  // BCD 在没有显式 URL 时使用嵌入式 PGlite；设置或环境变量只作为外部 PostgreSQL 覆盖。
  const bDatabaseUrl =
    readSettings().bMemory?.databaseUrl?.trim() || process.env.NEWIDE_B_DATABASE_URL?.trim();
  const embedding = readEmbeddingSettings();
  let litellmConfigDir;
  try {
    litellmConfigDir = prepareLitellmConfigDir(stateDir, embedding);
  } catch (err) {
    setStatus('error', `无法准备模型配置目录：${err.message}`);
    return;
  }

  const env = {
    ...process.env,
    POLARIS_NODE_BIN: NODE_BIN,
    POLARIS_AGENT_DIR: AGENT_DIR,
    NODE_PATH: [path.join(BACKEND_DIR, 'pglite', 'node_modules'), process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter),
    NEWIDE_STATE_ROOT: stateDir,
    NEWIDE_COORDINATION_DB: path.join(stateDir, 'coordination.sqlite'),
    ...(bDatabaseUrl ? { NEWIDE_B_DATABASE_URL: bDatabaseUrl } : {}),
    // provider=hash 时 production-b-runtime 直接短路成 HashEmbeddingProvider；
    // 其它情况**必须不设这个变量**，否则走不到 LiteLLM 那条分支。
    ...(embedding.provider === 'hash' ? { NEWIDE_B_EMBEDDING_PROVIDER: 'hash' } : {}),
    NEWIDE_B_EMBEDDING_DIMENSIONS: String(embedding.dimensions),
    NEWIDE_LITELLM_CONFIG_DIR: litellmConfigDir,
    NEWIDE_BUILD_COMMIT: process.env.NEWIDE_BUILD_COMMIT || 'dev',
    ACP_DRIVER_RUNNER_DIR: ACP_RUNNER_DIR,
    ACP_DRIVER_ENV_FILE: path.join(stateDir, 'driver.env'),
    ACP_AGENT_ID: resolvedAgentId,
    ACP_WORKSPACE: resolvedWorkspace,
    NEWIDE_EPHEMERAL_ACP_SESSIONS: '0',
    // 超时默认值：覆盖 vendor 里的 120 秒限制
    NEWIDE_COUNCIL_ROLE_INACTIVITY_TIMEOUT_MS:
      process.env.NEWIDE_COUNCIL_ROLE_INACTIVITY_TIMEOUT_MS ?? '600000',
    ACP_DRIVER_INACTIVITY_TIMEOUT_MS:
      process.env.ACP_DRIVER_INACTIVITY_TIMEOUT_MS ?? '300000',
    NEWIDE_GATE_TIMEOUT_MS: process.env.NEWIDE_GATE_TIMEOUT_MS ?? '600000',
    ...auth.set,
  };
  // Embedding 的凭据与对话模型完全分开：litellm/client.ts 的 openai 嵌入分支只认
  // EMBEDDING_API_KEY / EMBEDDING_BASE_URL 这两个名字。缺 key 时不要塞空串 ——
  // @ai-sdk/openai 会退回读 OPENAI_API_KEY，塞空串反而把那条兜底路堵死。
  if (embedding.provider === 'openai') {
    if (embedding.apiKey) env.EMBEDDING_API_KEY = embedding.apiKey;
    if (embedding.baseUrl) env.EMBEDDING_BASE_URL = embedding.baseUrl;
  } else {
    delete env.EMBEDDING_API_KEY;
    delete env.EMBEDDING_BASE_URL;
  }

  // 走第三方端点时必须**删掉** ANTHROPIC_API_KEY（而不是置空）——
  // 留着它 Claude Code 可能优先拿去打 Anthropic 官方，用户会看到一个莫名其妙的 401，
  // 而且完全想不到是「本机还留着旧凭据」。
  for (const name of auth.unset) delete env[name];

  // 直接用包内的 Node 跑编译好的后端 —— 不再经过 pnpm（打包后的机器上没有 pnpm）。
  // cwd 落在 stateDir（见上）：BCD 所有相对路径的产物都写在那里，不碰安装目录。
  // detached：后端还会 spawn agent 子进程，按进程组杀才不留孤儿（见 stopChild）。
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
    if (!expectedExits.has(proc) && status.state !== 'error') {
      setStatus('error', `BCD 意外退出（code=${code}）`);
    }
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
    if (RPC_NOTIFICATIONS.has(msg.method)) {
      pushNotification(msg.method, msg.params);
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
  try {
    const res = await send('system.ping');
    const readiness = await send('system.readiness', {});
    if (!isCurrent()) return;
    if (!['operational', 'partial'].includes(readiness?.service?.status)) {
      throw new Error('后端 readiness 不可用，请检查运行配置。');
    }
    setStatus(
      'ready',
      resolvedProxy
        ? `本地代理测试：${resolvedProxy.model}（无凭据）`
        : `protocol ${res?.protocol_version ?? '?'}`,
    );
  } catch (err) {
    if (isCurrent()) {
      setStatus('error', `BCD 无响应：${err.message}${stderrTail ? `\n${stderrTail}` : ''}`);
    }
  }
}

function start(options = {}, control = {}) {
  const operation = lifecycle.then(() => startNow(options, control));
  lifecycle = operation.catch((error) => console.error('[backend] 启动失败：', error));
  return operation;
}

async function stopChild({ restarting = false } = {}) {
  if (!child) {
    currentConfig = null;
    return;
  }
  const dying = child;
  setStatus('starting', '正在停止并保存任务');
  const inFlight = [...activeCalls];
  expectedExits.add(dying);
  try {
    await drainBackend(dying, async (method, params) => {
      if (method === 'task.list') await Promise.allSettled(inFlight);
      return send(method, params);
    });
  } catch (error) {
    setStatus(child === dying ? 'ready' : 'error', `安全关闭未完成：${error.message}`);
    throw error;
  } finally {
    expectedExits.delete(dying);
  }
  if (child === dying) child = null;
  currentConfig = null;
  if (!restarting) setStatus('stopped', '后端已保存并退出');
}

function stopBackend() {
  const operation = lifecycle.then(() => stopChild());
  lifecycle = operation.catch((error) => console.error('[backend] 关闭失败：', error));
  return operation;
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
  if (!RPC_METHOD_SET.has(method)) {
    throw new Error(`未授权的 RPC 方法：${method}`);
  }
  const expected = status.state === 'ready' ? child : null;
  await waitForReady();
  if (status.state !== 'ready' || !child || (expected && child !== expected)) {
    throw new Error('后端连接已变化，请等待任务状态同步后重试。');
  }
  const request = send(method, params);
  activeCalls.add(request);
  try {
    return await request;
  } finally {
    activeCalls.delete(request);
  }
}

function setupBackendBridge(windowGetter) {
  getWindow = windowGetter;

  ipcMain.handle('backend:call', async (_event, { method, params }) => {
    try {
      return { ok: true, result: await call(method, params) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code, data: err.data };
    }
  });

  ipcMain.handle('backend:getStatus', () => status);

  // 设置：agent 的 API key。存 userData，不进仓库、不进日志。
  // 读设置：**绝不把 key 本身回给渲染层**，只回「填没填」+ baseUrl/模型这些非机密项。
  ipcMain.handle('backend:getSettings', () => {
    const s = readSettings();
    const embedding = readEmbeddingSettings();
    const savedDatabaseUrl = s.bMemory?.databaseUrl?.trim();
    const environmentDatabaseUrl = process.env.NEWIDE_B_DATABASE_URL?.trim();
    const databaseSource = savedDatabaseUrl
      ? 'settings'
      : environmentDatabaseUrl
        ? 'environment'
        : 'pglite';
    return {
      provider: authState().providerId,
      bMemory: {
        configured: databaseSource !== 'pglite',
        source: databaseSource,
        environmentConfigured: !!environmentDatabaseUrl,
      },
      // apiKey 与 provider key 同样只回布尔，明文不出主进程
      embedding: {
        provider: embedding.provider,
        model: embedding.model,
        baseUrl: embedding.baseUrl,
        dimensions: embedding.dimensions,
        hasKey: !!embedding.apiKey,
      },
      // 每个服务商各自的配置（key 一律只回布尔）
      configured: Object.fromEntries(
        PROVIDERS.map((p) => {
          if (p.id === 'local-proxy') {
            return [
              p.id,
              {
                hasKey: false,
                baseUrl: s.modelProxy?.baseUrl ?? '',
                model: s.modelProxy?.model ?? '',
                fastModel: s.modelProxy?.model ?? '',
              },
            ];
          }
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
    const modelProxy = { ...(current.modelProxy ?? {}) };
    if (next.provider !== undefined) modelProxy.enabled = next.provider === 'local-proxy';
    const proxyPatch = next.providers?.['local-proxy'];
    if (proxyPatch) {
      if (typeof proxyPatch.baseUrl === 'string') modelProxy.baseUrl = proxyPatch.baseUrl.trim();
      if (typeof proxyPatch.model === 'string') modelProxy.model = proxyPatch.model.trim();
    }

    for (const [id, patch] of Object.entries(next.providers ?? {})) {
      if (id === 'local-proxy') continue;
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
    const bMemory = { ...(current.bMemory ?? {}) };
    if (typeof next.bMemory?.databaseUrl === 'string') {
      if (next.bMemory.databaseUrl === '') delete bMemory.databaseUrl;
      else bMemory.databaseUrl = next.bMemory.databaseUrl.trim();
    }

    // Embedding：与 provider key 同一套「不传 = 保留原值，传空串 = 删除」语义。
    // 维度是数字，非法值一律忽略而不是写坏 —— 它会被拼进 `vector(N)` 的建表语句。
    const embedding = { ...(current.embedding ?? {}) };
    if (next.embedding && typeof next.embedding === 'object') {
      const patch = next.embedding;
      if (EMBEDDING_PROVIDERS.includes(patch.provider)) embedding.provider = patch.provider;
      if (typeof patch.model === 'string') embedding.model = patch.model.trim();
      if (typeof patch.baseUrl === 'string') embedding.baseUrl = patch.baseUrl.trim();
      if (Number.isInteger(patch.dimensions) && patch.dimensions > 0) {
        embedding.dimensions = patch.dimensions;
      }
      if (typeof patch.apiKey === 'string') {
        if (patch.apiKey === '') delete embedding.apiKey;
        else embedding.apiKey = patch.apiKey;
      }
    }

    await writeSettings({
      providers,
      modelProxy,
      bMemory,
      embedding,
      provider: next.provider ?? current.provider ?? 'anthropic',
    });

    await start(currentConfig ?? {}, { force: true });
    return status;
  });

  // 用户打开项目后把 agent 工作区绑到该项目根目录（BCD 只在启动时读 ACP_WORKSPACE，故需重启）。
  // 复用 fsBridge 的落点解析：agent 写进哪里 = E 观测面板读哪里。
  ipcMain.handle('backend:configure', async (_event, options = {}) => {
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
    await start({ workspace, agentId });
    return status;
  });

  // 手动重启：绕过同配置去重（用户点重启就是要真重启，比如刚补了 .env）。
  ipcMain.handle('backend:restart', async () => {
    await start(currentConfig || {}, { force: true });
    return status;
  });

  let quitAfterBackendStops = false;
  let quitInProgress = false;
  app.on('before-quit', (event) => {
    if (quitAfterBackendStops) return;
    event.preventDefault();
    if (quitInProgress) return;
    quitInProgress = true;
    void stopBackend()
      .then(() => {
        quitAfterBackendStops = true;
        app.quit();
      })
      .catch((err) => {
        quitInProgress = false;
        require('electron').dialog.showErrorBox('无法安全退出', err.message);
      });
  });

  void start({}).catch((error) => setStatus('error', error.message));
}

module.exports = { setupBackendBridge, stopBackend };
