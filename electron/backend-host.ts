import path from 'node:path';
import { runBackendRpcMain } from '../packages/newide-bcd/src/app/backend-rpc-stdio';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Packaged backend is missing required environment variable: ${name}`);
  return value;
}

const nodeBin = requireEnv('POLARIS_NODE_BIN');
const agentDir = requireEnv('POLARIS_AGENT_DIR');
const workspace = requireEnv('ACP_WORKSPACE');
const agentId = process.env.ACP_AGENT_ID?.trim() || 'claude';
const isWindows = process.platform === 'win32';
const agentModules = path.join(agentDir, 'node_modules');
const acpAgentEntry = path.join(
  agentModules,
  '@agentclientprotocol/claude-agent-acp/dist/index.js',
);
const claudeBinary = path.join(
  agentModules,
  `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
  isWindows ? 'claude.exe' : 'claude',
);

process.env.PATH = [path.dirname(nodeBin), process.env.PATH].filter(Boolean).join(path.delimiter);
process.env.ACP_AGENT_ID = agentId;
process.env.ACP_WORKSPACE = workspace;
process.env.AUTO_APPROVE ??= '1';
process.env.CLAUDE_CLI_COMMAND = nodeBin;
process.env.CLAUDE_CLI_ARGS = `${acpAgentEntry} acp`;
process.env.CLAUDE_CODE_EXECUTABLE = claudeBinary;

runBackendRpcMain(process.env).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
