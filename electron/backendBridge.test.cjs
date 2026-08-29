const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const { PassThrough } = require('node:stream');
const test = require('node:test');

test('serializes restarts and reports the effective B Memory database source', async (t) => {
  const handlers = new Map();
  const appHandlers = new Map();
  const processes = [];
  let appQuitCalls = 0;
  const settings = {
    provider: 'anthropic',
    providers: { anthropic: { key: 'test-key' } },
  };
  const originalDatabaseUrl = process.env.NEWIDE_B_DATABASE_URL;
  const originalLoad = Module._load;
  const originalSetTimeout = global.setTimeout;

  function fakeProcess() {
    const proc = new EventEmitter();
    proc.pid = 10_000 + processes.length;
    proc.exitCode = null;
    proc.signalCode = null;
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = {
      writable: true,
      ended: false,
      write(line) {
        const request = JSON.parse(String(line));
        queueMicrotask(() => {
          proc.stdout.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: { protocol_version: 'test' },
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

  bridge.setupBackendBridge(() => null);
  await new Promise(setImmediate);
  assert.equal(processes.length, 1);

  const restart = handlers.get('backend:restart')();
  await new Promise(setImmediate);
  assert.equal(processes[0].stdin.ended, true);
  assert.equal(processes.length, 1, 'replacement spawned before the old backend exited');

  processes[0].finish();
  await restart;
  assert.equal(processes.length, 2);

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

  let quitPrevented = false;
  appHandlers.get('before-quit')({
    preventDefault() {
      quitPrevented = true;
    },
  });
  await new Promise(setImmediate);
  assert.equal(quitPrevented, true);
  assert.equal(processes[1].stdin.ended, true);
  assert.equal(appQuitCalls, 0, 'app quit before the backend exited');

  processes[1].finish();
  await new Promise(setImmediate);
  assert.equal(appQuitCalls, 1);
});
