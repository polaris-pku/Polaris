// Agent 生成文件的落盘桥：渲染层（E 观测面板）在写操作获准后，把 agent 产出的
// 文本真正写进本机磁盘。语义对齐 A 侧 ACP `fs/write_text_file` {path,content}→{}：
// mkdir -p + 覆盖写，没有独立 create。
//
// 写入根目录的两种来源：
//   1) 默认工作区 用户文档/polaris-workspace/<项目名>/（无需授权）；
//   2) 用户自定义项目目录 —— 必须经由本进程的原生目录选择器（fs:chooseDirectory）
//      选择过才进入 authorizedRoots，渲染层无法凭空指定任意磁盘路径。
// 所有相对路径先做越界防护（拒绝绝对路径与 .. 逃逸）。
const { app, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const WORKSPACE_DIRNAME = 'polaris-workspace';

/** 用户通过原生目录选择器授权过的根目录（会话级；项目数据本身也不跨重启持久化）。 */
const authorizedRoots = new Set();

// 目录树扫描的护栏：演示用 IDE，不做虚拟滚动，超限截断防巨型仓库拖死渲染层
const SCAN_MAX_DEPTH = 8;
const SCAN_MAX_ENTRIES = 2000;
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'release']);

function workspaceRoot() {
  return path.join(app.getPath('documents'), WORKSPACE_DIRNAME);
}

/** 项目名安全化为目录段：去掉路径分隔符与 Windows 保留字符，空则回落 default。 */
function safeSegment(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  return cleaned || 'default';
}

function isAuthorizedRoot(rootPath) {
  return authorizedRoots.has(path.resolve(String(rootPath || '')));
}

/**
 * abs 是否位于 root 之内（含 root 本身）。
 *
 * 【不变量 I7】越界防护全仓只有这一份实现。terminalBridge / pythonBridge 一律
 * require 它，**不许各自重写一遍** —— 两份实现必然漂移，而这条正是沙箱的边界。
 * 入参必须是已经 path.resolve 过的绝对路径。
 */
function isInside(abs, root) {
  return abs === root || abs.startsWith(root + path.sep);
}

// 文件预览护栏：超大文件与二进制不进渲染层
const READ_MAX_BYTES = 512 * 1024;

/**
 * 解析一次读/写的目标绝对路径。
 * rootPath 存在 → 用户自定义项目目录（须已授权）；否则回落默认工作区/<项目名>。
 * 相对路径逃逸出根目录返回 null。
 */
function resolveTargetPath({ projectName, rootPath, path: relPath }) {
  let root;
  if (rootPath != null && rootPath !== '') {
    root = path.resolve(String(rootPath));
    if (!authorizedRoots.has(root)) return { error: '目录未经用户授权，拒绝写入' };
  } else {
    root = path.join(workspaceRoot(), safeSegment(projectName));
  }
  const abs = path.resolve(root, String(relPath || ''));
  if (!isInside(abs, root)) return { error: `非法路径：${String(relPath)}` };
  return { abs };
}

/** 递归扫描目录为 FileNode 树（{name, children?}，目录在前按名排序）。 */
async function scanDirectory(dir, depth, budget) {
  if (depth > SCAN_MAX_DEPTH || budget.remaining <= 0) return [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // 无权限/已删除的子目录直接跳过
  }
  entries = entries
    .filter((e) => !e.name.startsWith('.') && !(e.isDirectory() && SCAN_SKIP_DIRS.has(e.name)))
    .sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
    );
  const nodes = [];
  for (const entry of entries) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        children: await scanDirectory(path.join(dir, entry.name), depth + 1, budget),
      });
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name });
    }
  }
  return nodes;
}

function setupFsBridge(getWindow) {
  ipcMain.handle('fs:writeTextFile', async (_event, payload) => {
    try {
      const { abs, error } = resolveTargetPath(payload ?? {});
      if (error) return { ok: false, error };
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, String((payload && payload.content) ?? ''), 'utf8');
      return { ok: true, absPath: abs };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // 读取文本文件供预览（同一授权模型与越界防护；超大/二进制文件拒绝）
  ipcMain.handle('fs:readTextFile', async (_event, payload) => {
    try {
      const { abs, error } = resolveTargetPath(payload ?? {});
      if (error) return { ok: false, error };
      const stat = await fs.stat(abs);
      if (!stat.isFile()) return { ok: false, error: '目标不是文件' };
      if (stat.size > READ_MAX_BYTES) {
        return { ok: false, error: `文件过大（${Math.round(stat.size / 1024)} KB），暂不支持预览` };
      }
      const content = await fs.readFile(abs, 'utf8');
      if (content.includes('\u0000')) return { ok: false, error: '二进制文件，不支持预览' };
      return { ok: true, content, absPath: abs };
    } catch (err) {
      const code = err && err.code;
      if (code === 'ENOENT') return { ok: false, error: '文件不存在于磁盘' };
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // 原生目录选择器：用户在此做出的选择即是授权动作
  ipcMain.handle('fs:chooseDirectory', async (_event, options) => {
    const win = getWindow && getWindow();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: (options && options.title) || '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dirPath = path.resolve(result.filePaths[0]);
    authorizedRoots.add(dirPath);
    return { path: dirPath, name: path.basename(dirPath) };
  });

  // 扫描已授权目录为文件树（打开磁盘项目用）
  ipcMain.handle('fs:readDirectoryTree', async (_event, rootPath) => {
    if (!isAuthorizedRoot(rootPath)) {
      return { ok: false, error: '目录未经用户授权，拒绝读取' };
    }
    const budget = { remaining: SCAN_MAX_ENTRIES };
    const tree = await scanDirectory(path.resolve(String(rootPath)), 0, budget);
    return { ok: true, tree, truncated: budget.remaining <= 0 };
  });

  // 在系统文件管理器中定位已写入的文件；只认默认工作区或已授权目录内的路径
  ipcMain.handle('fs:revealPath', (_event, absPath) => {
    const abs = path.resolve(String(absPath || ''));
    const allowed =
      isInside(abs, workspaceRoot()) || [...authorizedRoots].some((root) => isInside(abs, root));
    if (allowed) shell.showItemInFolder(abs);
  });
}

/**
 * 项目根目录（agent 的工作区）：自定义目录须已授权；否则回落 默认工作区/<项目名>。
 * 与 resolveTargetPath 同一套落点语义 —— 后端桥（backendBridge）用它给 BCD 设 ACP_WORKSPACE，
 * 保证「agent 写进哪里」和「E 观测面板读哪里」是同一个目录。
 */
function resolveProjectRoot({ projectName, rootPath }) {
  if (rootPath != null && rootPath !== '') {
    const root = path.resolve(String(rootPath));
    if (!authorizedRoots.has(root)) return { error: '目录未经用户授权' };
    return { root };
  }
  return { root: path.join(workspaceRoot(), safeSegment(projectName)) };
}

module.exports = { setupFsBridge, resolveProjectRoot, isInside };
