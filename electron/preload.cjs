// 预加载脚本：在隔离上下文里向渲染层暴露一个最小、安全的桌面 API。
// 后续真实文件系统 / 终端 / agent 能力都从这里桥接到主进程。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  fs: {
    /** 把 agent 生成的文本写入工作区（对齐 ACP fs/write_text_file：mkdir -p + 覆盖写） */
    writeTextFile: (payload) => ipcRenderer.invoke("fs:writeTextFile", payload),
    /** 读取项目内文本文件供预览（同一授权模型；超大/二进制拒绝） */
    readTextFile: (payload) => ipcRenderer.invoke("fs:readTextFile", payload),
    /** 原生目录选择器（选择即授权该目录的读写）；取消返回 null */
    chooseDirectory: (options) => ipcRenderer.invoke("fs:chooseDirectory", options),
    /** 把已授权目录扫描为文件树（打开磁盘项目用） */
    readDirectoryTree: (rootPath) => ipcRenderer.invoke("fs:readDirectoryTree", rootPath),
    /** 在系统文件管理器中定位已写入的文件 */
    reveal: (absPath) => ipcRenderer.invoke("fs:revealPath", absPath),
  },
  backend: {
    /** 调用 BCD 的 JSON-RPC 方法（主进程侧有方法白名单）；返回 {ok, result} 或 {ok:false, error} */
    call: (method, params) => ipcRenderer.invoke("backend:call", { method, params }),
    /** 拉取后端进程状态（挂载时补齐早于订阅发生的状态） */
    getStatus: () => ipcRenderer.invoke("backend:getStatus"),
    /** 把 agent 工作区绑到某个项目并重启后端（BCD 只在启动时读 ACP_WORKSPACE） */
    configure: (options) => ipcRenderer.invoke("backend:configure", options),
    /** 重启后端进程 */
    restart: () => ipcRenderer.invoke("backend:restart"),
    /** 订阅 BCD 推来的 run.event；返回取消订阅函数 */
    onEvent: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on("backend:event", listener);
      return () => ipcRenderer.removeListener("backend:event", listener);
    },
    /** 订阅后端进程状态变化；返回取消订阅函数 */
    onStatus: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on("backend:status", listener);
      return () => ipcRenderer.removeListener("backend:status", listener);
    },
  },
  updates: {
    /** 订阅更新事件；返回取消订阅函数 */
    onEvent: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on("update:event", listener);
      return () => ipcRenderer.removeListener("update:event", listener);
    },
    /** 拉取当前更新状态（挂载时补齐早于订阅发生的事件） */
    getState: () => ipcRenderer.invoke("update:getState"),
    /** 用户确认后开始下载更新（Windows 自动安装路径） */
    download: () => ipcRenderer.invoke("update:download"),
    /** 打开 Releases 最新页手动下载（macOS 未签名，无法自动安装，走此路径） */
    openDownloadPage: () => ipcRenderer.invoke("update:openDownload"),
    /** 立即重启并安装已下载的更新 */
    restart: () => ipcRenderer.invoke("update:restart"),
    /** 手动触发一次检查 */
    check: () => ipcRenderer.invoke("update:check"),
  },
});
