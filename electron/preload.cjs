// 预加载脚本：在隔离上下文里向渲染层暴露一个最小、安全的桌面 API。
// 后续真实文件系统 / 终端 / agent 能力都从这里桥接到主进程。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  fs: {
    /** 把 agent 生成的文本写入工作区（对齐 ACP fs/write_text_file：mkdir -p + 覆盖写） */
    writeTextFile: (payload) => ipcRenderer.invoke('fs:writeTextFile', payload),
    /** 读取项目内文本文件供预览（同一授权模型；超大/二进制拒绝） */
    readTextFile: (payload) => ipcRenderer.invoke('fs:readTextFile', payload),
    /** 原生目录选择器（选择即授权该目录的读写）；取消返回 null */
    chooseDirectory: (options) => ipcRenderer.invoke('fs:chooseDirectory', options),
    /** 把已授权目录扫描为文件树（打开磁盘项目用） */
    readDirectoryTree: (rootPath) => ipcRenderer.invoke('fs:readDirectoryTree', rootPath),
    /** 在系统文件管理器中定位已写入的文件 */
    reveal: (absPath) => ipcRenderer.invoke('fs:revealPath', absPath),
  },
  backend: {
    /** 调用 BCD 的 JSON-RPC 方法（主进程侧有方法白名单）；返回 {ok, result} 或 {ok:false, error} */
    call: (method, params) => ipcRenderer.invoke('backend:call', { method, params }),
    /** 拉取后端进程状态（挂载时补齐早于订阅发生的状态） */
    getStatus: () => ipcRenderer.invoke('backend:getStatus'),
    /** 把 agent 工作区绑到某个项目并重启后端（BCD 只在启动时读 ACP_WORKSPACE） */
    configure: (options) => ipcRenderer.invoke('backend:configure', options),
    /** 重启后端进程 */
    restart: () => ipcRenderer.invoke('backend:restart'),
    /** 读设置（只回「有没有填 key」，绝不回 key 本身） */
    getSettings: () => ipcRenderer.invoke('backend:getSettings'),
    /** 存设置（填 key / 换 agent）；存完自动重启后端使其生效 */
    saveSettings: (next) => ipcRenderer.invoke('backend:saveSettings', next),
    /** 订阅 BCD 推来的 run.event；返回取消订阅函数 */
    onEvent: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('backend:event', listener);
      return () => ipcRenderer.removeListener('backend:event', listener);
    },
    /** 订阅后端进程状态变化；返回取消订阅函数 */
    onStatus: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('backend:status', listener);
      return () => ipcRenderer.removeListener('backend:status', listener);
    },
  },
  // Python 运行时管理（探测 / 选择 / 手动指定 / 一键安装 / 卸载）。
  // 渲染层只见到不透明的 runtimeId / catalogId —— 绝不传解释器路径字符串（不变量 I2）。
  python: {
    /** 状态快照：已装运行时 / 选中项 / 安装进度 / 可安装目录（补齐早于订阅到达的事件） */
    getState: () => ipcRenderer.invoke('py:getState'),
    /** 重新探测系统解释器 */
    detect: () => ipcRenderer.invoke('py:detect'),
    /** 选中某个运行时（持久化进 settings.json 的 python 块） */
    select: (runtimeId) => ipcRenderer.invoke('py:select', { runtimeId }),
    /** 手动指定解释器：只能走主进程的原生文件选择器 —— 原生选择动作 = 授权动作（I2） */
    pickInterpreter: () => ipcRenderer.invoke('py:pickInterpreter'),
    /** 一键安装：下载 → SHA-256 校验 → 解包 → 原子上架；进度走 py:event */
    install: (catalogId) => ipcRenderer.invoke('py:install', { catalogId }),
    /** 取消进行中的安装 */
    cancelInstall: () => ipcRenderer.invoke('py:cancelInstall'),
    /** 卸载（仅 Polaris 托管的运行时可卸载；系统 Python 我们无权动） */
    uninstall: (runtimeId) => ipcRenderer.invoke('py:uninstall', { runtimeId }),
    /** 订阅安装进度；返回取消订阅函数 */
    onEvent: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('py:event', listener);
      return () => ipcRenderer.removeListener('py:event', listener);
    },
  },
  // Python 终端会话（child_process + 管道，不是 PTY）。
  // 【硬红线 R3/I5】start 只能由用户手势触发，永远不能出现在 backend:event 的调用链里。
  terminal: {
    /** 新建会话。入参没有 absPath、没有 args —— 路径过 isInside 校验、argv 由主进程构造（I1/I4） */
    start: (req) => ipcRenderer.invoke('term:start', req),
    /** 往会话 stdin 写原样字节（≤ 8KB/次）。只是渲染器的转发，不解析、不执行（I13） */
    write: (sessionId, data) => ipcRenderer.invoke('term:write', { sessionId, data }),
    /** 中断 / 终止会话（Windows 上没有真正的中断信号，实现是 taskkill /T /F，见 I11） */
    signal: (sessionId, signal) => ipcRenderer.invoke('term:signal', { sessionId, signal }),
    /** 关闭并清理会话 */
    dispose: (sessionId) => ipcRenderer.invoke('term:dispose', { sessionId }),
    /** 会话快照（含每个会话的 ring buffer 回放）—— 渲染层重挂载时把 xterm 填回去 */
    list: () => ipcRenderer.invoke('term:list'),
    /**
     * 订阅终端事件；返回取消订阅函数。
     * 推送通道每 namespace 只有一个（靠 payload 里的 sessionId 区分），
     * **绝不为每个会话开 term:data:<id>** —— 取消订阅是按通道 removeListener 的，多通道会泄漏。
     */
    onEvent: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('term:event', listener);
      return () => ipcRenderer.removeListener('term:event', listener);
    },
  },
  // 原生菜单（仅 macOS 有菜单；Win/Linux 直接 setApplicationMenu(null)）
  menu: {
    /** 菜单项要求应用内导航（如 'help/python-terminal'）；返回取消订阅函数 */
    onNavigate: (cb) => {
      const listener = (_event, route) => cb(route);
      ipcRenderer.on('menu:navigate', listener);
      return () => ipcRenderer.removeListener('menu:navigate', listener);
    },
  },
  updates: {
    /** 订阅更新事件；返回取消订阅函数 */
    onEvent: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('update:event', listener);
      return () => ipcRenderer.removeListener('update:event', listener);
    },
    /** 拉取当前更新状态（挂载时补齐早于订阅发生的事件） */
    getState: () => ipcRenderer.invoke('update:getState'),
    /** 用户确认后开始下载更新（Windows 自动安装路径） */
    download: () => ipcRenderer.invoke('update:download'),
    /** 打开 Releases 最新页手动下载（macOS 未签名，无法自动安装，走此路径） */
    openDownloadPage: () => ipcRenderer.invoke('update:openDownload'),
    /** 立即重启并安装已下载的更新 */
    restart: () => ipcRenderer.invoke('update:restart'),
    /** 手动触发一次检查 */
    check: () => ipcRenderer.invoke('update:check'),
  },
});
