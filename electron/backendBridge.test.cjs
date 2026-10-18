const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const { PassThrough } = require('node:stream');
const test = require('node:test');

test('serializes restarts, preserves API authentication and reports B Memory settings', async (t) => {
  const handlers = new Map();
  const appHandlers = new Map();
  const processes = [];
  const statuses = [];
  let appQuitCalls = 0;
  const settings = {
    provider: 'anthropic',
    providers: { anthropic: { key: 'test-key' } },
  };
  const originalDatabaseUrl = process.env.NEWIDE_B_DATABASE_URL;
  const originalLoad = Module._load;
  const originalSetTimeout = global.setTimeout;

  function fakeProcess(command, args, options) {
    assert.equal(typeof command, 'string');
    assert.ok(Array.isArray(args));
    const proc = new EventEmitter();
    proc.spawnOptions = options;
    proc.pid = 10_000 + processes.length;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.requests = [];
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = {
      writable: true,
      ended: false,
      write(line) {
        const request = JSON.parse(String(line));
        proc.requests.push(request);
        queueMicrotask(async () => {
          let result;
          if (request.method === 'system.ping') result = { protocol_version: 'test' };
          else if (request.method === 'system.readiness') {
            result = { service: { status: 'operational' } };
          } else if (request.method === 'task.list') {
            result = { tasks: [{ task: { task_id: 'active-task' }, current_run: {} }] };
          } else if (request.method === 'task.interrupt') {
            await proc.interruptWait;
            result = { task: { task_id: 'active-task', status: 'blocked' } };
          } else if (request.method === 'task.create') {
            await proc.createWait;
            result = { task: { task_id: 'active-task', status: 'executing' }, current_run: {} };
          } else assert.fail(`Unexpected RPC: ${request.method}`);
          proc.stdout.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result,
            })}\n`,
          );
        });
        return true;
      },
      end() {
        this.writable = false;
        this.ended = true;
      },
    };
    proc.kill = () => proc.finish();
    proc.finish = () => {
      if (proc.exitCode !== null) return;
      proc.exitCode = 0;
      proc.stdout.end();
      proc.stderr.end();
      proc.emit('exit', 0);
    };
    processes.push(proc);
    return proc;
  }

  global.setTimeout = (callback, delay, ...args) => {
    const timer = originalSetTimeout(callback, delay, ...args);
    if (delay >= 60_000) timer.unref();
    return timer;
  };
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath: () => '/tmp/polaris-backend-bridge-test',
          on(name, handler) {
            appHandlers.set(name, handler);
          },
          quit() {
            appQuitCalls += 1;
          },
        },
        ipcMain: {
          handle(name, handler) {
            handlers.set(name, handler);
          },
        },
      };
    }
    if (request === 'child_process') return { spawn: fakeProcess };
    if (request === 'fs') {
      return {
        ...fs,
        copyFileSync: () => {},
        existsSync: () => true,
        mkdirSync: () => {},
        readdirSync: () => [],
        rmSync: () => {},
        writeFileSync: () => {},
      };
    }
    if (request === './fsBridge.cjs') {
      return { resolveProjectRoot: () => ({ root: '/tmp/project' }) };
    }
    if (request === './settings.cjs') {
      return {
        readSettings: () => settings,
        writeSettings: async () => {},
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const bridgePath = require.resolve('./backendBridge.cjs');
  delete require.cache[bridgePath];
  const bridge = require(bridgePath);
  Module._load = originalLoad;

  t.after(async () => {
    const stopping = bridge.stopBackend();
    await new Promise(setImmediate);
    processes.at(-1)?.finish();
    await stopping;
    global.setTimeout = originalSetTimeout;
    Module._load = originalLoad;
    delete require.cache[bridgePath];
    if (originalDatabaseUrl === undefined) delete process.env.NEWIDE_B_DATABASE_URL;
    else process.env.NEWIDE_B_DATABASE_URL = originalDatabaseUrl;
  });

  bridge.setupBackendBridge(() => ({
    webContents: {
      send(channel, payload) {
        if (channel === 'backend:status') statuses.push(payload);
      },
    },
  }));
  await new Promise(setImmediate);
  assert.equal(processes.length, 1);
  const env = processes[0].spawnOptions.env;
  assert.equal(env.ANTHROPIC_API_KEY, 'test-key');
  assert.equal(env.NEWIDE_LLM_API_KEY, 'test-key');
  assert.equal(env.NEWIDE_LLM_PROVIDER, 'anthropic');
  assert.equal(env.NEWIDE_LLM_CREDENTIALLESS, undefined);
  assert.equal(env.POLARIS_MODEL_PROXY_BASE_URL, undefined);
  assert.equal(env.NEWIDE_EPHEMERAL_ACP_SESSIONS, '0');
  assert.ok(env.CLAUDE_CONFIG_DIR.endsWith('backend-state/rpc-v1/claude-config'));
  const publicSettings = await handlers.get('backend:getSettings')();
  assert.equal(publicSettings.provider, 'anthropic');
  assert.equal(publicSettings.configured.anthropic.hasKey, true);
  assert.equal(Object.hasOwn(publicSettings, 'modelProxy'), false);
  assert.equal(JSON.stringify(publicSettings).includes('test-key'), false);

  settings.provider = 'custom';
  settings.providers.custom = {
    key: 'custom-test-key',
    baseUrl: 'https://models.example.test/anthropic',
    model: 'custom-model',
    fastModel: 'custom-fast-model',
  };
  let confirmInterrupt;
  processes[0].interruptWait = new Promise((resolve) => {
    confirmInterrupt = resolve;
  });
  let finishCreate;
  processes[0].createWait = new Promise((resolve) => {
    finishCreate = resolve;
  });
  const creating = handlers.get('backend:call')(null, { method: 'task.create', params: {} });
  await new Promise(setImmediate);
  const restart = handlers.get('backend:restart')();
  const racingCreate = handlers.get('backend:call')(null, { method: 'task.create', params: {} });
  await new Promise(setImmediate);
  const waitingForReady = handlers.get('backend:call')(null, { method: 'system.ping' });
  assert.equal(processes[0].stdin.ended, false, 'closed before interruption was confirmed');
  assert.equal((await racingCreate).ok, false);
  assert.equal(
    processes[0].requests.filter((request) => request.method === 'task.create').length,
    1,
  );
  assert.equal(
    processes[0].requests.some((request) => request.method === 'task.list'),
    false,
  );
  finishCreate();
  assert.equal((await creating).ok, true);
  await new Promise(setImmediate);
  assert.equal(processes[0].requests.at(-1).method, 'task.interrupt');
  assert.equal(processes[0].stdin.ended, false);
  confirmInterrupt();
  await new Promise(setImmediate);
  assert.equal(processes[0].stdin.ended, true);
  assert.equal(processes.length, 1, 'replacement spawned before the old backend exited');

  processes[0].finish();
  await restart;
  assert.equal(
    (await waitingForReady).ok,
    true,
    'planned exit rejected a replacement readiness waiter',
  );
  assert.equal(
    statuses.some((entry) => entry.state === 'stopped'),
    false,
    'normal replacement was broadcast as a stopped backend',
  );
  assert.equal(processes.length, 2);
  const customEnv = processes[1].spawnOptions.env;
  assert.equal(customEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(customEnv.ANTHROPIC_AUTH_TOKEN, 'custom-test-key');
  assert.equal(customEnv.ANTHROPIC_BASE_URL, 'https://models.example.test/anthropic');
  assert.equal(customEnv.ANTHROPIC_MODEL, 'custom-model');
  assert.equal(customEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'custom-fast-model');
  assert.equal(customEnv.NEWIDE_LLM_API_KEY, 'custom-test-key');
  assert.equal(customEnv.NEWIDE_LLM_BASE_URL, 'https://models.example.test/anthropic/v1');
  const customSettings = await handlers.get('backend:getSettings')();
  assert.equal(customSettings.provider, 'custom');
  assert.equal(customSettings.configured.custom.hasKey, true);
  assert.equal(JSON.stringify(customSettings).includes('custom-test-key'), false);

  delete process.env.NEWIDE_B_DATABASE_URL;
  assert.deepEqual((await handlers.get('backend:getSettings')()).bMemory, {
    configured: false,
    source: 'pglite',
    environmentConfigured: false,
  });

  process.env.NEWIDE_B_DATABASE_URL = 'postgres://environment';
  assert.deepEqual((await handlers.get('backend:getSettings')()).bMemory, {
    configured: true,
    source: 'environment',
    environmentConfigured: true,
  });

  settings.bMemory = { databaseUrl: 'postgres://settings' };
  assert.deepEqual((await handlers.get('backend:getSettings')()).bMemory, {
    configured: true,
    source: 'settings',
    environmentConfigured: true,
  });

  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url) => {
    assert.equal(url, 'http://127.0.0.1:4143/accounts/test/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'proxy-model' }] }));
  };
  settings.modelProxy = { baseUrl: 'http://127.0.0.1:4143/accounts/test', model: 'proxy-model' };
  const localRestart = handlers.get('backend:restart')();
  await new Promise(setImmediate);
  processes[1].finish();
  await localRestart;
  assert.equal(processes.length, 3);
  const localEnv = processes[2].spawnOptions.env;
  assert.equal(localEnv.POLARIS_MODEL_PROXY_BASE_URL, settings.modelProxy.baseUrl);
  assert.equal(localEnv.POLARIS_MODEL_PROXY_MODEL, 'proxy-model');
  assert.equal(localEnv.NEWIDE_LLM_CREDENTIALLESS, '1');
  assert.equal(localEnv.NEWIDE_LLM_API_KEY, undefined);
  assert.equal(localEnv.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(localEnv.ANTHROPIC_API_KEY, undefined);
  const localStatus = handlers.get('backend:getStatus')();
  assert.equal(localStatus.auth.providerId, 'local-proxy');
  assert.equal(localStatus.auth.model, 'proxy-model');
  assert.equal(localStatus.auth.ready, true);
  assert.equal((await handlers.get('backend:getSettings')()).provider, 'local-proxy');

  processes[2].finish();
  const unexpectedExit = handlers.get('backend:getStatus')();
  assert.equal(unexpectedExit.state, 'error');
  assert.match(unexpectedExit.message, /意外退出.*code=0/);
  assert.equal(
    (await handlers.get('backend:call')(null, { method: 'system.ping' })).ok,
    false,
    'unexpected exits must remain explicit failures',
  );
  await handlers.get('backend:restart')();
  assert.equal(processes.length, 4);
  assert.equal(handlers.get('backend:getStatus')().state, 'ready');

  let quitPrevented = false;
  appHandlers.get('before-quit')({
    preventDefault() {
      quitPrevented = true;
    },
  });
  await new Promise(setImmediate);
  assert.equal(quitPrevented, true);
  assert.equal(processes[3].stdin.ended, true);
  assert.equal(appQuitCalls, 0, 'app quit before the backend exited');

  processes[3].finish();
  await new Promise(setImmediate);
  assert.equal(appQuitCalls, 1);
});
