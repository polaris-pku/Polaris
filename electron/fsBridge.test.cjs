const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('restored default projects retain the default boundary; custom roots still need the picker', async (t) => {
  const documents = await fs.mkdtemp(path.join(os.tmpdir(), 'polaris-fs-authorization-'));
  t.after(() => fs.rm(documents, { recursive: true, force: true }));
  const handlers = new Map();
  let picked = null;
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron')
      return {
        app: { getPath: () => documents },
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }) },
        shell: { showItemInFolder: assert.fail },
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = require.resolve('./fsBridge.cjs');
  delete require.cache[modulePath];
  let bridge;
  try {
    bridge = require(modulePath);
    bridge.setupFsBridge(() => null);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
  const managed = path.join(documents, 'polaris-workspace', 'cook');
  assert.deepEqual(bridge.resolveProjectRoot({ projectName: 'cook' }), { root: managed });
  assert.deepEqual(bridge.resolveProjectRoot({ rootPath: managed }), { root: managed });
  for (const root of [
    documents,
    path.join(documents, 'polaris-workspace'),
    path.join(documents, 'polaris-workspace-other', 'cook'),
    path.join(managed, 'nested'),
    path.join(managed, '..', '..', 'outside'),
  ])
    assert.ok(bridge.resolveProjectRoot({ rootPath: root }).error);
  const write = handlers.get('fs:writeTextFile');
  assert.equal(
    (await write(null, { rootPath: managed, path: 'game.py', content: 'print(1)' })).ok,
    true,
  );
  assert.equal(
    (await handlers.get('fs:readTextFile')(null, { rootPath: managed, path: 'game.py' })).content,
    'print(1)',
  );
  assert.equal(
    (await write(null, { rootPath: managed, path: '../outside.py', content: 'bad' })).ok,
    false,
  );
  assert.equal((await handlers.get('fs:readDirectoryTree')(null, managed)).tree[0].name, 'game.py');
  const custom = path.join(documents, 'custom-project');
  assert.ok(bridge.resolveProjectRoot({ rootPath: custom }).error);
  picked = custom;
  await handlers.get('fs:chooseDirectory')(null, {});
  assert.deepEqual(bridge.resolveProjectRoot({ rootPath: custom }), { root: custom });
});
