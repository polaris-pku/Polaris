// Electron 主进程（薄壳）：把现有 Vite/React 应用装进原生窗口。
// 用 .cjs 后缀，使其在 package.json "type":"module" 下仍按 CommonJS 加载。
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { setupAutoUpdater } = require('./updater.cjs');
const { setupFsBridge } = require('./fsBridge.cjs');
const { setupBackendBridge } = require('./backendBridge.cjs');
const { setupPythonBridge } = require('./pythonBridge.cjs');
const { setupTerminalBridge } = require('./terminalBridge.cjs');
const { buildAppMenu } = require('./appMenu.cjs');

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#090b10', // 与 tailwind ink-950 对齐，避免加载白闪
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // 外部 http(s) 链接交给系统浏览器打开，而不是在应用内新开窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 单实例锁：避免重复启动开多个窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 应用菜单是**全局的**，必须在建窗之前设好。
    // Win/Linux → null：今天跑的是 Electron 的默认英文菜单（File/Edit/View/Help），
    // 只是被 autoHideMenuBar 藏着，按一下 Alt 就浮出来 —— 既不可见、又是英文、又反极简。
    // macOS → 中文 role 模板：设成 null 会把 ⌘Q / ⌘C / ⌘V 一起弄没（那些快捷键是菜单项带来的）。
    Menu.setApplicationMenu(buildAppMenu(() => mainWindow));

    createWindow();
    setupAutoUpdater(() => mainWindow);
    setupFsBridge(() => mainWindow);
    setupBackendBridge(() => mainWindow);
    // 这两个必须在 createWindow() 之后：terminalBridge 要挂窗口的 closed 事件做会话清理（I10）。
    setupPythonBridge(() => mainWindow);
    setupTerminalBridge(() => mainWindow);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
