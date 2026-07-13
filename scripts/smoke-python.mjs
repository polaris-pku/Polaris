/**
 * 冒烟：在「一台没装 Python 的机器」上，从零装出一个 Python 并跑通一个 .py。
 *
 * 为什么需要它 —— 和 smoke-clean-path.mjs 是同一个教训的两面：
 *   **开发机的 PATH 上有一切，用户机上什么都没有。** 探测逻辑在开发机上永远绿，
 *   因为总能 `which python3` 到一个；用户机上探不到时会发生什么，只有把 PATH 剃干净才看得见。
 *
 * 它跑的是**真的那份代码** —— 用一个 electron 桩把 electron/pythonBridge.cjs 原样加载进来，
 * 而不是在这里重写一遍安装流水线（重写一遍 = 测的是副本，副本会漂移，那就等于没测）。
 *
 * 验收：
 *   ① 干净 PATH 下探测不到任何 Python（**一等状态**，不是静默回落到某个能跑的 python）
 *   ② 篡改 catalog 里的 sha256 → 安装必须停在「校验失败」，且**什么都不落地**
 *   ③ 恢复 sha256 → 下载 → 校验 → 解包 → 原子上架 → 真的能跑 hello.py
 *   ④ 运行时落在 userData 里，**没有往安装目录（仓库）写任何东西**
 *
 * 用法：node scripts/smoke-python.mjs        （要联网，会下载约 25–115 MB）
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-python-smoke-'));
const USER_DATA = path.join(tmp, 'userData');
const DOCUMENTS = path.join(tmp, 'documents');
const WS = path.join(DOCUMENTS, 'polaris-workspace', 'smoke');
fs.mkdirSync(WS, { recursive: true });

/** 收集主进程推出来的 py:event（相位序列本身就是验收对象）。 */
const events = [];
const handlers = new Map();

/**
 * electron 桩。pythonBridge / fsBridge / settings 都 require('electron')，
 * 但它们真正用到的只有 app.getPath / ipcMain.handle / dialog —— 桩掉这三个就能在裸 Node 里跑。
 */
const electronStub = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return USER_DATA;
      if (name === 'documents') return DOCUMENTS;
      return tmp;
    },
  },
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { showItemInFolder: () => {} },
};

const load = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return load.call(this, request, parent, isMain);
};

/** 干净机器：PATH 上没有任何 python（连 which 都找不到，正如一台裸机）。 */
const originalPath = process.env.PATH ?? '';
process.env.PATH = path.join(tmp, 'empty-bin');
fs.mkdirSync(process.env.PATH, { recursive: true });

const require = createRequire(import.meta.url);
const CATALOG_PATH = path.join(REPO, 'electron', 'python-catalog.json');
const catalog = require(CATALOG_PATH); // 与 pythonBridge 拿到的是**同一个对象**（模块缓存）
const { setupPythonBridge, resolveRuntimeBin } = require(
  path.join(REPO, 'electron', 'pythonBridge.cjs'),
);

/** 假窗口：只为把 py:event 收下来。真窗口的守卫（isDestroyed）在这里也要被走到。 */
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, payload) => {
      if (channel === 'py:event') events.push(payload);
    },
  },
};

const invoke = (channel, payload) => handlers.get(channel)(null, payload);
const fail = (msg) => {
  console.error(`\n❌ ${msg}`);
  cleanup();
  process.exit(1);
};
function cleanup() {
  process.env.PATH = originalPath;
  fs.rmSync(tmp, { recursive: true, force: true });
}

setupPythonBridge(() => fakeWindow);

// ── ① 干净 PATH 下探测不到任何 Python ────────────────────────────────────────
const detected = await invoke('py:detect');
if (!detected.ok) fail(`探测应当成功返回一个空集合，而不是报错：${detected.error}`);
console.log(
  `① 干净 PATH 下探测到的解释器：${String(detected.runtimes.length)} 个 ${detected.runtimes.length === 0 ? '✅' : '❌'}`,
);
if (detected.runtimes.length > 0) {
  fail('干净 PATH 下不该探测到任何 Python —— 探测逻辑在静默回落到某个能跑的 python');
}

const recommended = catalog.items.find((i) => i.catalogId === catalog.recommended);
const triple = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
}[`${process.platform}-${process.arch}`];
const asset = triple ? recommended.assets[triple] : null;
if (!asset) {
  console.log(
    `⏭  跳过：catalog 里没有 ${process.platform}-${process.arch} 的资产（这本身是一等状态，UI 会诚实显示）`,
  );
  cleanup();
  process.exit(0);
}

// ── ② 篡改 sha256 → 必须停在「校验失败」，且什么都不落地 ──────────────────────
// 这一步会**再下载一次**整个包（校验失败的包必须当场删掉，没法复用）。窄带机器上可以
// --skip-tamper 跳过，但那样就没有任何东西在证明 I8 了 —— 默认必须跑。
const skipTamper = process.argv.includes('--skip-tamper');
const realSha = asset.sha256;

if (skipTamper) {
  console.log('② ⏭  跳过篡改校验测试（--skip-tamper）—— I8 这一趟没有被验证');
} else {
  asset.sha256 = (realSha[0] === '0' ? '1' : '0') + realSha.slice(1); // 改一个字符就够了
  if (asset.sha256 === realSha) fail('篡改 sha256 失败（测试自身有问题）');

  console.log(
    `② 用被篡改的 sha256 安装 ${recommended.catalogId}（约 ${(asset.downloadBytes / 1048576).toFixed(1)} MB，会真的下载）…`,
  );
  const tampered = await invoke('py:install', { catalogId: recommended.catalogId });
  const tamperedRejected = !tampered.ok && tampered.error.includes('校验失败');
  console.log(
    `   结果：${tampered.ok ? '安装成功（❌ 校验形同虚设）' : tampered.error} ${tamperedRejected ? '✅' : '❌'}`,
  );
  if (!tamperedRejected) fail('校验和不匹配时必须拒绝安装 —— 这是 I8 的全部意义');

  const landedAfterTamper = fs.existsSync(
    path.join(USER_DATA, 'runtimes', 'python', recommended.catalogId),
  );
  console.log(`   校验失败后有没有落地：${landedAfterTamper ? '有 ❌' : '没有 ✅'}`);
  if (landedAfterTamper) fail('校验失败的包不允许落地 —— 半截/被篡改的运行时可能被选中执行');
}

// ── ③ 恢复 sha256 → 完整装一遍 → 真的跑一个 hello.py ────────────────────────
asset.sha256 = realSha;
events.length = 0;
console.log(`③ 用真实 sha256 重新安装…`);
const installed = await invoke('py:install', { catalogId: recommended.catalogId });
if (!installed.ok) fail(`安装失败：${installed.error}`);

const phases = [...new Set(events.map((e) => e.phase))];
console.log(
  `   相位序列：${phases.join(' → ')} ${phases.join(',') === 'download,verify,extract,done' ? '✅' : '❌'}`,
);
if (phases.join(',') !== 'download,verify,extract,done') {
  fail('相位必须是 下载 → 校验 → 解包 → 就绪 四步，且每一步都要推给界面');
}

const state = await invoke('py:getState');
const runtime = state.runtimes.find((r) => r.id === `managed:${recommended.catalogId}`);
if (!runtime) fail('装完了，但运行时清单里没有它');
if (state.selectedId !== runtime.id) fail('装完必须自动选中它（用户点安装就是为了用它）');

const bin = resolveRuntimeBin(runtime.id);
console.log(`   解释器：${bin ?? '(null)'} ${bin ? '✅' : '❌'}`);
if (!bin || !fs.existsSync(bin)) fail('resolveRuntimeBin 查不到 bin —— 终端将无法启动会话');

const hello = path.join(WS, 'hello.py');
fs.writeFileSync(hello, 'print("hello polaris")\n');
let output = '';
try {
  output = execFileSync(bin, ['-u', hello], { cwd: WS, timeout: 30_000, shell: false })
    .toString()
    .trim();
} catch (err) {
  fail(`装出来的 Python 跑不起来：${err.message}`);
}
console.log(`   跑 hello.py：${output} ${output === 'hello polaris' ? '✅' : '❌'}`);
if (output !== 'hello polaris') fail('装出来的 Python 跑不出预期输出');

console.log(`   版本：${runtime.version} ${runtime.version === recommended.version ? '✅' : '❌'}`);
if (runtime.version !== recommended.version) fail('装出来的版本与 catalog 不一致');

// ── ④ 落点：userData 里，安装目录（仓库）一个字节都没被写 ─────────────────────
const inUserData = path.resolve(bin).startsWith(path.resolve(USER_DATA) + path.sep);
console.log(`④ 运行时落在 userData 里：${inUserData ? '是 ✅' : '否 ❌'}`);
if (!inUserData)
  fail('运行时必须落在 userData —— 装到 Program Files 会 EPERM，且每次自动更新都被冲掉');

const leaked =
  fs.existsSync(path.join(REPO, 'runtimes')) ||
  fs.existsSync(path.join(REPO, 'electron', 'runtimes'));
console.log(`   写进安装目录：${leaked ? '是 ❌' : '否 ✅'}`);
if (leaked) fail('不许往安装目录写任何东西');

const tmpLeft = fs.existsSync(path.join(USER_DATA, 'runtimes', 'python', '.tmp'))
  ? fs.readdirSync(path.join(USER_DATA, 'runtimes', 'python', '.tmp'))
  : [];
console.log(`   .tmp 残留：${tmpLeft.length === 0 ? '无 ✅' : `${tmpLeft.join(', ')} ❌`}`);
if (tmpLeft.length > 0) fail('.tmp 必须被清干净（下载了几十 MB 的包不能永久留在那）');

console.log('\n✅ Python 运行时冒烟通过');
cleanup();
process.exit(0);
