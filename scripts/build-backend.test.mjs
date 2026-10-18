import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const exec = promisify(execFile);

async function checkPackagedRpc(out) {
  const workspace = path.join(out, 'project');
  const agent = path.join(out, 'agent-fixture');
  const packageDir = path.join(agent, 'node_modules/@agentclientprotocol/claude-agent-acp');
  await mkdir(path.join(workspace, '.agent'), { recursive: true });
  await mkdir(path.join(packageDir, 'dist'), { recursive: true });
  await writeFile(path.join(packageDir, 'package.json'), '{"type":"module"}');
  await writeFile(
    path.join(workspace, '.agent/drivers.yaml'),
    'version: 1\ndrivers:\n  explicit-project:\n    agent: claude\n',
  );
  await build({
    entryPoints: ['packages/acp-client/tests/fixtures/probe-agent.ts'],
    outfile: path.join(packageDir, 'dist/index.js'),
    platform: 'node',
    format: 'esm',
  });
  const env = {
    ...process.env,
    POLARIS_NODE_BIN: process.execPath,
    POLARIS_AGENT_DIR: agent,
    ACP_WORKSPACE: workspace,
    ACP_DRIVER_RUNNER_DIR: path.join(out, 'acp-runner'),
    NEWIDE_STATE_ROOT: path.join(out, 'state'),
    NEWIDE_B_DATABASE_URL: '',
    NEWIDE_B_EMBEDDING_PROVIDER: 'hash',
    NEWIDE_LITELLM_CONFIG_DIR: path.join(out, 'config'),
    NODE_PATH: path.resolve('packages/newide-bcd/node_modules'),
  };
  for (const id of [
    'gemini',
    'aider',
    'codex',
    'kimi',
    'codebuddy',
    'copilot',
    'opencode',
    'goose',
    'kiro',
  ]) {
    env[`${id.toUpperCase()}_CLI_COMMAND`] = path.join(out, 'intentionally-missing-cli');
  }
  const child = spawn(process.execPath, [path.join(out, 'backend-host.cjs')], {
    cwd: out,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  const pending = new Map();
  let nextId = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  async function rpc(method, params = {}) {
    const id = ++nextId;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return Promise.race([
      reply,
      exited.then((result) => {
        throw new Error(`Packaged backend exited: ${JSON.stringify(result)}\n${stderr}`);
      }),
    ]);
  }
  try {
    const ready = await rpc('system.readiness');
    assert.equal(ready.error, undefined, JSON.stringify(ready));
    assert.notEqual(ready.result.service.status, 'unavailable');
    const config = await rpc('driver.getConfig');
    assert.equal(config.error, undefined, JSON.stringify(config));
    assert.ok(config.result.drivers.some((driver) => driver.driver_id === 'explicit-project'));
    const probe = await rpc('driver.probe', { agent_ids: ['claude'], timeout_ms: 2000 });
    assert.equal(probe.error, undefined, JSON.stringify(probe));
    assert.equal(probe.result.drivers.length, 1);
    assert.equal(probe.result.drivers[0].initialize.protocolVersion, 1);
    const refreshed = await rpc('driver.refresh', {
      agent_ids: ['claude'],
      timeout_ms: 2000,
      force: true,
    });
    assert.equal(refreshed.error, undefined, JSON.stringify(refreshed));
    const memory = await rpc('memory.getCapabilities');
    assert.equal(memory.error, undefined, JSON.stringify(memory));
    assert.equal(
      memory.result.capabilities.schema_version,
      'newide.b-memory-capabilities.v4',
      JSON.stringify(memory.result.capabilities),
    );
    assert.equal(memory.result.capabilities.memory_maintenance.ownership, 'external');
    const interrupted = await rpc('task.interrupt', { task_id: 'nonexistent' });
    assert.ok(interrupted.error);
    assert.notEqual(interrupted.error.code, -32601);
    child.stdin.end();
    assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
  } finally {
    clearTimeout(timer);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}

test('bundle-only builds preserve existing runtime assets and ship an importable ACP probe', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'polaris-backend-bundles-'));
  const sentinel = path.join(out, 'existing-runtime-asset');
  try {
    await writeFile(sentinel, 'preserve existing runtime');
    await exec(process.execPath, [
      'scripts/build-backend.mjs',
      '--bundles-only',
      `--out-dir=${out}`,
    ]);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve existing runtime');
    assert.ok((await readFile(path.join(out, 'backend-host.cjs'))).length > 0);
    assert.ok(
      (await readFile(path.join(out, 'acp-runner/dist/src/driver/contract-runner.js'))).length > 0,
    );
    const probe = await import(
      pathToFileURL(path.join(out, 'acp-runner/dist/src/driver-adapter/probe.js')).href
    );
    assert.equal(typeof probe.probeAgents, 'function');
    assert.equal(await probe.probeAgent('mock-driver'), null);
    await checkPackagedRpc(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
