// Python 终端桥：child_process.spawn + 管道（**不是 PTY**）。
//
// 为什么不是 node-pty：原生模块要 electron-rebuild + asarUnpack + 每平台编译，
// scripts/stub-node-pty.cjs 的存在就是这条不变量的立法理由（I14）。代价是 Windows 上
// 没有真正的中断信号 —— 我们如实把按钮叫「停止」，不假装两个平台一致（I11）。
//
// ── 这个模块在执行任意代码。所以边界必须写死在主进程里，一条都不能松 ──
//   I1  渲染层永远不能命名任意磁盘路径：只收 {projectName, rootPath?, path}（项目内相对路径），
//       一律过 fsBridge 的 resolveProjectRoot() + isInside()。API 里不存在绝对路径入参。
//   I2  渲染层永远不能命名任意可执行文件：只收不透明 runtimeId，bin 由 pythonBridge 白名单查表。
//   I3  spawn(bin, argv, { shell: false })。永不拼命令字符串，不用 exec / execSync。
//   I4  argv 由主进程构造（script → ['-u', abs]；repl → ['-i','-u']）。入参里没有 argv 通道 ——
//       渲染层能传一个 '-c' 就能打穿「代码必须是磁盘上一个可见文件」这条不变量。
//   I5  绝不自动运行：term:start 只由用户手势触发，永远不能被 backend:event 的 handler 调用。
//       agent 会往工作区写 .py —— 任何事件驱动的执行 = agent → 宿主的静默 RCE。
//   I6  子进程 env 是白名单，不是 {...process.env} 的减法（否则 print(os.environ) 就把 API key 打出来）。
//   I9  16ms 批量 flush + 单包 64KB + 单会话 5MB 上限 + 2000 行 ring buffer。
//       没有这段，一个 while True: print('x') 会把主进程和渲染层双双卡死，连「停止」都点不动。
//   I10 进程不能变孤儿：POSIX 建进程组按组杀；Windows taskkill /T /F；退出/关窗时全清。
const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { resolveProjectRoot, isInside } = require('./fsBridge.cjs');
const { resolveRuntimeBin } = require('./pythonBridge.cjs');

/** 并发会话上限（I10）。8 个足够对照着跑，再多是失控。 */
const MAX_SESSIONS = 8;
/** 单次推送给渲染层的最大字节数（I9）。 */
const MAX_PAYLOAD = 64 * 1024;
/** 单会话输出总量上限（I9）。超了推一条 truncated，之后不再转发。 */
const MAX_SESSION_BYTES = 5 * 1024 * 1024;
/** ring buffer 保留行数（I9）—— 渲染层重挂载时用它把 xterm 填回去。 */
const RING_LINES = 2000;
/** 批量 flush 间隔（I9）。 */
const FLUSH_MS = 16;
/** 一次 stdin 写入的上限（I13）。 */
const MAX_WRITE = 8 * 1024;

const IS_WIN = process.platform === 'win32';

/** sessionId → 会话。子进程活在主进程里，渲染层 resetDemo / 重挂载都不会让它变孤儿。 */
const sessions = new Map();
let seq = 0;

/**
 * 子进程环境变量白名单（I6）。
 *
 * **是白名单，不是 `{...process.env}` 的减法。** 减法总会漏 —— 而漏掉的那一个
 * （ANTHROPIC_API_KEY / POLARIS_* / ACP_*）会被 agent 写的一句 print(os.environ) 打进终端。
 * PATH 只注入解释器自己的目录，保证 subprocess 调 pip 时找得到同一个 python。
 */
function whitelistEnv(bin) {
  const src = process.env;
  const env = {
    PATH: path.dirname(bin),
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  const pass = IS_WIN
    ? ['USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'COMSPEC', 'LANG']
    : ['HOME', 'TMPDIR', 'LANG'];
  for (const key of pass) {
    if (src[key]) env[key] = src[key];
  }
  if (IS_WIN) {
    // Windows 上很多 stdlib 调用（subprocess / tempfile）离了 System32 直接崩。
    const system32 = path.join(src.SystemRoot || 'C:\\Windows', 'System32');
    env.PATH = `${env.PATH};${system32}`;
  }
  return env;
}

/** 只有真实存在的普通文件才准跑（目录 / 管道 / 不存在 一律拒）。 */
async function isRegularFile(abs) {
  try {
    const st = await fs.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
}

function toSessionView(s) {
  return {
    sessionId: s.sessionId,
    title: s.title,
    status: s.status,
    runtimeId: s.runtimeId,
    cwd: s.cwd,
    exitCode: s.exitCode,
    // 运行中的会话把「到现在为止跑了多久」如实报出来 —— 渲染层重挂载后秒表要能接着走。
    durationMs: s.status === 'running' ? Date.now() - s.startedAt : s.durationMs,
    replay: s.replay,
  };
}

function setupTerminalBridge(getWindow) {
  /** 推送必须带窗口守卫：终端是高频推送，关窗那一瞬间没有守卫必炸。 */
  const push = (payload) => {
    const win = getWindow && getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('term:event', payload);
  };

  /** 把攒下的 chunk 合并成一包推出去（I9）。 */
  const flush = (s) => {
    s.timer = null;
    if (s.pending.length === 0) return;
    let chunk = s.pending.join('');
    s.pending = [];
    if (chunk.length > MAX_PAYLOAD) chunk = chunk.slice(0, MAX_PAYLOAD);

    // ring buffer：只留最后 RING_LINES 行，供 term:list 回放。
    s.replay += chunk;
    const lines = s.replay.split('\n');
    if (lines.length > RING_LINES + 1) {
      s.replay = lines.slice(lines.length - (RING_LINES + 1)).join('\n');
    }
    push({ sessionId: s.sessionId, kind: 'data', chunk });
  };

  const enqueue = (s, text) => {
    if (s.truncated) return; // 已超量：不再转发，进程继续跑，用户可以点「停止」
    s.bytes += Buffer.byteLength(text, 'utf8');
    if (s.bytes > MAX_SESSION_BYTES) {
      s.truncated = true;
      s.pending = [];
      if (s.timer) {
        clearTimeout(s.timer);
        s.timer = null;
      }
      push({ sessionId: s.sessionId, kind: 'truncated' });
      return;
    }
    s.pending.push(text);
    if (!s.timer) s.timer = setTimeout(() => flush(s), FLUSH_MS);
  };

  /** 按进程组杀（I10）。POSIX 有真信号；Windows 只有 taskkill —— 这是 pipe 方案的已知代价。 */
  const killSession = (s, signal) => {
    if (!s.child || !s.child.pid || s.status !== 'running') return;
    s.killedByUser = true;
    if (IS_WIN) {
      // Node 的 SIGINT 在 Windows 上是假的（映射成 TerminateProcess）——
      // 与其骗用户，不如两种手势都如实走 taskkill，UI 上把按钮叫「停止」（I11）。
      spawn('taskkill', ['/pid', String(s.child.pid), '/T', '/F'], { shell: false }).on(
        'error',
        () => {},
      );
      return;
    }
    const sig = signal === 'interrupt' ? 'SIGINT' : 'SIGKILL';
    try {
      process.kill(-s.child.pid, sig); // detached:true 建了进程组 → 连子孙一起
    } catch {
      try {
        s.child.kill(sig);
      } catch {
        /* 进程已经没了 */
      }
    }
  };

  const disposeSession = (sessionId) => {
    const s = sessions.get(sessionId);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    killSession(s, 'kill');
    sessions.delete(sessionId);
  };

  ipcMain.handle('term:start', async (_event, req) => {
    const payload = req ?? {};
    if (sessions.size >= MAX_SESSIONS) {
      return { ok: false, error: `最多同时运行 ${String(MAX_SESSIONS)} 个终端会话`, code: 'limit' };
    }

    // 【I1】授权检查只有这一处，且用的是 fsBridge 那一份 isInside —— 不在这里重写。
    const { root, error } = resolveProjectRoot(payload);
    if (error) return { ok: false, error, code: 'unauthorized' };

    const kind = payload.kind === 'repl' ? 'repl' : 'script';
    let argv;
    let title;
    if (kind === 'script') {
      const rel = String(payload.path || '');
      const abs = path.resolve(root, rel);
      if (!isInside(abs, root)) return { ok: false, error: `非法路径：${rel}`, code: 'outside' };
      if (!(await isRegularFile(abs))) {
        return { ok: false, error: '目标不是一个文件', code: 'notfile' };
      }
      argv = ['-u', abs]; // 【I4】argv 由主进程构造
      title = payload.title || path.basename(abs);
    } else {
      argv = ['-i', '-u']; // 交互式 REPL：stdin 通着，input() 能用
      title = payload.title || 'REPL';
    }

    // 【I2】白名单查表：查不到就是查不到，绝不猜一个「能跑的 python」。
    const bin = resolveRuntimeBin(String(payload.runtimeId || ''));
    if (!bin) return { ok: false, error: '未知的 Python 运行时', code: 'runtime' };

    let child;
    try {
      child = spawn(bin, argv, {
        cwd: root, // cwd 恒为项目根，**不是 path.dirname(abs)** —— 否则 <root>/sub/x.py 里的
        // 相对读写会落到 sub/ 下，和 agent（ACP_WORKSPACE=root）不同根。
        shell: false, // 【I3】永不拼命令字符串
        env: whitelistEnv(bin), // 【I6】白名单
        detached: !IS_WIN, // 【I10】POSIX 建进程组，才能按组杀掉子孙
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), code: 'spawn' };
    }

    seq += 1;
    const sessionId = `term-${String(seq)}-${String(Date.now())}`;
    const s = {
      sessionId,
      title,
      status: 'running',
      runtimeId: String(payload.runtimeId || ''),
      cwd: root,
      exitCode: null,
      durationMs: 0,
      startedAt: Date.now(),
      replay: '',
      pending: [],
      timer: null,
      bytes: 0,
      truncated: false,
      killedByUser: false,
      child,
    };
    sessions.set(sessionId, s);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => enqueue(s, d));
    child.stderr.on('data', (d) => enqueue(s, d));

    child.on('error', (err) => {
      s.status = 'error';
      s.durationMs = Date.now() - s.startedAt;
      push({ sessionId, kind: 'error', message: String((err && err.message) || err) });
    });

    child.on('exit', (code, signal) => {
      if (s.timer) {
        clearTimeout(s.timer);
        flush(s); // 别把最后一口输出吞掉
      }
      s.status = s.killedByUser ? 'killed' : 'exited';
      s.exitCode = code;
      s.durationMs = Date.now() - s.startedAt;
      s.child = null;
      push({ sessionId, kind: 'exit', code, signal, durationMs: s.durationMs });
    });

    return { ok: true, sessionId };
  });

  // stdin：原样字节转发。**不解析、不执行**（I13）。input() 与 REPL 就靠这条。
  ipcMain.handle('term:write', (_event, { sessionId, data } = {}) => {
    const s = sessions.get(sessionId);
    if (!s || !s.child || s.status !== 'running') return { ok: false, error: '会话已结束' };
    const text = String(data ?? '');
    if (text.length > MAX_WRITE) return { ok: false, error: '单次输入过长' };
    try {
      s.child.stdin.write(text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('term:signal', (_event, { sessionId, signal } = {}) => {
    const s = sessions.get(sessionId);
    if (!s) return { ok: false, error: '会话不存在' };
    killSession(s, signal === 'interrupt' ? 'interrupt' : 'kill');
    return { ok: true };
  });

  ipcMain.handle('term:dispose', (_event, { sessionId } = {}) => {
    disposeSession(sessionId);
    return { ok: true };
  });

  // 补齐拉取：没有它，「渲染层重新挂载后终端一片空白」会立刻复现
  // （updater.cjs:52 那条注释就是同一个 bug 的墓碑）。
  ipcMain.handle('term:list', () => ({
    sessions: [...sessions.values()].map(toSessionView),
  }));

  const cleanupAll = () => {
    for (const id of [...sessions.keys()]) disposeSession(id);
  };
  app.on('before-quit', cleanupAll);
  app.on('will-quit', cleanupAll);
  const win = getWindow && getWindow();
  if (win) win.on('closed', cleanupAll);
}

module.exports = { setupTerminalBridge };
