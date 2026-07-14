/**
 * 打包后端：把 A + BCD + agent 运行时装进一个自包含的 `backend/` 目录。
 *
 * 打包后的机器上**没有** pnpm / tsc / tsx / npx，也不该要求用户先装 Claude Code。
 * 所以这里把运行时依赖全部物化：
 *
 *   backend/
 *     backend-host.cjs      BCD 后端（esbuild 单文件；driver 已注入为「包内 node 跑包内 A」）
 *     acp-runner.cjs        A 的 ACP runner（esbuild 单文件）
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
import { copyFileSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
const acpPkg = JSON.parse(readFileSync(path.join(root, 'packages/acp-client/package.json'), 'utf8'));
const agentVersion = acpPkg.dependencies['@agentclientprotocol/claude-agent-acp'];

console.log(`[backend] 目标平台 ${targetOs}-${targetCpu}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

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
  external: ['pg-native'],
};

console.log('[backend] 打包 BCD 后端宿主…');
await build({
  ...common,
  entryPoints: [path.join(root, 'electron/backend-host.ts')],
  outfile: path.join(out, 'backend-host.cjs'),
});

console.log('[backend] 打包 A 的 ACP runner…');
await build({
  ...common,
  entryPoints: [path.join(root, 'packages/acp-client/src/driver/contract-runner.ts')],
  outfile: path.join(out, 'acp-runner.cjs'),
});

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

// ── 3. agent 运行时（claude-agent-acp + Claude Code 原生二进制）──
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
  'npm.cmd',
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
console.log('[backend] 完成 →', path.relative(root, out));
