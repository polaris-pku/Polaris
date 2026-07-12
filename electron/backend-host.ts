/**
 * 打包版的 BCD 后端宿主。
 *
 * 为什么需要它：BCD 自带的 `createProductionBackendService()` 把 driver 写死成
 * `pnpm --dir <A> driver:run` —— 而 `driver:run` 又是 `tsc && node dist/...`。
 * 也就是说用户机器上得有 pnpm + tsc + node，还得每次调 agent 都重编译一遍。打包后这些都不存在。
 *
 * 但 BCD 留了公开注入口：`startBackendRpcServer({ service })` 接受外部构造的 service，
 * 而 `IntegrationV0CoordinatorRunner` / `NewideBackendService` 都允许注入 driver。
 * 所以这里自己组装一份，把 driver 的启动命令换成「包内的 node 跑包内编译好的 A」——
 * **BCD 和 A 的源码一个字都不用改**。
 *
 * 本文件由 scripts/build-backend.mjs 用 esbuild 打成单文件，随包分发。
 */
import path from 'node:path';
import { CommandDriverTransport, ExternalDriverRuntime } from '../packages/newide-bcd/src/driver';
import { InMemoryBufferRepository, InMemoryRepository } from '../packages/newide-bcd/src/memory';
import { IntegrationV0CoordinatorRunner } from '../packages/newide-bcd/src/coordinator/coordinator-runner';
import { SynthesisAgentCouncilProvider } from '../packages/newide-bcd/src/council';
import { DriverRuntimeAgentExecutionFacade } from '../packages/newide-bcd/src/app/driver-runtime-agent-execution-facade';
import { NewideBackendService } from '../packages/newide-bcd/src/app/newide-backend-service';
import { startBackendRpcServer } from '../packages/newide-bcd/src/app/backend-rpc-stdio';

/** 必需的环境变量；缺了就早失败，别让用户对着一个转圈的界面猜。 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`打包后端缺少环境变量：${name}`);
  return value;
}

const nodeBin = requireEnv('POLARIS_NODE_BIN'); // 随包的 Node 运行时
const acpRunner = requireEnv('POLARIS_ACP_RUNNER'); // A 的编译产物（单文件）
const agentDir = requireEnv('POLARIS_AGENT_DIR'); // 随包的 agent 运行时目录
const workspace = requireEnv('ACP_WORKSPACE'); // agent 的工作区

const agentId = process.env.ACP_AGENT_ID ?? 'claude';
const isWin = process.platform === 'win32';
const agentModules = path.join(agentDir, 'node_modules');

/** claude-agent-acp 的 JS 入口（ACP 协议外壳，用包内 node 跑） */
const acpAgentEntry = path.join(
  agentModules,
  '@agentclientprotocol/claude-agent-acp/dist/index.js',
);
/** Claude Code 本体：SDK 的平台专属 optionalDependency 提供的**原生二进制**（不需要 node） */
const claudeBinary = path.join(
  agentModules,
  `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
  isWin ? 'claude.exe' : 'claude',
);

const driverEnv: NodeJS.ProcessEnv = {
  ...process.env,
  ACP_AGENT_ID: agentId,
  ACP_WORKSPACE: workspace,

  // 必须开：否则 A 的默认 PermissionHandler 会去调 @inquirer/prompts 要一个 TTY，
  // 而子进程里没有 TTY —— 实测直接抛 "Internal error"，agent 一个字都写不出来。
  AUTO_APPROVE: '1',

  // 绕开 npx：A 的 adapter 默认是 `npx -y @agentclientprotocol/claude-agent-acp acp`，
  // 打包后的机器上没有 npx，也不该联网现拉。这两个变量是 A 自带的覆盖口（base-adapter）。
  CLAUDE_CLI_COMMAND: nodeBin,
  CLAUDE_CLI_ARGS: `${acpAgentEntry} acp`,

  // 让 agent 用**包内**的 Claude Code，而不是去找用户机器上的安装（claude-agent-acp 自带这个覆盖口）
  CLAUDE_CODE_EXECUTABLE: claudeBinary,

  // claude-agent-acp 内部会 spawn `node`（SDK 的 getDefaultExecutable 写死了 "node"）——
  // 实测 PATH 上没有 node 就必失败。把包内的 Node 放到 PATH 最前面。
  PATH: [path.dirname(nodeBin), process.env.PATH].filter(Boolean).join(path.delimiter),
};

const driver = new ExternalDriverRuntime({
  driver_id: 'acp-external',
  transport: new CommandDriverTransport({
    // 关键：不再是 `pnpm --dir <A> driver:run`（那还会 `tsc` 一遍），
    // 而是「包内 node + 包内编译好的 A」。用户机器上不需要 pnpm / tsc / npx / node。
    command: nodeBin,
    args: [acpRunner],
    cwd: process.cwd(),
    env: driverEnv,
  }),
});

const agentExecutionFacade = new DriverRuntimeAgentExecutionFacade({
  driver,
  repository: new InMemoryRepository(),
  bufferRepository: new InMemoryBufferRepository(),
});

const runner = new IntegrationV0CoordinatorRunner({
  driver,
  agentExecutionFacade,
  councilProvider: new SynthesisAgentCouncilProvider({ agentExecutionFacade }),
});

const server = startBackendRpcServer({
  input: process.stdin,
  writeLine: (line) => process.stdout.write(`${line}\n`),
  service: new NewideBackendService(runner),
  logError: (message) => process.stderr.write(`${message}\n`),
});

process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
