/**
 * 冒烟：在「一台没装 Node 的机器」上跑通一次真实 run。
 *
 * 为什么需要它 —— 这是一个真实发生过、且开发机永远测不出来的 bug：
 *   BCD 的默认 hook 在 task.completed 上挂了一个 command gate（`node -e "process.exit(0)"`），
 *   gate/command-runner.ts 用 `child_process.exec(cmd)` 执行，**不传 env**，继承的是后端宿主
 *   自己的 process.env。宿主如果没把包内 Node 前置进**自己的** PATH（而只塞给了 driver 的 env），
 *   那么在用户机器上这条 no-op 命令就会报「'node' 不是内部或外部命令」→ gate 判 deny →
 *   GATE_DENIED → 选中 0 个产物。agent 明明干完了活，界面却报运行失败、产出为空。
 *   开发者自己装了 Node，PATH 上恰好有，于是永远绿。
 *
 * 本脚本把 node 从 PATH 里剔掉再跑完整链路，验收：gate=allow、run.completed、文件真的落盘、
 * 且**不往安装目录写任何东西**。
 *
 * 用法：
 *   pnpm build:backend && node scripts/smoke-clean-path.mjs
 * 需要 agent 认证（ANTHROPIC_API_KEY 或本机 Claude Code 登录态）——没有就直接跳过。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = path.join(REPO, 'backend');
const NODE_BIN = path.join(BACKEND, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const HOST = path.join(BACKEND, 'backend-host.cjs');

if (!fs.existsSync(NODE_BIN) || !fs.existsSync(HOST)) {
  console.error('❌ backend/ 未构建。先跑：pnpm build:backend');
  process.exit(1);
}

const hasAuth =
  !!process.env.ANTHROPIC_API_KEY ||
  !!process.env.ANTHROPIC_AUTH_TOKEN ||
  fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
if (!hasAuth) {
  console.log('⏭  跳过：没有 agent 认证（ANTHROPIC_API_KEY 或本机 Claude Code 登录态）');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-smoke-'));
const WS = path.join(tmp, 'ws');
const STATE = path.join(tmp, 'state');
fs.mkdirSync(WS, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });

/**
 * 「干净机器」= 完整的系统 env（Electron 传给后端的就是 process.env），**只是 PATH 上没有 node**。
 * 只留 HOME 之类的极简 env 会让 agent 直接 "Internal error"（它还要 SHELL/TMPDIR/… ），
 * 那是环境剥太狠造成的假阳性，不是我们要测的东西。
 */
const sep = path.delimiter;
const nodeDir = path.dirname(process.execPath);
const cleanPath = (process.env.PATH || '')
  .split(sep)
  .filter((p) => p && p !== nodeDir && !p.includes(`${path.sep}.nvm${path.sep}`))
  .join(sep);

const child = spawn(NODE_BIN, [HOST], {
  cwd: STATE, // 与 electron/backendBridge.cjs 一致：BCD 的相对路径产物落在状态目录
  env: {
    ...process.env,
    PATH: cleanPath,
    POLARIS_NODE_BIN: NODE_BIN,
    POLARIS_ACP_RUNNER: path.join(BACKEND, 'acp-runner.cjs'),
    POLARIS_AGENT_DIR: path.join(BACKEND, 'agent'),
    POLARIS_STATE_DIR: STATE,
    ACP_AGENT_ID: 'claude',
    ACP_WORKSPACE: WS,
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const events = [];
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.method === 'run.event') {
      events.push(msg.params.event);
    } else if (msg.id === 1 && msg.result?.run_id) {
      // 事件不会主动推，必须显式订阅
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'run.subscribe', params: { run_id: msg.result.run_id } })}\n`,
      );
    }
  }
});

child.stdin.write(
  `${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'run.create',
    params: { prompt: '在工作区创建 hello.py，内容是 print("hello polaris")。只做这一件事。', mode: 'single_agent' },
  })}\n`,
);

const outcome = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('timeout'), 240_000);
  const poll = setInterval(() => {
    if (events.some((e) => e.type === 'run.completed' || e.type === 'run.failed')) {
      clearTimeout(timer);
      clearInterval(poll);
      resolve('done');
    }
  }, 500);
});
child.kill('SIGTERM');

const gates = events.filter((e) => e.type === 'gate.result');
const completed = events.some((e) => e.type === 'run.completed');
const failed = events.find((e) => e.type === 'run.failed');
const files = fs.existsSync(WS) ? fs.readdirSync(WS) : [];
const leaked = fs.existsSync(path.join(BACKEND, '.newide'));

console.log(`PATH 上有 node:   ${cleanPath.split(sep).some((p) => fs.existsSync(path.join(p, 'node'))) ? '是（测试无效！）' : '否 ✅'}`);
console.log(`gate 判定:        ${gates.map((g) => g.payload.decision).join(', ') || '(无)'}`);
console.log(`run 结果:         ${completed ? 'run.completed' : failed ? `run.failed (${failed.payload.code})` : `(${outcome})`}`);
console.log(`工作区文件:       ${files.join(', ') || '(空)'}`);
console.log(`写进安装目录:     ${leaked ? '是 ❌' : '否 ✅'}`);

fs.rmSync(tmp, { recursive: true, force: true });

const ok = gates.length > 0 && gates.every((g) => g.payload.decision === 'allow') && completed && files.length > 0 && !leaked;
console.log(ok ? '\n✅ 干净机器冒烟通过' : '\n❌ 干净机器冒烟失败');
process.exit(ok ? 0 : 1);
