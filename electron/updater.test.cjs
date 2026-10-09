const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

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
