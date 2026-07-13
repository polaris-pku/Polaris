const { Menu, app } = require('electron');

/**
 * 应用菜单。
 *
 * Windows / Linux：**返回 null** → `Menu.setApplicationMenu(null)`。
 * 今天跑的是 Electron 的默认英文菜单（File / Edit / View / Window / Help），只是被
 * `autoHideMenuBar: true` 藏起来了 —— 按一下 Alt 它就浮出来：既不可见、又是英文、
 * 又带着 Reload / Toggle DevTools 这类不属于产品的项。它是纯噪声，删掉。
 *
 * macOS：**必须建一份模板**。macOS 的菜单栏是全局的，把它设成 null 之后
 * ⌘Q / ⌘C / ⌘V / ⌘W 会全部失效（这些快捷键是菜单项带来的，不是系统白送的）。
 * 所以这里用 role-based 模板重建它们，标签全部中文，并挂上「帮助」入口。
 *
 * 帮助不开新窗口、不开浏览器 —— 它经 `menu:navigate` 推给渲染层，打开的是**同一个应用内抽屉**。
 * （Windows 上原生菜单不可见，所以帮助的**主入口**在侧栏页脚，菜单只是 macOS 的补齐。）
 *
 * @param {() => import('electron').BrowserWindow | null} getWindow
 * @returns {import('electron').Menu | null}
 */
function buildAppMenu(getWindow) {
  if (process.platform !== 'darwin') return null;

  const navigate = (route) => {
    const win = getWindow();
    // 高频推送必须做窗口守卫：关窗瞬间 webContents 已销毁，直接 send 会炸
    if (win && !win.isDestroyed()) {
      win.webContents.send('menu:navigate', route);
    }
  };

  const template = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about', label: `关于 ${app.getName()}` },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        {
          label: '总览',
          click: () => {
            navigate('help/overview');
          },
        },
        {
          label: 'Python 终端',
          click: () => {
            navigate('help/python-terminal');
          },
        },
        {
          label: '协议参考',
          click: () => {
            navigate('help/protocol');
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
