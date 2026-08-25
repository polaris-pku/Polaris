// 由 electron/preload.cjs 通过 contextBridge 注入的桌面桥接 API 类型
export {};

declare global {
  /** 主进程推送的自动更新事件 */
  type UpdateEvent =
    | { type: 'checking' }
    | { type: 'available'; version?: string }
    | { type: 'not-available' }
    | { type: 'progress'; percent: number }
    | { type: 'downloaded'; version?: string }
    | { type: 'error'; message: string };

  /** fs:writeTextFile 的入参（对齐 ACP fs/write_text_file 的 {path,content}，外加写入根定位） */
  type DesktopWriteTextFilePayload = {
    projectName: string;
    /** 用户自定义项目根目录（须经 chooseDirectory 授权）；缺省写入 文档/polaris-workspace/<项目名>/ */
    rootPath?: string;
    path: string;
    content: string;
  };

  /** fs:writeTextFile 的结果：成功回绝对路径，失败回错误消息（主进程内已兜底 try/catch） */
  type DesktopWriteTextFileResult = { ok: true; absPath: string } | { ok: false; error: string };

  /** fs:readTextFile 的入参（与写入同一目标解析：默认工作区或已授权自定义根目录） */
  type DesktopReadTextFilePayload = {
    projectName: string;
    rootPath?: string;
    path: string;
  };

  /** fs:readTextFile 的结果：文本内容 + 绝对路径；不存在/超大/二进制返回错误消息 */
  type DesktopReadTextFileResult =
    | { ok: true; content: string; absPath: string }
    | { ok: false; error: string };

  /** fs:chooseDirectory 的结果（取消返回 null）；选择即授权该目录的读写 */
  type DesktopChosenDirectory = { path: string; name: string };

  /** fs:readDirectoryTree 的结果：目录树（与 UI FileNode 同形），超限截断时 truncated 为 true */
  type DesktopDirectoryTreeResult =
    | { ok: true; tree: Array<{ name: string; children?: unknown[] }>; truncated: boolean }
    | { ok: false; error: string };

  /** backend:call 的结果信封（主进程已兜底 try/catch，错误不抛到渲染层） */
  type DesktopBackendCallResult =
    | { ok: true; result: unknown }
    | { ok: false; error: string; code?: number; data?: unknown };

  /** 随包分发的 agent */
  type DesktopAgent = { id: string; name: string };

  /** 模型服务商（Anthropic 官方 / DeepSeek / 自定义 Anthropic 兼容端点） */
  type DesktopProvider = {
    id: string;
    name: string;
    keyLabel: string;
    keyHint: string;
    consoleUrl: string;
    consoleName: string;
    baseUrl: string;
    editableBaseUrl: boolean;
    defaultModel: string;
    defaultFastModel: string;
  };

  /** 认证状态：没就绪的话，用户提交需求必然失败 —— 界面要能提前拦住 */
  type DesktopAuthState = {
    providerId: string;
    hasKey: boolean;
    /** 填了 key 但 baseUrl/模型没填全 */
    incomplete: boolean;
    /** 本机已有 Claude Code 登录态（只对 Anthropic 官方端点有效） */
    hasLocalCredentials: boolean;
    ready: boolean;
    baseUrl: string;
    model: string;
    fastModel: string;
  };

  /** 某个服务商已保存的配置（key 只回布尔，绝不回明文） */
  type DesktopProviderConfig = {
    hasKey: boolean;
    baseUrl: string;
    model: string;
    fastModel: string;
  };

  /**
   * Embedding 运行时配置（与对话模型完全分开：走 EMBEDDING_API_KEY / EMBEDDING_BASE_URL，
   * 不共用 provider 的 key）。
   *
   * - `hash`：确定性哈希占位向量，不打任何外部服务，也不需要 key。语义检索在它下面
   *   只是在比哈希碰撞 —— 能跑通链路，但召回没有意义。
   * - `openai`：BCD 的 LiteLLM 只实现了 openai 形状的嵌入端点；任何 openai 兼容服务
   *   都可以通过 baseUrl 接上。
   *
   * `dimensions` 会被拼进建表语句 `vector(N)`，**改它等于换一张表** —— 见设置里的提示。
   */
  type DesktopEmbeddingConfig = {
    provider: 'hash' | 'openai';
    model: string;
    baseUrl: string;
    dimensions: number;
    hasKey: boolean;
  };

  /** BCD 后端子进程的运行状态 */
  type DesktopBackendStatus = {
    state: 'stopped' | 'starting' | 'ready' | 'error';
    message: string;
    /** agent 当前的工作区绝对路径（即「文件会写到哪」）。空 = 后端未启动。 */
    workspace: string;
    auth: DesktopAuthState;
    agents: DesktopAgent[];
    providers: DesktopProvider[];
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Python 运行时 + 终端（electron/pythonBridge.cjs / electron/terminalBridge.cjs 的手写镜像）
  //
  // ⚠️ electron/*.cjs 不在 tsconfig 的 include 里 —— typecheck 抓不到主进程侧的 payload 形状漂移。
  //    这一层声明是渲染层与主进程之间**唯一**的类型契约，改主进程时必须同步改这里。
  // ───────────────────────────────────────────────────────────────────────────

  /** 一个可用的 Python 运行时。runtimeId 对渲染层是不透明的（主进程持有 id→absBin 白名单，I2）。 */
  type PyRuntime = {
    /** 'managed:cpython-3.13.14' | 'system:0' | 'manual:0' —— 渲染层不许解析它 */
    id: string;
    /** '3.13.14' */
    version: string;
    source: 'managed' | 'system' | 'manual';
    /** 明文显示给用户看（manual 是全仓唯一一处「授权跨重启存活」，必须让用户看见它指向哪） */
    displayPath: string;
    /** 仅 managed */
    sizeBytes?: number;
    /** 仅 managed 为 true —— 系统 Python 我们无权动它 */
    removable: boolean;
  };

  /** 可一键安装的运行时条目（来自 electron/python-catalog.json，sha256 随代码提交） */
  type PyCatalogItem = {
    /** 'cpython-3.13.14' */
    catalogId: string;
    version: string;
    downloadBytes: number;
    installedBytes: number;
    installed: boolean;
    recommended: boolean;
    /** 该平台在 catalog 里没有对应 asset —— 一等状态，绝不静默失败 */
    unavailable?: boolean;
  };

  /** 安装进度。相位名必须是文字（用户卡住时要知道是卡在下载还是解包），不是纯 spinner。 */
  type PyInstallState = {
    catalogId: string;
    phase: 'download' | 'verify' | 'extract' | 'done' | 'error';
    percent: number;
    message?: string;
  };

  /** py:getState 的快照（不是信封）—— 补齐早于订阅到达的事件 */
  type PyState = {
    runtimes: PyRuntime[];
    selectedId: string | null;
    install: PyInstallState | null;
    catalog: PyCatalogItem[];
  };

  /** py:event 推送 */
  type PyEvent = PyInstallState & {
    receivedBytes?: number;
    totalBytes?: number;
    entries?: number;
  };

  /**
   * term:start 的入参。
   * 【I1】没有 absPath —— path 是**项目内相对路径**，主进程再过一次 resolveProjectRoot + isInside。
   * 【I4】没有 args —— argv 由主进程构造（script → ['-u', abs]；repl → ['-i','-u']）。
   *       渲染层能传一个 '-c' 就能打穿「代码必须是磁盘上一个可见文件」这条不变量。
   */
  type DesktopTermStartPayload = {
    projectName: string;
    /** 用户自定义项目根目录（须经 fs:chooseDirectory 授权）；缺省回落默认工作区/<项目名> */
    rootPath?: string;
    /** 不透明 id，主进程查白名单换成真实解释器路径（I2） */
    runtimeId: string;
    kind: 'script' | 'repl';
    /** 仅 kind:'script'：项目内相对路径 */
    path?: string;
    title?: string;
  };

  type DesktopTermStartResult =
    | { ok: true; sessionId: string }
    | { ok: false; error: string; code?: string };

  type TermSessionStatus = 'running' | 'exited' | 'killed' | 'error';

  type TermSession = {
    sessionId: string;
    title: string;
    status: TermSessionStatus;
    runtimeId: string;
    /** 绝对路径，仅用于显示。cwd 恒为项目根 —— 与 agent 的 ACP_WORKSPACE 同根 */
    cwd: string;
    exitCode: number | null;
    durationMs: number;
    /** ring buffer 回放（最后 2000 行）—— 渲染层重挂载时用它把 xterm 填回去 */
    replay: string;
  };

  /** term:event 推送（每 namespace 只有一个通道，靠 sessionId 区分） */
  type TermEvent =
    | { sessionId: string; kind: 'data'; chunk: string }
    | {
        sessionId: string;
        kind: 'exit';
        code: number | null;
        signal: string | null;
        durationMs: number;
      }
    | { sessionId: string; kind: 'error'; message: string }
    | { sessionId: string; kind: 'truncated' };

  interface DesktopBridge {
    isDesktop: true;
    platform: NodeJS.Platform;
    versions: {
      electron: string;
      chrome: string;
      node: string;
    };
    fs: {
      /** 把 agent 生成的文本写入项目根目录（默认工作区或已授权的自定义目录，越界路径被主进程拒绝） */
      writeTextFile: (payload: DesktopWriteTextFilePayload) => Promise<DesktopWriteTextFileResult>;
      /** 读取项目内文本文件供预览（同一授权模型；不存在/超大/二进制返回错误） */
      readTextFile: (payload: DesktopReadTextFilePayload) => Promise<DesktopReadTextFileResult>;
      /** 原生目录选择器（选择即授权）；取消返回 null */
      chooseDirectory: (options?: { title?: string }) => Promise<DesktopChosenDirectory | null>;
      /** 把已授权目录扫描为文件树（打开磁盘项目用） */
      readDirectoryTree: (rootPath: string) => Promise<DesktopDirectoryTreeResult>;
      /** 在系统文件管理器中定位已写入的文件（仅工作区/已授权目录内路径生效） */
      reveal: (absPath: string) => Promise<void>;
    };
    /** BCD 后端桥（electron/backendBridge.cjs）：JSON-RPC over stdio 的 IPC 转发 */
    backend: {
      /** 调用 BCD 的 RPC 方法（主进程侧有方法白名单） */
      call: (method: string, params?: unknown) => Promise<DesktopBackendCallResult>;
      /** 拉取后端进程状态（挂载时补齐早于订阅发生的状态） */
      getStatus: () => Promise<DesktopBackendStatus>;
      /**
       * 把 agent 工作区绑到某个项目并重启后端（BCD 只在启动时读 ACP_WORKSPACE）。
       * 落点解析复用主进程 fsBridge：自定义 rootPath 须已授权，否则回落 默认工作区/<项目名>。
       */
      configure: (options: {
        projectName?: string;
        rootPath?: string;
        agentId?: string;
      }) => Promise<DesktopBackendStatus>;
      /** 重启后端进程 */
      restart: () => Promise<DesktopBackendStatus>;
      /** 读设置（key 只回布尔，绝不回明文） */
      getSettings: () => Promise<{
        provider: string;
        bMemory: { configured: boolean };
        embedding: DesktopEmbeddingConfig;
        configured: Record<string, DesktopProviderConfig>;
      }>;
      /**
       * 存设置（换服务商 / 改 key / 改模型）；存完自动重启后端使其生效。
       * key 传空串 = 删除；不传 key = 保留原值（切服务商、改模型时不必重填）。
       */
      saveSettings: (next: {
        provider?: string;
        bMemory?: { databaseUrl?: string };
        embedding?: {
          provider?: 'hash' | 'openai';
          model?: string;
          baseUrl?: string;
          dimensions?: number;
          apiKey?: string;
        };
        providers?: Record<
          string,
          { key?: string; baseUrl?: string; model?: string; fastModel?: string }
        >;
      }) => Promise<DesktopBackendStatus>;
      /** 订阅 BCD 推来的 task.event / run.event；返回取消订阅函数 */
      onNotification: (
        cb: (notification: { method: 'task.event' | 'run.event'; params: unknown }) => void,
      ) => () => void;
      /** 订阅后端进程状态变化；返回取消订阅函数 */
      onStatus: (cb: (status: DesktopBackendStatus) => void) => () => void;
    };
    /**
     * Python 运行时管理（electron/pythonBridge.cjs）。
     * 可选：老版本主进程 / 未来的降级壳里可能没有 —— 渲染层用 pythonAvailable() 守。
     */
    python?: {
      /** 状态快照（挂载时补齐早于订阅发生的进度事件） */
      getState: () => Promise<PyState>;
      /** 重新探测系统解释器（探测不到是一等状态，绝不静默回落到「某个能跑的 python」） */
      detect: () => Promise<{ ok: true; runtimes: PyRuntime[] } | { ok: false; error: string }>;
      /** 选中某个运行时（持久化进 settings.json 的 python 块） */
      select: (runtimeId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      /**
       * 手动指定解释器：只能走主进程的 dialog.showOpenDialog —— 原生选择动作 = 授权动作（I2）。
       * 用户取消 → { ok: true, runtime: null }。渲染层永远无法传一个解释器路径字符串。
       */
      pickInterpreter: () => Promise<
        { ok: true; runtime: PyRuntime | null } | { ok: false; error: string }
      >;
      /** 一键安装（下载 → SHA-256 校验 → 解包 → 原子上架）；进度走 onEvent */
      install: (catalogId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      /** 取消进行中的安装（.tmp 会被清干净） */
      cancelInstall: () => Promise<{ ok: true }>;
      /** 卸载（仅 source==='managed' 可卸载） */
      uninstall: (runtimeId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      /** 订阅安装进度；返回取消订阅函数 */
      onEvent: (cb: (event: PyEvent) => void) => () => void;
    };
    /**
     * Python 终端会话（electron/terminalBridge.cjs）。
     * 【硬红线 R3/I5】start 只能由用户手势触发，**永远不能被 backend:notification 的 handler
     * 直接或间接调用** —— agent 会往工作区写 .py，任何事件驱动的自动执行 = agent → 宿主 RCE。
     */
    terminal?: {
      /** 新建会话（路径过 isInside 校验，argv 由主进程构造） */
      start: (req: DesktopTermStartPayload) => Promise<DesktopTermStartResult>;
      /** 往 stdin 写原样字节（≤ 8KB/次）。xterm 只是渲染器，不解析、不执行（I13） */
      write: (
        sessionId: string,
        data: string,
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      /**
       * 中断 / 终止。
       * POSIX：interrupt = 按进程组发 SIGINT（python 真的打出 KeyboardInterrupt）。
       * Windows：**没有真正的中断信号** —— 一律 taskkill /T /F，UI 上按钮必须叫「停止」（I11）。
       */
      signal: (
        sessionId: string,
        signal: 'interrupt' | 'kill',
      ) => Promise<{ ok: true } | { ok: false; error: string }>;
      /** 关闭并清理会话 */
      dispose: (sessionId: string) => Promise<{ ok: true }>;
      /** 会话快照（含 ring buffer 回放）—— 没有它，「重挂载后终端一片空白」会立刻复现 */
      list: () => Promise<{ sessions: TermSession[] }>;
      /** 订阅终端事件；返回取消订阅函数 */
      onEvent: (cb: (event: TermEvent) => void) => () => void;
    };
    /** 原生菜单（仅 macOS 有菜单；Win/Linux 是 setApplicationMenu(null)） */
    menu?: {
      /** 菜单要求应用内导航（如 'help/python-terminal'）；返回取消订阅函数 */
      onNavigate: (cb: (route: string) => void) => () => void;
    };
    updates: {
      /** 订阅更新事件；返回取消订阅函数 */
      onEvent: (cb: (event: UpdateEvent) => void) => () => void;
      /** 拉取当前更新状态（挂载时补齐早于订阅发生的事件） */
      getState: () => Promise<UpdateEvent | null>;
      /** 用户确认后开始下载更新（Windows 自动安装路径） */
      download: () => Promise<void>;
      /** 打开 Releases 最新页手动下载（macOS 未签名，走此路径） */
      openDownloadPage: () => Promise<void>;
      /** 立即重启并安装已下载的更新 */
      restart: () => Promise<void>;
      /** 手动触发一次检查 */
      check: () => Promise<void>;
    };
  }

  interface Window {
    /** 仅在 Electron 桌面壳中存在；浏览器里为 undefined */
    desktop?: DesktopBridge;
  }
}
