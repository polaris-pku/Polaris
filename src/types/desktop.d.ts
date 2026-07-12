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
    | { ok: false; error: string; code?: number };

  /** BCD 后端子进程的运行状态 */
  type DesktopBackendStatus = {
    state: 'stopped' | 'starting' | 'ready' | 'error';
    message: string;
  };

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
      /** 订阅 BCD 推来的 run.event；返回取消订阅函数 */
      onEvent: (cb: (payload: { run_id: string; event: unknown }) => void) => () => void;
      /** 订阅后端进程状态变化；返回取消订阅函数 */
      onStatus: (cb: (status: DesktopBackendStatus) => void) => () => void;
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
