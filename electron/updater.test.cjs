const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

for (const rejectSave of [false, true])
  test(`installer ${rejectSave ? 'refuses update on save failure' : 'waits for backend persistence before quitting'}`, async (t) => {
    const handlers = new Map();
    const updater = new EventEmitter();
    let installs = 0;
    updater.quitAndInstall = () => {
      installs += 1;
    };
    t.mock.method(global, 'setTimeout', () => 0);
    t.mock.method(global, 'setInterval', () => 0);
    let finishSave;
    const saving = new Promise((resolve, reject) => {
      finishSave = () => (rejectSave ? reject(new Error('save not confirmed')) : resolve());
    });
    const originalLoad = Module._load;
    const updaterPath = require.resolve('./updater.cjs');
    delete require.cache[updaterPath];
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'electron')
        return {
          app: { isPackaged: true },
          ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
          shell: { openExternal: assert.fail },
        };
      if (request === 'electron-updater') return { autoUpdater: updater };
      if (request === 'node:fs') return { existsSync: () => false };
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      require(updaterPath).setupAutoUpdater(
        () => null,
        () => saving,
      );
    } finally {
      Module._load = originalLoad;
      delete require.cache[updaterPath];
    }
    const updating = handlers.get('update:restart')();
    assert.equal(installs, 0);
    finishSave();
    await updating;
    assert.equal(installs, rejectSave ? 0 : 1);
    if (rejectSave) {
      const state = handlers.get('update:getState')();
      assert.equal(state.type, 'error');
      assert.match(state.message, /save not confirmed/);
    }
  });

for (const isPackaged of [false, true])
  test(`registers inert installer-update handlers in ${isPackaged ? 'managed portable' : 'development'} mode`, async () => {
    const handlers = new Map();
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'electron') {
        return {
          app: { isPackaged },
          ipcMain: {
            handle(name, handler) {
              handlers.set(name, handler);
            },
          },
          shell: { openExternal: assert.fail },
        };
      }
      if (request === 'electron-updater') {
        return { autoUpdater: {} };
      }
      if (request === 'node:fs') return { existsSync: () => true };
      return originalLoad.call(this, request, parent, isMain);
    };

    const updaterPath = require.resolve('./updater.cjs');
    delete require.cache[updaterPath];
    try {
      const { setupAutoUpdater } = require(updaterPath);
      setupAutoUpdater(() => null);
    } finally {
      Module._load = originalLoad;
      delete require.cache[updaterPath];
    }

    assert.deepEqual([...handlers.keys()].sort(), [
      'update:check',
      'update:download',
      'update:getState',
      'update:openDownload',
      'update:restart',
    ]);
    assert.equal(await handlers.get('update:getState')(), null);
    assert.equal(await handlers.get('update:check')(), undefined);
    assert.equal(await handlers.get('update:download')(), undefined);
    if (!isPackaged) assert.equal(await handlers.get('update:openDownload')(), undefined);
    assert.equal(await handlers.get('update:restart')(), undefined);
  });
