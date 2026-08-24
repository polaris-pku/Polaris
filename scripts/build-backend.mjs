/**
 * 打包后端：把 A + BCD + agent 运行时装进一个自包含的 `backend/` 目录。
 *
 * 打包后的机器上**没有** pnpm / tsc / tsx / npx，也不该要求用户先装 Claude Code。
 * 所以这里把运行时依赖全部物化：
 *
 *   backend/
 *     backend-host.cjs      BCD production composition（esbuild 单文件）
 *     acp-runner/           production factory 期望的 A runner package layout
 *     config/               B Agent / Memory 的 LiteLLM 路由配置
 *     runtime/node[.exe]    Node 运行时（agent 的 JS 外壳要用；agent 本体是原生二进制）
 *     agent/                claude-agent-acp + Claude Code 原生二进制（npm 扁平安装）
 *
 * node-pty 被替换成桩：A 静态 import 了 PtyConnection，但 ACP 路径一次都不会用到它。
 * 为一个从不执行的 import 去做原生模块的跨平台编译不值得（见 scripts/stub-node-pty.cjs）。
 *
 * 用法：node scripts/build-backend.mjs [--target-os=win32] [--target-cpu=x64]
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'backend');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const targetOs = arg('target-os', process.platform);
const targetCpu = arg('target-cpu', process.arch);

/** agent 版本跟 A 的依赖走，不另立一套版本号 */
const acpPkg = JSON.parse(
  readFileSync(path.join(root, 'packages/acp-client/package.json'), 'utf8'),
);
const agentVersion = acpPkg.dependencies['@agentclientprotocol/claude-agent-acp'];

console.log(`[backend] 目标平台 ${targetOs}-${targetCpu}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// PGlite 相关包与版本以 BCD 的 package.json 为准，避免打包产物与源码依赖漂移。
const bcdPkg = JSON.parse(
  readFileSync(path.join(root, 'packages/newide-bcd/package.json'), 'utf8'),
);
const PGLITE_PACKAGES = ['@electric-sql/pglite', '@electric-sql/pglite-pgvector'];
const pgliteSpecs = PGLITE_PACKAGES.map((name) => {
  const range = bcdPkg.dependencies?.[name];
  if (!range) throw new Error(`packages/newide-bcd/package.json 缺少依赖 ${name}`);
  return `${name}@${range}`;
});

// ── 1. esbuild：把 TS 直接打成单文件（不需要 tsc，也不需要 tsx）──

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'warning',
  // node-pty 换桩：A 静态 import 了它，但 ACP 路径用不到（见桩文件里的说明）
  alias: { 'node-pty': path.join(root, 'scripts/stub-node-pty.cjs') },
  // pg 只被 BCD 的可选适配器引用，不在 RPC 路径上；它的原生加速包更是可选的
  //
  // PGlite（嵌入式 WASM PostgreSQL，B 的默认存储）必须外置：它在运行时用
  // `new URL('./pglite.wasm', import.meta.url)` 这类相对 URL 去取 .wasm 与扩展的 .tar.gz。
  // 一旦被打进单文件 CJS，esbuild 会把 import.meta.url 换成 shim，URL 构造直接抛
  // 「Invalid URL」，后端在 B 运行时就绪检查那一步就起不来。外置后由下面第 5 步
  // 装进 backend/node_modules，运行时从磁盘解析（两个包都提供 CJS 入口）。
  external: ['pg-native', ...PGLITE_PACKAGES],
  // esbuild 把 ESM 的 import.meta 编成空对象（产物里就是 `var import_meta = {}`），
  // 于是任何 `fileURLToPath(import.meta.url)` 都拿到 undefined 并抛 ERR_INVALID_ARG_TYPE。
  // BCD 用它定位 .env（litellm 客户端的 loadLocalEnv）。给它一个指向产物自身的真实 URL，
  // 找不到 .env 时 loadEnvFile 自己会吞掉异常。
  define: { 'import.meta.url': '__polarisModuleUrl' },
  banner: {
    js: "const __polarisModuleUrl = require('node:url').pathToFileURL(__filename).href;",
  },
};

console.log('[backend] 打包 BCD 后端宿主…');
await build({
  ...common,
  entryPoints: [path.join(root, 'electron/backend-host.ts')],
  outfile: path.join(out, 'backend-host.cjs'),
});

console.log('[backend] 打包 A 的 ACP runner…');
const acpRunnerDir = path.join(out, 'acp-runner');
const acpRunnerEntry = path.join(acpRunnerDir, 'dist', 'src', 'driver', 'contract-runner.js');
mkdirSync(path.dirname(acpRunnerEntry), { recursive: true });
await build({
  ...common,
  entryPoints: [path.join(root, 'packages/acp-client/src/driver/contract-runner.ts')],
  outfile: acpRunnerEntry,
});
writeFileSync(
  path.join(acpRunnerDir, 'package.json'),
  JSON.stringify(
    {
      name: acpPkg.name,
      version: acpPkg.version,
      private: true,
      scripts: { 'driver:run': 'node dist/src/driver/contract-runner.js' },
    },
    null,
    2,
  ),
);

console.log('[backend] 复制 B Agent / Memory 模型配置…');
cpSync(path.join(root, 'packages/newide-bcd/src/litellm/config'), path.join(out, 'config'), {
  recursive: true,
});
writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify({ name: 'polaris-backend', private: true, version: '0.1.0' }, null, 2),
);

// ── 2. Node 运行时 ──
// agent 的 JS 外壳（claude-agent-acp）要用 node 跑；Claude Code 本体是原生二进制，不需要 node。
// 交叉打包（在 Linux 上打 Windows 包）时本机的 node 用不了，从 nodejs.org 取对应平台的。

const nodeExe = targetOs === 'win32' ? 'node.exe' : 'node';
mkdirSync(path.join(out, 'runtime'), { recursive: true });

if (targetOs === process.platform && targetCpu === process.arch) {
  console.log('[backend] 复制本机 Node 运行时…');
  copyFileSync(process.execPath, path.join(out, 'runtime', nodeExe));
} else {
  const version = process.version; // 与开发/CI 环境同版本，避免行为漂移
  const plat = targetOs === 'win32' ? 'win' : targetOs;
  const name = `node-${version}-${plat}-${targetCpu}`;
  const ext = targetOs === 'win32' ? 'zip' : 'tar.xz';
  const url = `https://nodejs.org/dist/${version}/${name}.${ext}`;
  console.log(`[backend] 交叉打包，下载 Node 运行时：${url}`);
  const tmp = path.join(out, '.node-dl');
  mkdirSync(tmp, { recursive: true });
  execFileSync('curl', ['-fsSL', '-o', path.join(tmp, `n.${ext}`), url], { stdio: 'inherit' });
  if (ext === 'zip') {
    execFileSync('unzip', ['-q', path.join(tmp, 'n.zip'), '-d', tmp], { stdio: 'inherit' });
    copyFileSync(path.join(tmp, name, 'node.exe'), path.join(out, 'runtime', nodeExe));
  } else {
    execFileSync('tar', ['-xJf', path.join(tmp, 'n.tar.xz'), '-C', tmp], { stdio: 'inherit' });
    copyFileSync(path.join(tmp, name, 'bin', 'node'), path.join(out, 'runtime', nodeExe));
  }
  rmSync(tmp, { recursive: true, force: true });
}

// ── 3. Windows 便携 PostgreSQL ──
if (targetOs === 'win32' && targetCpu === 'x64') {
  const catalog = JSON.parse(
    readFileSync(path.join(root, 'scripts/postgres-runtime.json'), 'utf8'),
  );
  const pgOut = path.join(out, 'runtime', 'postgres', catalog.major);
  const tmp = path.join(out, '.postgres-dl');
  mkdirSync(tmp, { recursive: true });
  const archive = path.join(tmp, 'postgres.zip');
  console.log(`[backend] 下载 PostgreSQL ${catalog.version} Windows x64…`);
  execFileSync('curl', ['-fsSL', '-o', archive, catalog.windowsX64.url], { stdio: 'inherit' });
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (digest !== catalog.windowsX64.sha256) {
    throw new Error(`PostgreSQL archive SHA-256 mismatch: ${digest}`);
  }
  execFileSync(
    'unzip',
    [
      '-q',
      archive,
      'pgsql/bin/*',
      'pgsql/lib/*',
      'pgsql/share/*',
      'pgsql/server_license.txt',
      'pgsql/commandlinetools_3rd_party_licenses.txt',
      '-d',
      tmp,
    ],
    { stdio: 'inherit' },
  );
  mkdirSync(pgOut, { recursive: true });
  for (const name of ['bin', 'lib', 'share']) {
    cpSync(path.join(tmp, 'pgsql', name), path.join(pgOut, name), { recursive: true });
  }
  mkdirSync(path.join(pgOut, 'licenses'), { recursive: true });
  for (const name of ['server_license.txt', 'commandlinetools_3rd_party_licenses.txt']) {
    copyFileSync(path.join(tmp, 'pgsql', name), path.join(pgOut, 'licenses', name));
  }
  const required = [
    'postgres.exe',
    'initdb.exe',
    'pg_ctl.exe',
    'pg_isready.exe',
    'createdb.exe',
    'psql.exe',
  ];
  for (const name of required) {
    if (!existsSync(path.join(pgOut, 'bin', name)))
      throw new Error(`PostgreSQL runtime missing ${name}`);
  }
  writeFileSync(
    path.join(pgOut, 'manifest.json'),
    JSON.stringify(
      { version: catalog.version, major: catalog.major, archiveSha256: digest },
      null,
      2,
    ),
  );
  rmSync(tmp, { recursive: true, force: true });
}

// ── 4. agent 运行时（claude-agent-acp + Claude Code 原生二进制）──
//
// 不能直接从 pnpm 的 node_modules 拷 —— 那是符号链接 + 内容寻址的 store，拷不成自包含的树。
// 用 npm 扁平安装到一个干净目录：它会按 --os/--cpu 拉正确的平台专属二进制
// （Claude Code CLI 是 SDK 的 optionalDependency，win32 上就是 claude.exe）。

console.log(`[backend] 安装 agent 运行时（${agentVersion}）…`);
const agentDir = path.join(out, 'agent');
mkdirSync(agentDir, { recursive: true });
writeFileSync(
  path.join(agentDir, 'package.json'),
  JSON.stringify({ name: 'polaris-agent-runtime', private: true, version: '0.0.0' }, null, 2),
);
execFileSync(
  'npm',
  [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    `--os=${targetOs}`,
    `--cpu=${targetCpu}`,
    `@agentclientprotocol/claude-agent-acp@${agentVersion}`,
  ],
  { cwd: agentDir, stdio: 'inherit', shell: true },
);

// 校验：Claude Code 的原生二进制必须真的躺在那里，否则打出来的包是个空壳
const claudeBin = targetOs === 'win32' ? 'claude.exe' : 'claude';
const sdkPlatformPkg = `@anthropic-ai/claude-agent-sdk-${targetOs}-${targetCpu}`;
const claudePath = path.join(agentDir, 'node_modules', sdkPlatformPkg, claudeBin);
if (!existsSync(claudePath)) {
  throw new Error(
    `agent 二进制缺失：${claudePath}\n` +
      `预期由 ${sdkPlatformPkg}（SDK 的平台专属 optionalDependency）提供。`,
  );
}
console.log(`[backend] ✅ agent 二进制就位：${path.relative(root, claudePath)}`);
// ── 5. PGlite 运行时（B 的默认嵌入式存储）──
//
// 和 agent 同理：不能从 pnpm 的 node_modules 拷（符号链接 + 内容寻址 store）。
// 装到 backend/ 自己的 node_modules，backend-host.cjs 就在这一层，require 能直接解析到。

console.log(`[backend] 安装 PGlite 运行时（${pgliteSpecs.join(', ')}）…`);
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', ...pgliteSpecs], {
  cwd: out,
  stdio: 'inherit',
  shell: true,
});

// 校验：WASM 必须真的落盘，否则后端会在 B 就绪检查处以「Invalid URL」失败
for (const asset of ['pglite.wasm', 'pglite.data']) {
  const assetPath = path.join(out, 'node_modules/@electric-sql/pglite/dist', asset);
  if (!existsSync(assetPath)) {
    throw new Error(`PGlite 资源缺失：${assetPath}`);
  }
}
console.log('[backend] ✅ PGlite 资源就位');

console.log('[backend] 完成 →', path.relative(root, out));
