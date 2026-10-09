const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const { lstat, readFile, readdir, realpath, rename, unlink, writeFile } = fs;
const path = require('node:path');

const MANIFEST_NAME = '.polaris-portable.json';
const SHORTCUT_NAME = 'Polaris-免安装版.lnk';
const pathKey = (value) => path.resolve(value).replace(/\\/g, '/').toLowerCase();

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function directoryFiles(root, { allowInternalLinks = false } = {}) {
  const resolvedRoot = await realpath(root);
  const files = Object.create(null);
  async function visit(relative) {
    const directory = path.join(root, relative);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`Not a regular directory: ${directory}`);
    }
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    );
    for (const entry of entries) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name === MANIFEST_NAME && entry.isFile() && !entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(name);
      else if (entry.isFile() && !entry.isSymbolicLink()) {
        files[name] = await fileHash(path.join(root, name));
      } else if (allowInternalLinks && entry.isSymbolicLink()) {
        const target = await realpath(path.join(root, name));
        if (!target.startsWith(`${resolvedRoot}${path.sep}`) || !(await lstat(target)).isFile()) {
          throw new Error(`Portable link escapes its source directory: ${name}`);
        }
        files[name] = await fileHash(target);
      } else {
        throw new Error(`Unsupported portable file: ${path.join(root, name)}`);
      }
    }
  }
  await visit('');
  return files;
}

async function readManifest(directory) {
  const file = path.join(directory, MANIFEST_NAME);
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Invalid portable manifest: ${file}`);
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (
    manifest.product !== 'polaris' ||
    manifest.format !== 1 ||
    !/^Polaris-portable-(x64|arm64|ia32)$/.test(manifest.directory) ||
    typeof manifest.version !== 'string' ||
    !Array.isArray(manifest.pendingCleanup) ||
    !manifest.files ||
    typeof manifest.files !== 'object' ||
    Array.isArray(manifest.files)
  ) {
    throw new Error(`Invalid portable manifest: ${file}`);
  }
  return manifest;
}

async function verifyDirectory(directory, expected) {
  const actual = await directoryFiles(directory);
  const keys = Object.keys(actual);
  if (
    keys.length !== Object.keys(expected).length ||
    keys.some((name) => actual[name] !== expected[name])
  ) {
    throw new Error(`Portable directory checksum mismatch or untracked files: ${directory}`);
  }
}

// A running legacy self-extractor is retired only after the new application owns the instance lock.
async function cleanupRetiredFiles({ directory, desktop, warn = console.warn, retries = 0 }) {
  const manifest = await readManifest(directory);
  if (!manifest) return { removed: [], pending: [] };
  if (
    pathKey(directory) !== pathKey(path.join(desktop, manifest.directory)) ||
    (await lstat(directory)).isSymbolicLink()
  ) {
    throw new Error('Portable cleanup is restricted to its managed desktop directory');
  }
  const removed = [];
  const pending = [];
  let retryable = false;
  for (const item of manifest.pendingCleanup) {
    if (
      typeof item.name !== 'string' ||
      item.name !== path.basename(item.name) ||
      item.name !== path.win32.basename(item.name) ||
      item.name.toLowerCase() === SHORTCUT_NAME.toLowerCase() ||
      !/^Polaris(?:-.*\.exe|.*\.lnk)$/i.test(item.name) ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    ) {
      throw new Error('Invalid portable retirement entry');
    }
    const file = path.join(desktop, item.name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || (await fileHash(file)) !== item.sha256) {
        throw new Error(`Retired file has changed; preserving it: ${file}`);
      }
      await fs.unlink(file);
      removed.push(file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      pending.push(item);
      retryable ||= ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
      warn(`[portable] Cleanup deferred: ${error.message}`);
    }
  }
  if (pending.length !== manifest.pendingCleanup.length) {
    const temporary = path.join(directory, `.polaris-${randomUUID()}.json`);
    try {
      await writeFile(temporary, JSON.stringify({ ...manifest, pendingCleanup: pending }, null, 2));
      await rename(temporary, path.join(directory, MANIFEST_NAME));
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  if (retryable && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const next = await cleanupRetiredFiles({ directory, desktop, warn, retries: retries - 1 });
    return { removed: [...removed, ...next.removed], pending: next.pending };
  }
  return { removed, pending };
}

module.exports = {
  MANIFEST_NAME,
  SHORTCUT_NAME,
  fileHash,
  directoryFiles,
  readManifest,
  verifyDirectory,
  cleanupRetiredFiles,
};
