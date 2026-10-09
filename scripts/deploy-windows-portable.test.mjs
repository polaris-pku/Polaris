import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  deployPortable,
  deployDirectory,
  fileHash,
  parseArtifactName,
  SHORTCUT_NAME,
  supersededNames,
} from './deploy-windows-portable.mjs';
import portableFiles from '../electron/portableFiles.cjs';

const { MANIFEST_NAME, cleanupRetiredFiles, readManifest } = portableFiles;

const OLD = 'Polaris-0.1.0-win-x64-portable.exe';
const CURRENT = 'Polaris-0.1.0-win-x64-portable-files.exe';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'polaris-deploy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'Desktop');
  const build = path.join(root, 'build');
  await mkdir(desktop);
  await mkdir(build);
  const source = path.join(build, CURRENT);
  await executable(source, 'new');
  const old = path.join(desktop, OLD);
  await executable(old, 'old');
  const shortcut = path.join(desktop, SHORTCUT_NAME);
  await writeFile(shortcut, JSON.stringify({ target: old }));
  return {
    root,
    desktop,
    source,
    old,
    shortcut,
    writeShortcut: (file, target) => writeFile(file, JSON.stringify({ target })),
    readShortcuts: async () => {
      const links = (await readdir(desktop)).filter((name) => name.endsWith('.lnk'));
      return Promise.all(
        links.map(async (name) => {
          const file = path.join(desktop, name);
          return { file, target: JSON.parse(await readFile(file, 'utf8')).target };
        }),
      );
    },
  };
}

async function executable(file, marker) {
  const bytes = Buffer.alloc(256);
  bytes.write('MZ');
  bytes.writeUInt32LE(128, 60);
  bytes.set([80, 69, 0, 0], 128);
  bytes.write(marker, 160);
  await writeFile(file, bytes);
}

test('only recognizes Polaris Windows artifacts and keeps newer or other-platform builds', () => {
  assert.deepEqual(parseArtifactName(CURRENT), {
    version: '0.1.0',
    arch: 'x64',
    portable: true,
  });
  assert.deepEqual(
    supersededNames(
      [
        OLD,
        CURRENT,
        'Polaris-0.1.0-win-x64.exe',
        'Polaris-0.0.9-win-x64-portable.exe',
        'Polaris-0.2.0-win-x64-portable.exe',
        'Polaris-0.1.0-win-arm64-portable.exe',
        'Polaris-0.01.0-win-x64-portable.exe',
        'Polaris-0.1.0-beta..1-win-x64-portable.exe',
        'Polaris-0.1.0-beta.01-win-x64-portable.exe',
        'Polaris-notes.txt',
        'OtherApp.exe',
        `../${OLD}`,
      ],
      CURRENT,
    ),
    [OLD, 'Polaris-0.1.0-win-x64.exe', 'Polaris-0.0.9-win-x64-portable.exe'],
  );
  assert.throws(() => supersededNames([], 'Polaris-0.1.0-win-x64.exe'), /portable/);
});

test('version ordering handles prereleases rather than relying on filenames or timestamps', () => {
  assert.deepEqual(
    supersededNames(
      [
        'Polaris-1.0.0-beta.2-win-x64-portable.exe',
        'Polaris-1.0.0-beta.11-win-x64-portable.exe',
        'Polaris-1.0.0-win-x64-portable.exe',
        'Polaris-2.0.0-win-x64-portable.exe',
      ],
      'Polaris-1.0.0-beta.10-win-x64-portable.exe',
    ),
    ['Polaris-1.0.0-beta.2-win-x64-portable.exe'],
  );
});

test('publishes the verified new file, updates the entry, and removes only superseded artifacts', async (t) => {
  const f = await fixture(t);
  const obsoleteLink = path.join(f.desktop, 'Polaris-old.lnk');
  await writeFile(obsoleteLink, JSON.stringify({ target: f.old }));
  await writeFile(path.join(f.desktop, 'notes.txt'), 'keep');
  const newer = path.join(f.desktop, 'Polaris-0.2.0-win-x64-portable.exe');
  await executable(newer, 'future');
  const directory = path.join(f.desktop, 'Polaris-0.0.8-win-x64-portable.exe');
  await mkdir(directory);
  await writeFile(path.join(directory, 'personal.txt'), 'keep');
  const data = path.join(f.root, 'settings.json');
  await writeFile(data, '{"provider":"anthropic"}');
  const unrelatedLink = path.join(f.desktop, 'Polaris-project.lnk');
  await writeFile(unrelatedLink, JSON.stringify({ target: data }));
  const customLink = path.join(f.desktop, 'My-project.lnk');
  await writeFile(customLink, JSON.stringify({ target: f.old }));
  const outsideLink = path.join(f.root, 'Polaris-outside.lnk');
  await writeFile(outsideLink, JSON.stringify({ target: f.old }));

  const result = await deployPortable({
    ...f,
    readShortcuts: async () => [...(await f.readShortcuts()), { file: outsideLink, target: f.old }],
  });
  assert.equal(await fileHash(result.executable), await fileHash(f.source));
  assert.deepEqual(JSON.parse(await readFile(f.shortcut, 'utf8')), { target: result.executable });
  assert.deepEqual(result.removed.sort(), [f.old, obsoleteLink].sort());
  assert.equal(await readFile(path.join(f.desktop, 'notes.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(path.join(directory, 'personal.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(data, 'utf8'), '{"provider":"anthropic"}');
  for (const link of [unrelatedLink, customLink, outsideLink]) {
    assert.ok((await lstat(link)).isFile());
  }
  assert.ok((await readdir(f.desktop)).includes(path.basename(newer)));
  assert.ok(!(await readdir(f.desktop)).some((name) => name.startsWith('.polaris-')));
});

test('refuses to change anything while Polaris is running', async (t) => {
  const f = await fixture(t);
  const before = (await readdir(f.desktop)).sort();
  const oldHash = await fileHash(f.old);
  await assert.rejects(
    deployPortable({
      ...f,
      runningProcesses: [{ ProcessId: 123, Name: 'Polaris.exe' }],
    }),
    /exit Polaris/,
  );
  assert.deepEqual((await readdir(f.desktop)).sort(), before);
  assert.equal(await fileHash(f.old), oldHash);
});

test('a corrupt incoming artifact cannot remove the working version', async (t) => {
  const f = await fixture(t);
  await writeFile(f.source, 'not an executable');
  await assert.rejects(deployPortable(f), /Windows executable/);
  assert.ok((await readdir(f.desktop)).includes(OLD));
});

test('a missing source cannot remove the working version', async (t) => {
  const f = await fixture(t);
  await unlink(f.source);
  await assert.rejects(deployPortable(f), /Artifact does not exist/);
  assert.deepEqual((await readdir(f.desktop)).sort(), [OLD, SHORTCUT_NAME].sort());
});

test('shortcut failure leaves existing files and shortcut untouched', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.shortcut, 'utf8');
  await assert.rejects(
    deployPortable({
      ...f,
      writeShortcut: async () => {
        throw new Error('shortcut denied');
      },
    }),
    /shortcut denied/,
  );
  assert.equal(await readFile(f.shortcut, 'utf8'), before);
  assert.deepEqual((await readdir(f.desktop)).sort(), [OLD, SHORTCUT_NAME].sort());
});

test('a failed replacement restores the existing same-name executable', async (t) => {
  const f = await fixture(t);
  const current = path.join(f.desktop, CURRENT);
  await executable(current, 'previous build');
  const hash = await fileHash(current);
  await assert.rejects(
    deployPortable({
      ...f,
      writeShortcut: async (file, target) => {
        await f.writeShortcut(file, target);
        const staged = (await readdir(f.desktop)).find((name) => name.endsWith('.tmp'));
        await unlink(path.join(f.desktop, staged));
      },
    }),
    /ENOENT/,
  );
  assert.equal(await fileHash(current), hash);
  assert.ok((await readdir(f.desktop)).includes(OLD));
  assert.ok(!(await readdir(f.desktop)).some((name) => name.startsWith('.polaris-')));
});

test('a checksum failure after replacement restores both the previous executable and shortcut', async (t) => {
  const f = await fixture(t);
  const current = path.join(f.desktop, CURRENT);
  await executable(current, 'previous build');
  const hash = await fileHash(current);
  const link = await readFile(f.shortcut, 'utf8');
  await assert.rejects(
    deployPortable({
      ...f,
      writeShortcut: async (file, target) => {
        await f.writeShortcut(file, target);
        const staged = (await readdir(f.desktop)).find((name) => name.endsWith('.tmp'));
        await executable(path.join(f.desktop, staged), 'damaged copy');
      },
    }),
    /checksum mismatch/,
  );
  assert.equal(await fileHash(current), hash);
  assert.equal(await readFile(f.shortcut, 'utf8'), link);
  assert.deepEqual((await readdir(f.desktop)).sort(), [OLD, CURRENT, SHORTCUT_NAME].sort());
});

test('same-name updates replace the bytes without retaining backup executables', async (t) => {
  const f = await fixture(t);
  await executable(path.join(f.desktop, CURRENT), 'previous build');
  const result = await deployPortable(f);
  assert.equal(await fileHash(result.executable), await fileHash(f.source));
  assert.deepEqual((await readdir(f.desktop)).sort(), [CURRENT, SHORTCUT_NAME].sort());
});

test(
  'symbolic links cannot be used as incoming artifacts or retirement targets',
  { skip: process.platform === 'win32' && 'Windows symlinks require developer mode or elevation' },
  async (t) => {
    const f = await fixture(t);
    await unlink(f.old);
    await symlink(f.source, f.old);
    await deployPortable(f);
    assert.ok((await lstat(f.old)).isSymbolicLink());
    const linkedSource = path.join(path.dirname(f.source), OLD);
    await symlink(f.source, linkedSource);
    await assert.rejects(deployPortable({ ...f, source: linkedSource }), /Not a regular file/);
    assert.ok((await lstat(f.source)).isFile());
  },
);

test('cleanup errors are reported and leave the verified new build available', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    deployPortable({
      ...f,
      readShortcuts: async () => {
        throw new Error('shortcut inspection denied');
      },
    }),
    /shortcut inspection denied/,
  );
  assert.equal(await fileHash(path.join(f.desktop, CURRENT)), await fileHash(f.source));
  assert.ok((await readdir(f.desktop)).includes(OLD));
});

test('repeating a deployment is safe and does not accumulate old copies', async (t) => {
  const f = await fixture(t);
  await deployPortable(f);
  const result = await deployPortable(f);
  assert.deepEqual(result.removed, []);
  assert.deepEqual((await readdir(f.desktop)).sort(), [CURRENT, SHORTCUT_NAME].sort());
});

async function directoryFixture(t) {
  const f = await fixture(t);
  const source = path.join(f.root, 'win-unpacked');
  await mkdir(path.join(source, 'resources/backend/runtime'), { recursive: true });
  await executable(path.join(source, 'Polaris.exe'), 'application');
  await executable(path.join(source, 'resources/backend/runtime/node.exe'), 'runtime');
  await writeFile(path.join(source, 'resources/app.asar'), 'frontend and shell');
  await writeFile(path.join(source, 'resources/backend/backend-host.cjs'), 'backend');
  return { ...f, source, version: '0.1.0', arch: 'x64' };
}

test('directory delivery points directly to the application without a self-extractor', async (t) => {
  const f = await directoryFixture(t);
  const result = await deployDirectory(f);
  assert.equal(result.executable, path.join(f.desktop, 'Polaris-portable-x64/Polaris.exe'));
  assert.deepEqual(JSON.parse(await readFile(f.shortcut, 'utf8')), { target: result.executable });
  assert.deepEqual(result.removed, [f.old]);
  assert.deepEqual(result.pendingCleanup, []);
  assert.deepEqual(
    (await readdir(f.desktop)).sort(),
    ['Polaris-portable-x64', SHORTCUT_NAME].sort(),
  );
  assert.equal((await readManifest(path.dirname(result.executable))).version, '0.1.0');
});

test('a running legacy build is preserved until the new application starts', async (t) => {
  const f = await directoryFixture(t);
  const result = await deployDirectory({
    ...f,
    runningProcesses: [{ path: f.old }],
  });
  assert.equal(result.restartRequired, true);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.pendingCleanup, [OLD]);
  assert.ok((await lstat(f.old)).isFile());
  const cleanup = await cleanupRetiredFiles({
    directory: path.dirname(result.executable),
    desktop: f.desktop,
  });
  assert.deepEqual(cleanup.removed, [f.old]);
  assert.deepEqual(cleanup.pending, []);
  assert.deepEqual((await readManifest(path.dirname(result.executable))).pendingCleanup, []);
});

test('startup retries a legacy wrapper that is still releasing its executable', async (t) => {
  const f = await directoryFixture(t);
  const current = await deployDirectory({ ...f, runningProcesses: [{ path: f.old }] });
  const originalUnlink = fs.unlink;
  let locked = true;
  t.mock.method(fs, 'unlink', async (file) => {
    if (file === f.old && locked) {
      locked = false;
      throw Object.assign(new Error('Executable is still in use'), { code: 'EACCES' });
    }
    return originalUnlink(file);
  });
  const warnings = [];
  const cleanup = await cleanupRetiredFiles({
    directory: path.dirname(current.executable),
    desktop: f.desktop,
    retries: 1,
    warn: (message) => warnings.push(message),
  });
  assert.deepEqual(cleanup.removed, [f.old]);
  assert.deepEqual(cleanup.pending, []);
  assert.equal(warnings.length, 1);
});

test('a running directory build blocks its own replacement without changing the shortcut', async (t) => {
  const f = await directoryFixture(t);
  const current = await deployDirectory(f);
  const link = await fileHash(f.shortcut);
  await assert.rejects(
    deployDirectory({
      ...f,
      runningProcesses: [{ path: current.executable }],
    }),
    /exit Polaris/,
  );
  assert.equal(await fileHash(f.shortcut), link);
});

test('directory updates replace the verified bundle without accumulating old directories', async (t) => {
  const f = await directoryFixture(t);
  await deployDirectory(f);
  await writeFile(path.join(f.source, 'resources/app.asar'), 'updated frontend');
  const result = await deployDirectory(f);
  assert.equal(
    await readFile(path.join(path.dirname(result.executable), 'resources/app.asar'), 'utf8'),
    'updated frontend',
  );
  assert.deepEqual(
    (await readdir(f.desktop)).sort(),
    ['Polaris-portable-x64', SHORTCUT_NAME].sort(),
  );
});

test('directory deployment refuses untracked files and newer installed versions', async (t) => {
  const f = await directoryFixture(t);
  const current = await deployDirectory({ ...f, version: '0.2.0' });
  await assert.rejects(deployDirectory(f), /newer portable/);
  const personal = path.join(path.dirname(current.executable), 'my-project.txt');
  await writeFile(personal, 'preserve');
  await assert.rejects(deployDirectory({ ...f, version: '0.2.0' }), /untracked files/);
  assert.equal(await readFile(personal, 'utf8'), 'preserve');
});

test('directory deployment cannot replace an unmanaged desktop folder', async (t) => {
  const f = await directoryFixture(t);
  const directory = path.join(f.desktop, 'Polaris-portable-x64');
  await mkdir(directory);
  await writeFile(path.join(directory, 'notes.txt'), 'preserve');
  await assert.rejects(deployDirectory(f), /unmanaged directory/);
  assert.equal(await readFile(path.join(directory, 'notes.txt'), 'utf8'), 'preserve');
});

test('directory checksum failure rolls back both program files and desktop shortcut', async (t) => {
  const f = await directoryFixture(t);
  const current = await deployDirectory(f);
  const hash = await fileHash(path.join(path.dirname(current.executable), 'resources/app.asar'));
  const link = await fileHash(f.shortcut);
  await writeFile(path.join(f.source, 'resources/app.asar'), 'updated frontend');
  await assert.rejects(
    deployDirectory({
      ...f,
      writeShortcut: async (file, target) => {
        await f.writeShortcut(file, target);
        const staged = (await readdir(f.desktop)).find((name) => name.endsWith('.directory'));
        await writeFile(path.join(f.desktop, staged, 'resources/app.asar'), 'damaged copy');
      },
    }),
    /checksum mismatch/,
  );
  assert.equal(
    await fileHash(path.join(path.dirname(current.executable), 'resources/app.asar')),
    hash,
  );
  assert.equal(await fileHash(f.shortcut), link);
  assert.deepEqual(
    (await readdir(f.desktop)).sort(),
    ['Polaris-portable-x64', SHORTCUT_NAME].sort(),
  );
});

test('deferred cleanup preserves modified files and never follows retirement paths outside the desktop', async (t) => {
  const f = await directoryFixture(t);
  const current = await deployDirectory({ ...f, runningProcesses: [{ path: f.old }] });
  const directory = path.dirname(current.executable);
  await writeFile(f.old, 'modified by user');
  const warnings = [];
  const cleanup = await cleanupRetiredFiles({
    directory,
    desktop: f.desktop,
    warn: (message) => warnings.push(message),
  });
  assert.equal(warnings.length, 1);
  assert.equal(cleanup.pending.length, 1);
  assert.equal(await readFile(f.old, 'utf8'), 'modified by user');
  const outside = path.join(f.root, 'Polaris-personal.exe');
  await writeFile(outside, 'preserve');
  const manifest = await readManifest(directory);
  manifest.pendingCleanup = [{ name: '../Polaris-personal.exe', sha256: await fileHash(outside) }];
  await writeFile(path.join(directory, MANIFEST_NAME), JSON.stringify(manifest));
  await assert.rejects(
    cleanupRetiredFiles({ directory, desktop: f.desktop }),
    /Invalid portable retirement/,
  );
  assert.equal(await readFile(outside, 'utf8'), 'preserve');
});

test(
  'source bin links are materialized as files, but external links are rejected',
  {
    skip: process.platform === 'win32' && 'Windows symlinks require developer mode or elevation',
  },
  async (t) => {
    const f = await directoryFixture(t);
    await symlink('resources/backend/backend-host.cjs', path.join(f.source, 'backend-link.cjs'));
    const current = await deployDirectory(f);
    assert.ok(
      (await lstat(path.join(path.dirname(current.executable), 'backend-link.cjs'))).isFile(),
    );
    await symlink(f.shortcut, path.join(f.source, 'outside-link'));
    await assert.rejects(deployDirectory(f), /escapes its source directory/);
  },
);
