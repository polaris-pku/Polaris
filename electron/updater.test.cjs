const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

test('registers inert update IPC handlers in development', async () => {
  const handlers = new Map();
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: { isPackaged: false },
        ipcMain: {
          handle(name, handler) {
            handlers.set(name, handler);
          },
        },
        shell: { openExternal: assert.fail },
      };
    }
    if (request === 'electron-updater') return { autoUpdater: {} };
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
  for (const name of handlers.keys()) {
    assert.equal(await handlers.get(name)(), name === 'update:getState' ? null : undefined);
  }
});
