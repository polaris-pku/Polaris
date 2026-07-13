// Python 运行时管理（py:* 通道）：探测 / 选择 / 手动指定 / 下载 / 校验 / 解包 / 卸载。
//
// ── 这个模块存在的理由 ──
// 用户装 Polaris 是为了看 agent 干活，不是为了配 Python。所以「跑一个 .py」这条路上
// 不能有一步是「先去 python.org 装个 Python，记得勾 Add to PATH」。我们自己发一份。
//
// ── 三条安全不变量（改这个文件前先读它们）──
// 【I2】渲染层永远拿不到、也传不了解释器路径 —— 它只见到不透明的 runtimeId，
//       真实 bin 由本模块的白名单 binById 查表得到（resolveRuntimeBin）。查不到就是 null，绝不猜。
//       手动指定解释器**只能**走 dialog.showOpenDialog：**原生选择动作 = 授权动作**，
//       与 fs:chooseDirectory 完全同构。
// 【I7】越界防护只用 fsBridge 的 isInside，不在这里重写一遍（两份实现必然漂移，而这正是沙箱边界）。
// 【I8】校验和**硬编码在 python-catalog.json 里、随代码提交**，运行时绝不去网上取。
//       能在下载时替换掉 tar.gz 的中间人，同样能替换掉同一次请求里返回的校验和 ——
//       现拉校验和等于自己给自己发证书。
const { app, dialog, ipcMain } = require('electron');
const { execFile } = require('child_process');
const nodeCrypto = require('node:crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const tar = require('tar');
const { isInside } = require('./fsBridge.cjs');
const { readSettings, writeSettings } = require('./settings.cjs');

/** 单一真值源：pinned tag / 资产名 / sha256 / 体积。由 scripts/refresh-python-catalog.mjs 生成。 */
const CATALOG = require('./python-catalog.json');

/** `<platform>-<arch>` → python-build-standalone 的三元组。表里没有 = 该平台没有可一键安装的运行时。 */
const TRIPLES = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

/**
 * 下载链路上允许出现的主机（含重定向的每一跳）。
 *
 * 实测：github.com 的 release 下载会 302 到 **release-assets.githubusercontent.com**
 * （不是规格里写的 objects.githubusercontent.com —— 那是旧主机，仍保留在表里以防回退）。
 * 任何一跳落到表外 —— 直接失败，绝不跟过去。
 */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);

const IS_WIN = process.platform === 'win32';
const UA = 'polaris-python-installer';

/**
 * 「用户自己按了取消」的哨兵。它走 {ok:false,error} 这条返回（IPC 形状是冻结的），
 * 但**不是失败** —— 渲染层（src/lib/pythonRuntime.ts）据此不把它渲染成红色错误行。
 * 两边都硬编码这个字面量：跨进程共享不了常量，但它只出现在 W2-5 自己的两个文件里。
 */
const CANCELED = '已取消';

/** 探测脚本：候选解释器**必须真跑一次**才算数（见 detectSystem 的注释）。 */
const PROBE = 'import sys,json;print(json.dumps([sys.executable,list(sys.version_info[:3])]))';

// ── 模块级状态 ────────────────────────────────────────────────────────────────

/** 【I2 的白名单】runtimeId → 解释器绝对路径。**全仓唯一一处 id→bin 的映射。** */
const binById = new Map();
/** managed 运行时的安装目录（卸载时用；不从 id 里 parse 出路径）。 */
const dirById = new Map();

/** @type {PyRuntime[]} */
let runtimes = [];
/** @type {string | null} */
let selectedId = null;
/** @type {PyInstallState | null} */
let install = null;
/** 进行中安装的取消器。 */
let installAbort = null;
let getWin = () => null;

// ── 落点 ─────────────────────────────────────────────────────────────────────

/**
 * 运行时的家。
 *
 * **绝不能落在 process.resourcesPath / 安装目录**：按机器安装（Program Files）或 macOS 只读挂载
 * 会直接 EPERM，且每次自动更新都会把产物冲掉。userData 是唯一可写、且跨更新存活的位置。
 * （backendBridge.cjs:362-368 已经为后端状态目录踩过同一个坑。）
 */
function runtimesRoot() {
  return path.join(app.getPath('userData'), 'runtimes', 'python');
}
function tmpRoot() {
  return path.join(runtimesRoot(), '.tmp');
}

/** 解包后的固定布局：Windows 是 python\python.exe，POSIX 是 python/bin/python3。 */
function managedBin(installDir) {
  return IS_WIN
    ? path.join(installDir, 'python', 'python.exe')
    : path.join(installDir, 'python', 'bin', 'python3');
}

function currentTriple() {
  return TRIPLES[`${process.platform}-${process.arch}`] ?? null;
}

function assetFor(item) {
  const triple = currentTriple();
  return triple ? (item.assets[triple] ?? null) : null;
}

/**
 * runtimeId 的稳定后缀。
 *
 * **不能用数组下标**（'system:0'）：PATH 上的顺序一变，'system:0' 就悄悄指向了另一个解释器 ——
 * 用户选中的东西在他毫不知情时被换掉。用路径的哈希，id 就跟着解释器本身走。
 * 对渲染层它依然是完全不透明的（I2）。
 */
function idHash(absPath) {
  return nodeCrypto.createHash('sha256').update(path.resolve(absPath)).digest('hex').slice(0, 12);
}

// ── 探测 ─────────────────────────────────────────────────────────────────────

/**
 * 真跑一次候选解释器。跑不通 → null。
 *
 * 为什么**必须真跑**：Windows 上 `where python` 命中的往往是 Microsoft Store 的 0 字节 stub
 * （%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe）—— 它存在、可执行、一跑就弹应用商店。
 * 只看「文件在不在」的探测会把它当成一个可用的 Python，然后用户点运行，弹出商店。
 */
function probe(bin) {
  return new Promise((resolve) => {
    execFile(
      bin,
      ['-c', PROBE], // argv 由主进程构造，shell:false —— 永不拼命令字符串（I3）
      { timeout: 10_000, windowsHide: true, shell: false, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(String(stdout).trim());
          const executable = String(parsed[0] ?? '');
          const info = parsed[1];
          if (!executable || !Array.isArray(info) || info.length < 3) return resolve(null);
          resolve({ executable, version: info.slice(0, 3).join('.') });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

/** 跑一条只读的探路命令（py -0p / where / which），失败返回空串 —— 探不到是常态，不是错误。 */
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: 10_000, windowsHide: true, shell: false, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        resolve(err ? '' : String(stdout));
      },
    );
  });
}

/** 0 字节 = Microsoft Store 的 stub，直接跳过（跑它会弹商店）。 */
function isPlausibleBin(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/** 系统 PATH / py launcher 上的候选解释器路径（未验证，只是候选）。 */
async function systemCandidates() {
  const out = [];
  if (IS_WIN) {
    // py -0p 列出 py launcher 注册的所有解释器：`-V:3.12 *   C:\...\python.exe`
    const listed = await run('py', ['-0p']);
    for (const line of listed.split(/\r?\n/)) {
      const m = /([A-Za-z]:\\[^\r\n]*?\.exe)\s*$/.exec(line.trim());
      if (m) out.push(m[1]);
    }
    for (const name of ['python', 'python3']) {
      const found = await run('where', [name]);
      for (const line of found.split(/\r?\n/)) {
        const p = line.trim();
        if (p.toLowerCase().endsWith('.exe')) out.push(p);
      }
    }
  } else {
    const found = await run('which', ['-a', 'python3', 'python']);
    for (const line of found.split(/\r?\n/)) {
      const p = line.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

/** 目录实际占用（卸载确认里的「将释放 xxx MB」用的是这个实测值，不是 catalog 里的估算）。 */
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += await dirSize(p);
    } else if (e.isFile()) {
      try {
        total += (await fsp.stat(p)).size;
      } catch {
        // 扫描期间被删掉的文件不算错误
      }
    }
  }
  return total;
}

/**
 * 重建「当前可用的解释器」全集 + I2 的白名单。
 *
 * ⚠️ **settings.json 是持久的，授权不是。** 启动时绝不无条件信任文件里的路径：
 * 托管运行时要逐个校验 bin 还在、还能跑；manualPath 要重新校验一遍；
 * 三者都失败 → selected 降级为 null，UI 让用户重新选。**绝不静默回落到「某个能跑的 python」。**
 */
/**
 * 解析到真实路径，用于**判断两个候选是不是同一个解释器**。
 *
 * 只用来去重，不用来显示 —— 界面上仍然显示用户认得的那条路径（/usr/bin/python3），
 * 而不是软链尽头那个 /usr/bin/python3.14。
 * realpath 失败（坏软链、权限不足）时回落到原路径：宁可多列一条，也不要漏掉一个能用的解释器。
 */
async function canonical(p) {
  try {
    return await fsp.realpath(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

async function rebuild() {
  const list = [];
  binById.clear();
  dirById.clear();

  // ① 托管：扫 userData/runtimes/python/*/
  let dirs = [];
  try {
    dirs = (await fsp.readdir(runtimesRoot(), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    dirs = []; // 一个都没装过 —— 一等状态，不是错误
  }
  for (const name of dirs) {
    const dir = path.join(runtimesRoot(), name);
    const bin = managedBin(dir);
    if (!isPlausibleBin(bin)) continue;
    const info = await probe(bin);
    if (!info) continue; // 半截的 / 装坏的运行时不进白名单
    const id = `managed:${name}`;
    list.push({
      id,
      version: info.version,
      source: 'managed',
      displayPath: bin,
      sizeBytes: await dirSize(dir),
      removable: true,
    });
    binById.set(id, bin);
    dirById.set(id, dir);
  }

  // ② 系统：探测到就用，探不到就诚实地说「未检测到」
  //
  // 去重必须按 **realpath**，不能按 path.resolve。
  // path.resolve 只做字符串归一化，不解析软链 —— 而多数 Linux 上 /bin 就是 /usr/bin 的软链，
  // Windows 上 py 与 python.exe 也常指向同一个二进制。按字符串去重的结果是：
  // 同一个解释器被当成两个不同的运行时列在界面上，用户根本分不清该选哪个。
  const seen = new Set();
  for (const r of list) seen.add(await canonical(r.displayPath));
  for (const cand of await systemCandidates()) {
    const abs = path.resolve(cand);
    const real = await canonical(abs);
    if (seen.has(real) || !isPlausibleBin(abs)) continue;
    seen.add(real);
    const info = await probe(abs);
    if (!info) continue; // 跑不通（Store stub / 坏软链）—— 它不是一个可用的 Python
    const id = `system:${idHash(abs)}`;
    list.push({
      id,
      version: info.version,
      source: 'system',
      displayPath: abs,
      removable: false, // 系统 Python 我们无权动它 —— 不给卸载按钮
    });
    binById.set(id, abs);
  }

  // ③ 手动指定：**全仓唯一一处「授权跨重启存活」**。
  //    这是有意为之 —— 用户曾亲手在原生系统对话框里选中过它（原生选择动作 = 授权动作）。
  //    但每次启动都必须重新校验：文件还在吗？还是个文件吗？还能跑吗？
  const manualPath = readSettings().python?.manualPath;
  if (typeof manualPath === 'string' && manualPath) {
    const abs = path.resolve(manualPath);
    if (!seen.has(await canonical(abs)) && isPlausibleBin(abs)) {
      const info = await probe(abs);
      if (info) {
        const id = `manual:${idHash(abs)}`;
        list.push({
          id,
          version: info.version,
          source: 'manual',
          displayPath: abs, // UI 上必须把这个路径明文显示给用户看
          removable: false,
        });
        binById.set(id, abs);
      }
    }
  }

  runtimes = list;

  const persisted = readSettings().python?.selected;
  selectedId = list.some((r) => r.id === persisted) ? persisted : null;
}

// ── 状态推送 ─────────────────────────────────────────────────────────────────

/** 推送必须有窗口守卫：关窗瞬间还在推 = `Object has been destroyed` 抛错。 */
function emit(event) {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('py:event', event);
}

function setInstall(next) {
  install = next;
  if (next) emit(next);
}

function catalogItems() {
  return CATALOG.items.map((item) => {
    const asset = assetFor(item);
    return {
      catalogId: item.catalogId,
      version: item.version,
      downloadBytes: asset?.downloadBytes ?? 0,
      installedBytes: asset?.installedBytes ?? 0,
      installed: binById.has(`managed:${item.catalogId}`),
      recommended: CATALOG.recommended === item.catalogId,
      // 该平台没有资产 —— **一等状态**，UI 显示「此平台暂无可一键安装的运行时」，绝不静默失败
      unavailable: !asset,
    };
  });
}

function snapshot() {
  return { runtimes, selectedId, install, catalog: catalogItems() };
}

/** 持久化选择。settings 的合并是顶层的，所以 python 块要自己先展开再覆盖。 */
async function persistPython(patch) {
  const current = readSettings().python ?? {};
  await writeSettings({ python: { ...current, ...patch } });
}

// ── 安装流水线（I8：五步，缺一不可）────────────────────────────────────────────

/**
 * 下载到 dest，边下边报进度。**每一跳重定向的主机都要过白名单。**
 * 返回值只有「文件已完整落到 dest」这一个事实 —— 校验是独立的下一步。
 *
 * ⚠️ **必须有停滞超时。** 没有它的话，连接在中途断掉（而 TCP 不给我们任何信号）时，
 * `for await (const chunk of res.body)` 会**永远**等下去：界面上就是一条永远停在
 * 「下载 22.0 / 113.7 MB」的进度条，不报错、不结束，用户只能自己去点取消。
 * 本机实测过这个场景（下到 22 MB 卡死），它在弱网/公司代理下会是常态而不是意外。
 * fetch 的 signal 只管「整体取消」，管不了「流已经死了但连接还开着」—— 需要自己看门狗。
 */
const DOWNLOAD_IDLE_MS = 60_000;

async function download(url, dest, expectedBytes, signal, catalogId) {
  let current = url;

  for (let hop = 0; hop < 6; hop += 1) {
    // 看门狗：超过 DOWNLOAD_IDLE_MS 没有任何字节到达，就把这条连接掐掉并如实报错。
    const stall = new AbortController();
    let watchdog = null;
    const kick = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => stall.abort(), DOWNLOAD_IDLE_MS);
    };
    const stopWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };
    /** 用户取消 → 「已取消」；流卡死 → 「下载停滞」。两者必须分得开。 */
    const rethrow = (err) => {
      if (stall.signal.aborted && !signal.aborted) {
        throw new Error(`下载停滞：${String(DOWNLOAD_IDLE_MS / 1000)} 秒没有收到任何数据，请重试`);
      }
      throw err;
    };

    let res;
    kick();
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, stall.signal]),
        headers: { 'User-Agent': UA, Accept: 'application/octet-stream' },
      });
    } catch (err) {
      stopWatchdog();
      rethrow(err);
    }

    if (res.status >= 300 && res.status < 400) {
      stopWatchdog();
      const loc = res.headers.get('location');
      await res.body?.cancel(); // 不读掉 body 会泄漏连接
      if (!loc) throw new Error('下载失败：重定向没有给出目标地址');
      const next = new URL(loc, current);
      if (next.protocol !== 'https:' || !ALLOWED_HOSTS.has(next.hostname)) {
        throw new Error(`下载被重定向到不受信任的地址：${next.hostname}`);
      }
      current = next.toString();
      continue;
    }

    if (!res.ok || !res.body) {
      stopWatchdog();
      await res.body?.cancel(); // 同样要读掉，否则这条连接会挂着
      throw new Error(`下载失败：HTTP ${String(res.status)}`);
    }

    const total = Number(res.headers.get('content-length')) || expectedBytes;
    const out = fs.createWriteStream(dest);
    let received = 0;
    let lastEmit = 0;

    try {
      for await (const chunk of res.body) {
        kick(); // 有字节到达 = 还活着，重新计时
        received += chunk.length;
        if (!out.write(chunk)) {
          // 背压：等 drain。**两个监听器必须互相摘掉。**
          // `once('error')` 只在 error 真的触发时才自摘 —— 而正常路径上触发的是 drain，
          // 于是每一次背压都会在 WriteStream 上永久积一个 error 监听器（外加它闭包里
          // 那个已经 settle 的 reject）。113 MB 的包会积上千个，Node 先甩一句
          // MaxListenersExceededWarning，然后就是白白攥住的内存。
          await new Promise((resolve, reject) => {
            const onDrain = () => {
              out.off('error', onError);
              resolve();
            };
            const onError = (err) => {
              out.off('drain', onDrain);
              reject(err);
            };
            out.once('drain', onDrain);
            out.once('error', onError);
          });
        }
        // 节流：每 120ms 推一次就够人眼看了，推太密只会把 IPC 塞满
        const now = Date.now();
        if (now - lastEmit > 120) {
          lastEmit = now;
          setInstall({
            catalogId,
            phase: 'download',
            percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
            receivedBytes: received,
            totalBytes: total,
          });
        }
      }
      stopWatchdog();
      await new Promise((resolve, reject) => {
        out.end((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      stopWatchdog();
      out.destroy();
      rethrow(err); // 流卡死 → 「下载停滞」；用户取消 → 「已取消」
    }
    return;
  }
  throw new Error('下载失败：重定向次数过多');
}

/**
 * 流式算 dest 的 sha256。
 *
 * 故意**重新读一遍磁盘上的文件**，而不是复用下载时边下边算的哈希：
 * 我们要校验的是「即将被解包执行的那个文件」，不是「曾经流过网卡的那些字节」。
 * 这样连写盘途中的截断/损坏也一起接住了。
 */
function sha256OfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = nodeCrypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * 逐 entry 的解包防护（tar-slip）。
 *
 * **这与 I1 是同一个不变量，只是方向相反**：I1 管「渲染层不能命名任意路径」，
 * 这里管「压缩包不能命名任意路径」。系统 tar 不给你逐条控制的能力 —— 这就是必须用纯 JS tar 的理由。
 *
 * ⚠️ 符号链接**不能一刀切拒绝**：python-build-standalone 的 POSIX 包里
 * `python/bin/python3` 本身就是一个指向 `python3.13` 的符号链接（实测该包有 8 条软链）。
 * 拒掉它 = 装出一个没有 python3 的 Python。正确的判据是「解析后仍在解包目录内」。
 */
function entryProblem(entryPath, type, linkpath, dest) {
  const p = String(entryPath);
  if (path.isAbsolute(p) || /^[A-Za-z]:/.test(p)) return `压缩包里有绝对路径：${p}`;
  if (p.split(/[/\\]/).includes('..')) return `压缩包里有上跳路径：${p}`;

  const abs = path.resolve(dest, p);
  if (!isInside(abs, dest)) return `压缩包试图写到解包目录之外：${p}`;

  if (type === 'SymbolicLink' || type === 'Link') {
    const raw = String(linkpath ?? '');
    if (!raw) return `压缩包里有空链接：${p}`;
    // 软链相对自己所在目录解析；硬链相对压缩包根解析（node-tar 的语义）
    const target =
      type === 'SymbolicLink' ? path.resolve(path.dirname(abs), raw) : path.resolve(dest, raw);
    if (!isInside(target, dest)) return `压缩包里的链接指向解包目录之外：${p} -> ${raw}`;
    return null;
  }
  if (type !== 'File' && type !== 'Directory') {
    return `压缩包里有不支持的条目类型：${type}（${p}）`;
  }
  return null;
}

/**
 * 先把整个包过一遍（逐 entry 校验 + 数总数），一条不合法就整包拒绝。
 *
 * ⚠️ **绝不在 onentry 里 throw。** 实测（tar@7.5.19）：onentry 抛出的异常不会让 tar.t/tar.x 的
 * Promise reject —— 它从 EventEmitter.emit 里同步炸出去，落在 fs 读取的回调栈上，成为一个
 * **未捕获异常**，直接掀掉 Electron 主进程，而且 catch 块里的 .tmp 清理一行都不会跑。
 * 也就是说：一个恶意压缩包不是「被干净地拒绝」，而是「把宿主搞崩」。
 * 所以这里只**收集**问题，等这一趟走完再统一判 —— 抛错发生在我们自己的栈上。
 */
async function inspectArchive(file, dest) {
  const problems = [];
  let count = 0;
  await tar.t({
    file,
    strict: true,
    onentry: (entry) => {
      count += 1;
      const problem = entryProblem(entry.path, entry.type, entry.linkpath, dest);
      if (problem) problems.push(problem);
    },
  });
  if (problems.length > 0) throw new Error(problems[0]);
  if (count === 0) throw new Error('压缩包是空的');
  return count;
}

async function extractArchive(file, dest, total, catalogId) {
  await fsp.mkdir(dest, { recursive: true });
  let done = 0;
  let lastEmit = 0;
  await tar.x({
    file,
    cwd: dest,
    strict: true,
    preservePaths: false, // 绝不允许绝对路径 / .. 逃逸（我们自己还会再判一次）
    // 第二道闸：inspectArchive 已经整包放行过了，这里再逐条判一次。
    // filter 返回 false = 跳过该条目（**不是** throw —— 见 inspectArchive 上方的注释）。
    filter: (p, entry) => entryProblem(p, entry.type, entry.linkpath, dest) === null,
    onentry: () => {
      done += 1;
      const now = Date.now();
      if (now - lastEmit > 120) {
        lastEmit = now;
        // 只推 entries（已解条目数）+ percent：PyEvent 的字段是冻结契约，
        // 里面没有「总条目数」这一项，而多推一个未声明的字段等于绕过类型契约偷偷加接口。
        // 分母的信息由 percent 与 2px 进度条承载 —— 用户要的是「卡在下载还是解包」，这两样都给了。
        setInstall({
          catalogId,
          phase: 'extract',
          percent: total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0,
          entries: done,
        });
      }
    },
  });
}

async function rmrf(target) {
  await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
}

async function doInstall(catalogId) {
  const item = CATALOG.items.find((i) => i.catalogId === catalogId);
  if (!item) return { ok: false, error: '未知的运行时' };
  const asset = assetFor(item);
  if (!asset) return { ok: false, error: '此平台暂无可一键安装的运行时，请手动指定解释器' };

  const finalDir = path.join(runtimesRoot(), catalogId);
  if (binById.has(`managed:${catalogId}`)) return { ok: false, error: '这个版本已经装过了' };

  const tmp = tmpRoot();
  const archive = path.join(tmp, `${catalogId}.tar.gz`);
  const stage = path.join(tmp, catalogId);

  const controller = new AbortController();
  installAbort = controller;

  try {
    await fsp.mkdir(tmp, { recursive: true });
    await rmrf(archive);
    await rmrf(stage);

    // ① 下载。URL 里的 `+` 必须转义成 %2B（资产名里就带一个 +）。
    const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${encodeURIComponent(CATALOG.tag)}/${encodeURIComponent(asset.file)}`;
    setInstall({
      catalogId,
      phase: 'download',
      percent: 0,
      receivedBytes: 0,
      totalBytes: asset.downloadBytes,
    });
    await download(url, archive, asset.downloadBytes, controller.signal, catalogId);

    // ② 校验。**不通过就是不通过** —— 立刻删掉，绝不落地。
    setInstall({ catalogId, phase: 'verify', percent: 0 });
    const actual = await sha256OfFile(archive);
    if (actual !== asset.sha256) {
      await rmrf(archive);
      throw new Error('校验失败 · 文件可能被篡改或下载不完整');
    }

    // ③ 解包（逐 entry 防 tar-slip）。先过一遍拿总数，再真解。
    setInstall({ catalogId, phase: 'extract', percent: 0, entries: 0 });
    const total = await inspectArchive(archive, stage);
    await extractArchive(archive, stage, total, catalogId);

    // ④ 原子上架：先解到 .tmp，再整体 rename。
    //    避免「半截的运行时」被选中并执行 —— rename 在同一文件系统内是原子的。
    await rmrf(finalDir);
    await fsp.mkdir(path.dirname(finalDir), { recursive: true });
    fs.renameSync(stage, finalDir);

    // ⑤ POSIX：补回可执行位（tar 里的 mode 位可能因 umask 丢失）。
    //    bin 是一条指向 python3.13 的软链 —— chmod 要落在它的真身上。
    const bin = managedBin(finalDir);
    if (!IS_WIN) {
      try {
        await fsp.chmod(await fsp.realpath(bin), 0o755);
      } catch {
        // chmod 失败不直接判死 —— 下面那次真跑才是唯一的判据
      }
    }

    // 装完必须真跑一次。装出一个跑不起来的 Python，比没装更糟。
    if (!(await probe(bin))) {
      await rmrf(finalDir);
      throw new Error('安装完成了，但这个 Python 跑不起来（已删除）');
    }

    await rmrf(archive);
    await rebuild();

    // 用户点安装就是为了用它 —— 装完直接选中（渲染层随后消费 pendingRunIntent 接着跑他的文件）
    const id = `managed:${catalogId}`;
    if (binById.has(id)) {
      selectedId = id;
      await persistPython({ selected: id });
    }
    setInstall({ catalogId, phase: 'done', percent: 100 });
    return { ok: true };
  } catch (err) {
    const canceled = controller.signal.aborted;
    await rmrf(archive); // 取消/失败都要把几十 MB 的半截包清干净
    await rmrf(stage);
    if (canceled) {
      // 用户自己按的取消**不是错误**：不该在界面上留一行红字。
      // 直接把安装态抹掉（渲染层随后 refresh 会拉到 install:null）。
      install = null;
      return { ok: false, error: CANCELED };
    }
    const message = String(err?.message || err);
    setInstall({ catalogId, phase: 'error', percent: 0, message });
    return { ok: false, error: message };
  } finally {
    installAbort = null;
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────

function setupPythonBridge(getWindow) {
  getWin = () => (getWindow ? getWindow() : null);

  // 开机就把可用集合建起来（异步，不挡窗口）。探测要真跑解释器，慢一点没关系。
  void rebuild();

  ipcMain.handle('py:getState', () => snapshot());

  ipcMain.handle('py:detect', async () => {
    try {
      await rebuild();
      return { ok: true, runtimes };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('py:select', async (_e, payload) => {
    const runtimeId = String(payload?.runtimeId ?? '');
    if (!binById.has(runtimeId)) return { ok: false, error: '未知的 Python 运行时' };
    selectedId = runtimeId;
    await persistPython({ selected: runtimeId });
    return { ok: true };
  });

  /**
   * 手动指定解释器 —— **唯一的授权入口**。
   * 渲染层永远无法传一个解释器路径字符串过来；它只能请求「弹一个原生对话框」，
   * 由用户亲手在系统 UI 里选中。这与 fs:chooseDirectory 是同一个模型（I2）。
   */
  ipcMain.handle('py:pickInterpreter', async () => {
    const win = getWin();
    const result = await dialog.showOpenDialog(win ?? undefined, {
      title: '选择 Python 解释器',
      properties: ['openFile'],
      filters: IS_WIN ? [{ name: 'Python', extensions: ['exe'] }] : [],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: true, runtime: null };

    const abs = path.resolve(result.filePaths[0]);
    if (!isPlausibleBin(abs)) return { ok: false, error: '这不像是一个可用的 Python' };
    const info = await probe(abs);
    if (!info) return { ok: false, error: '这不像是一个可用的 Python' };

    // 选中即授权：写进 settings.json 的 manualPath（全仓唯一一处「授权跨重启存活」），
    // 但每次启动仍要重新校验（见 rebuild ③）。
    await persistPython({ manualPath: abs });
    await rebuild();

    const runtime = runtimes.find((r) => path.resolve(r.displayPath) === abs);
    if (!runtime) return { ok: false, error: '这不像是一个可用的 Python' };
    selectedId = runtime.id;
    await persistPython({ selected: runtime.id });
    return { ok: true, runtime };
  });

  ipcMain.handle('py:install', async (_e, payload) => {
    if (install && install.phase !== 'done' && install.phase !== 'error') {
      return { ok: false, error: '已经有一个安装在进行中' };
    }
    return doInstall(String(payload?.catalogId ?? ''));
  });

  ipcMain.handle('py:cancelInstall', () => {
    installAbort?.abort();
    return { ok: true };
  });

  ipcMain.handle('py:uninstall', async (_e, payload) => {
    const runtimeId = String(payload?.runtimeId ?? '');
    const runtime = runtimes.find((r) => r.id === runtimeId);
    if (!runtime || runtime.source !== 'managed') {
      // 系统 Python 我们无权动它 —— 这条不是 UI 的自律，是主进程的拒绝
      return { ok: false, error: '只能删除 Polaris 自己装的 Python' };
    }
    const dir = dirById.get(runtimeId);
    // 【I7】删除方向同样要过越界防护：只有 runtimes/python/ 底下的东西才可能被删掉
    if (!dir || !isInside(path.resolve(dir), path.resolve(runtimesRoot()))) {
      return { ok: false, error: '非法的运行时路径' };
    }
    try {
      await fsp.rm(dir, { recursive: true, force: true });
    } catch (err) {
      // Windows 上正在跑的 python.exe 是被锁住的 —— 如实说，别给一句看不懂的 EBUSY
      const code = err?.code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') {
        return { ok: false, error: '删除失败：可能仍有终端会话在用它，请先关闭那些会话' };
      }
      return { ok: false, error: String(err?.message || err) };
    }
    await rebuild();
    if (selectedId === runtimeId) selectedId = null;
    if (readSettings().python?.selected === runtimeId) await persistPython({ selected: null });
    return { ok: true };
  });
}

/**
 * 【I2】runtimeId → 解释器绝对路径。**查不到就是 null，绝不猜。**
 *
 * terminalBridge.cjs 靠它把渲染层给的不透明 id 换成一个真实可执行文件 ——
 * 这是「渲染层永远不能命名任意可执行文件」这条不变量的物理实现。
 */
function resolveRuntimeBin(runtimeId) {
  return binById.get(String(runtimeId ?? '')) ?? null;
}

module.exports = { setupPythonBridge, resolveRuntimeBin };
