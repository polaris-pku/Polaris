// 应用内自动更新：electron-updater + GitHub Releases（发布时生成的 latest.yml 为更新源）。
// 运行中定时轮询（无需重启即可发现新版），检测到后由渲染层弹窗，用户自行决定是否下载。
const { app, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

// macOS 未签名构建无法用 Squirrel 自动安装更新，改为引导用户到 Releases 页手动下载 dmg。
// 该页始终指向最新发布，无需拼版本号。
const RELEASES_LATEST_URL = "https://github.com/ExtraZhangYC/Polaris/releases/latest";

// 运行中轮询间隔（10 分钟）。GitHub 未认证请求限流 60 次/时，此频率很安全。
const CHECK_INTERVAL = 10 * 60 * 1000;

function setupAutoUpdater(getWindow) {
  // 仅在打包后的应用启用（dev 下没有更新元数据，会直接报错）
  if (!app.isPackaged) return;

  // 关键：不自动下载，交由用户在弹窗里决定
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  let timer = null;
  const stopPolling = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  // 缓存最近一次更新状态：渲染层挂载时可主动拉取，避免事件早于订阅而丢失
  let lastState = null;
  const send = (type, payload = {}) => {
    lastState = { type, ...payload };
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("update:event", lastState);
    }
  };

  autoUpdater.on("checking-for-update", () => send("checking"));
  autoUpdater.on("update-available", (info) => {
    // 已发现新版本，无需继续轮询，等用户处理
    stopPolling();
    send("available", { version: info?.version });
  });
  autoUpdater.on("update-not-available", () => send("not-available"));
  autoUpdater.on("download-progress", (p) =>
    send("progress", { percent: Math.round(p?.percent ?? 0) })
  );
  autoUpdater.on("update-downloaded", (info) => send("downloaded", { version: info?.version }));
  autoUpdater.on("error", (err) => send("error", { message: String(err?.message || err) }));

  // 渲染层挂载时拉取当前状态（修复启动页因事件早于订阅而不弹窗的问题）
  ipcMain.handle("update:getState", () => lastState);
  // 渲染层主动触发：确认下载 / 立即重启安装 / 手动检查
  ipcMain.handle("update:download", () => autoUpdater.downloadUpdate().catch(() => {}));
  ipcMain.handle("update:restart", () => autoUpdater.quitAndInstall());
  ipcMain.handle("update:check", () => autoUpdater.checkForUpdates().catch(() => {}));
  // macOS 走手动下载：打开 Releases 最新页，用户下载 dmg 后自行拖入 Applications
  ipcMain.handle("update:openDownload", () => shell.openExternal(RELEASES_LATEST_URL));

  // 启动 3s 后检查一次（避开首屏渲染），之后每 10 分钟轮询一次
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
  timer = setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL);
}

module.exports = { setupAutoUpdater };
