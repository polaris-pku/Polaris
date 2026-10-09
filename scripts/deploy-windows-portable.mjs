import { randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import portableFiles from '../electron/portableFiles.cjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { MANIFEST_NAME, directoryFiles, readManifest, verifyDirectory, cleanupRetiredFiles } =
  portableFiles;
export const { SHORTCUT_NAME, fileHash } = portableFiles;
const ARTIFACT =
  /^Polaris-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?)-win-(x64|arm64|ia32)(-portable(?:-[\da-z._-]+)?)?\.exe$/i;
const pathKey = (value) => value.replace(/\\/g, '/').toLowerCase();

export function parseArtifactName(name) {
  const match = ARTIFACT.exec(name);
  if (!match) return null;
  const [version] = match[1].split('+');
  const dash = version.indexOf('-');
  if (
    dash >= 0 &&
    version
      .slice(dash + 1)
      .split('.')
      .some((id) => /^0\d+$/.test(id))
  )
    return null;
  return { version: match[1], arch: match[2].toLowerCase(), portable: !!match[3] };
}

function compareVersions(left, right) {
  const parse = (value) => {
    const [version] = value.split('+');
    const dash = version.indexOf('-');
    return {
      numbers: (dash < 0 ? version : version.slice(0, dash)).split('.').map(BigInt),
      prerelease: dash < 0 ? [] : version.slice(dash + 1).split('.'),
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] < b.numbers[i] ? -1 : 1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x);
    const numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function supersededNames(names, currentName, { includeCurrent = false } = {}) {
  const current = parseArtifactName(currentName);
  if (!current?.portable) throw new Error('The new artifact must be a named Polaris portable EXE');
  return names.filter((name) => {
    if (name !== path.basename(name) || (!includeCurrent && pathKey(name) === pathKey(currentName)))
      return false;
    const candidate = parseArtifactName(name);
    return (
      candidate?.arch === current.arch && compareVersions(candidate.version, current.version) <= 0
    );
  });
}

async function existingFile(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular file: ${file}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function validateExecutable(file) {
  if (!(await existingFile(file))) throw new Error(`Artifact does not exist: ${file}`);
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(64);
    if (
      (await handle.read(header, 0, 64, 0)).bytesRead !== 64 ||
      header.toString('ascii', 0, 2) !== 'MZ'
    )
      throw new Error('Artifact is not a Windows executable');
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, header.readUInt32LE(60));
    if (!signature.equals(Buffer.from([80, 69, 0, 0])))
      throw new Error('Artifact has no valid PE signature');
  } finally {
    await handle.close();
  }
}

/** All deletions are explicit files on the desktop; application data is never a target. */
export async function deployPortable({
  source,
  desktop,
  runningProcesses = [],
  writeShortcut,
  readShortcuts,
}) {
  const currentName = path.basename(source);
  supersededNames([], currentName);
  await validateExecutable(source);
  if (runningProcesses.length) {
    throw new Error('Please exit Polaris before deploying. No desktop files were changed.');
  }
  const entries = await readdir(desktop, { withFileTypes: true });
  const retired = supersededNames(
    entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink()).map((entry) => entry.name),
    currentName,
  ).map((name) => path.join(desktop, name));
  const destination = path.join(desktop, currentName);
  const shortcut = path.join(desktop, SHORTCUT_NAME);
  const nonce = randomUUID();
  const staged = path.join(desktop, `.polaris-${nonce}.tmp`);
  const stagedLink = path.join(desktop, `.polaris-${nonce}.lnk`);
  const backup = path.join(desktop, `.polaris-${nonce}.previous`);
  const backupLink = path.join(desktop, `.polaris-${nonce}.previous-link`);
  const expectedHash = await fileHash(source);
  const hasDestination = await existingFile(destination);
  const needsCopy = !hasDestination || (await fileHash(destination)) !== expectedHash;
  const hasShortcut = await existingFile(shortcut);
  let backedUp = false;
  let linkedBackup = false;
  let installed = false;
  let linked = false;
  try {
    if (needsCopy) {
      await copyFile(source, staged);
      if ((await fileHash(staged)) !== expectedHash)
        throw new Error('Copied artifact checksum mismatch');
    }
    await writeShortcut(stagedLink, destination);
    if (!(await existingFile(stagedLink))) throw new Error('Shortcut was not created');
    if (needsCopy) {
      if (hasDestination) {
        await rename(destination, backup);
        backedUp = true;
      }
      await rename(staged, destination);
      installed = true;
    }
    if (hasShortcut) {
      await rename(shortcut, backupLink);
      linkedBackup = true;
    }
    await rename(stagedLink, shortcut);
    linked = true;
    if ((await fileHash(destination)) !== expectedHash)
      throw new Error('Deployed artifact checksum mismatch');
  } catch (error) {
    if (linked) await unlink(shortcut);
    if (linkedBackup) await rename(backupLink, shortcut);
    if (installed) await unlink(destination);
    if (backedUp) await rename(backup, destination);
    throw error;
  } finally {
    for (const file of [staged, stagedLink]) {
      if (await existingFile(file)) await unlink(file);
    }
  }
  if (backedUp) await unlink(backup);
  if (linkedBackup) await unlink(backupLink);

  const removed = [];
  const retiredKeys = new Set(retired.map(pathKey));
  for (const link of await readShortcuts()) {
    if (
      pathKey(link.file) === pathKey(shortcut) ||
      pathKey(path.dirname(link.file)) !== pathKey(desktop) ||
      !/^Polaris.*\.lnk$/i.test(path.basename(link.file)) ||
      !retiredKeys.has(pathKey(link.target))
    )
      continue;
    if (await existingFile(link.file)) {
      await unlink(link.file);
      removed.push(link.file);
    }
  }
  for (const file of retired) {
    if (await existingFile(file)) {
      await unlink(file);
      removed.push(file);
    }
  }
  return { executable: destination, shortcut, sha256: expectedHash, removed };
}

export async function deployDirectory({
  source,
  desktop,
  version,
  arch,
  runningProcesses = [],
  writeShortcut,
  readShortcuts,
}) {
  const packageName = `Polaris-${version}-win-${arch}-portable.exe`;
  if (!parseArtifactName(packageName)?.portable)
    throw new Error('Invalid portable package metadata');
  await validateExecutable(path.join(source, 'Polaris.exe'));
  const files = await directoryFiles(source, { allowInternalLinks: true });
  for (const name of [
    'resources/app.asar',
    'resources/backend/backend-host.cjs',
    'resources/backend/runtime/node.exe',
  ]) {
    if (!files[name]) throw new Error(`Incomplete portable directory: ${name}`);
  }
  const directoryName = `Polaris-portable-${arch}`;
  const destination = path.join(desktop, directoryName);
  const executable = path.join(destination, 'Polaris.exe');
  const shortcut = path.join(desktop, SHORTCUT_NAME);
  if (
    runningProcesses.some(
      (process) => !process.path || pathKey(process.path).startsWith(`${pathKey(destination)}/`),
    )
  ) {
    throw new Error('Please exit Polaris before replacing its program directory.');
  }
  let previous = null;
  let destinationInfo;
  try {
    destinationInfo = await lstat(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (destinationInfo) {
    if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink())
      throw new Error('Unsafe portable destination');
    previous = await readManifest(destination);
    if (!previous || previous.directory !== directoryName) {
      throw new Error('Refusing to replace an unmanaged directory');
    }
    if (
      !parseArtifactName(`Polaris-${previous.version}-win-${arch}-portable.exe`) ||
      compareVersions(previous.version, version) > 0
    ) {
      throw new Error('Refusing to replace an invalid or newer portable version');
    }
    await verifyDirectory(destination, previous.files);
  }
  const names = (await readdir(desktop, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => entry.name);
  const retired = supersededNames(names, packageName, { includeCurrent: true }).map((name) =>
    path.join(desktop, name),
  );
  const retiredKeys = new Set(retired.map(pathKey));
  for (const link of await readShortcuts()) {
    if (
      pathKey(path.dirname(link.file)) === pathKey(desktop) &&
      pathKey(link.file) !== pathKey(shortcut) &&
      /^Polaris.*\.lnk$/i.test(path.basename(link.file)) &&
      retiredKeys.has(pathKey(link.target))
    ) {
      retired.push(link.file);
    }
  }
  const pendingCleanup = await Promise.all(
    [...new Set(retired)].map(async (file) => ({
      name: path.basename(file),
      sha256: await fileHash(file),
    })),
  );
  const nonce = randomUUID();
  const staged = path.join(desktop, `.polaris-${nonce}.directory`);
  const stagedLink = path.join(desktop, `.polaris-${nonce}.lnk`);
  const backup = path.join(desktop, `.polaris-${nonce}.previous-directory`);
  const backupLink = path.join(desktop, `.polaris-${nonce}.previous-link`);
  const hasShortcut = await existingFile(shortcut);
  let backedUp = false;
  let linkedBackup = false;
  let installed = false;
  let linked = false;
  await mkdir(staged);
  try {
    for (const name of await readdir(source)) {
      await cp(path.join(source, name), path.join(staged, name), {
        recursive: true,
        dereference: true,
        errorOnExist: true,
        force: false,
      });
    }
    await verifyDirectory(staged, files);
    await writeFile(
      path.join(staged, MANIFEST_NAME),
      JSON.stringify(
        {
          product: 'polaris',
          format: 1,
          directory: directoryName,
          version,
          files,
          pendingCleanup,
        },
        null,
        2,
      ),
    );
    await writeShortcut(stagedLink, executable);
    if (!(await existingFile(stagedLink))) throw new Error('Shortcut was not created');
    if (previous) {
      await rename(destination, backup);
      backedUp = true;
    }
    await rename(staged, destination);
    installed = true;
    if (hasShortcut) {
      await rename(shortcut, backupLink);
      linkedBackup = true;
    }
    await rename(stagedLink, shortcut);
    linked = true;
    await verifyDirectory(destination, files);
  } catch (error) {
    if (linked) await unlink(shortcut);
    if (linkedBackup) await rename(backupLink, shortcut);
    if (installed) await rm(destination, { recursive: true });
    if (backedUp) await rename(backup, destination);
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
    if (await existingFile(stagedLink)) await unlink(stagedLink);
  }
  if (backedUp) {
    await verifyDirectory(backup, previous.files);
    await rm(backup, { recursive: true });
  }
  if (linkedBackup) await unlink(backupLink);
  const cleanup = runningProcesses.length
    ? { removed: [], pending: pendingCleanup }
    : await cleanupRetiredFiles({ directory: destination, desktop });
  return {
    executable,
    shortcut,
    sha256: files['resources/app.asar'],
    removed: cleanup.removed,
    pendingCleanup: cleanup.pending.map((entry) => entry.name),
    restartRequired: runningProcesses.length > 0,
  };
}

async function directoryMetadata(source) {
  const { extractFile } = await import('@electron/asar');
  const pkg = JSON.parse(
    extractFile(path.join(source, 'resources/app.asar'), 'package.json').toString('utf8'),
  );
  if (pkg.name !== 'polaris') throw new Error('Not a Polaris application directory');
  const handle = await open(path.join(source, 'Polaris.exe'), 'r');
  try {
    const offset = Buffer.alloc(4);
    await handle.read(offset, 0, 4, 60);
    const machine = Buffer.alloc(2);
    await handle.read(machine, 0, 2, offset.readUInt32LE(0) + 4);
    const arch = { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' }[machine.readUInt16LE(0)];
    if (!arch) throw new Error('Unsupported Windows executable architecture');
    return { version: pkg.version, arch };
  } finally {
    await handle.close();
  }
}

const WINDOWS_BRIDGE = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shell = New-Object -ComObject WScript.Shell
if ($request.action -eq 'shortcut') {
  $shortcut = $shell.CreateShortcut($request.file)
  $shortcut.TargetPath = $request.target
  $shortcut.WorkingDirectory = $desktop
  $shortcut.Description = 'Polaris portable - current verified build'
  $shortcut.IconLocation = $request.target + ',0'
  $shortcut.Save()
  if ($shell.CreateShortcut($request.file).TargetPath -ne $request.target) {
    throw 'Shortcut target verification failed'
  }
  @{ok=$true} | ConvertTo-Json -Compress
} elseif ($request.action -eq 'inspect') {
  $links = @(Get-ChildItem -LiteralPath $desktop -Filter 'Polaris*.lnk' -File | ForEach-Object {
    @{file=$_.FullName;target=$shell.CreateShortcut($_.FullName).TargetPath}
  })
  $processes = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'Polaris.exe' -or $_.Name -like 'Polaris-*-portable*.exe'
  } | Select-Object ProcessId,Name,ExecutablePath)
  @{desktop=$desktop;shortcuts=$links;processes=$processes} | ConvertTo-Json -Depth 4 -Compress
} else { throw 'Unknown deployment operation' }
`;

function run(command, args, input) {
  const result = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `${command} exited ${result.status}`);
  return result.stdout.trim();
}

async function main() {
  if (process.platform !== 'win32' && !process.env.WSL_DISTRO_NAME) {
    throw new Error('Windows desktop deployment requires Windows or WSL');
  }
  const windows = process.platform === 'win32';
  const powershell = windows
    ? path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
    : '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  const bridge = (request) =>
    JSON.parse(
      run(
        powershell,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_BRIDGE],
        JSON.stringify(request),
      ),
    );
  const hostPath = (value) => (windows ? value : run('wslpath', ['-u', value]));
  const windowsPath = (value) => (windows ? value : run('wslpath', ['-w', value]));
  const source = path.resolve(
    process.argv[2] || path.join(ROOT, 'release', 'portable', 'win-unpacked'),
  );
  const current = bridge({ action: 'inspect' });
  const sourceInfo = await lstat(source);
  if (sourceInfo.isSymbolicLink())
    throw new Error('The portable source must not be a symbolic link');
  const directory = sourceInfo.isDirectory();
  const deploy = directory ? deployDirectory : deployPortable;
  const result = await deploy({
    source,
    ...(directory ? await directoryMetadata(source) : {}),
    desktop: hostPath(current.desktop),
    runningProcesses: current.processes.map((process) => ({
      ...process,
      path: process.ExecutablePath ? hostPath(process.ExecutablePath) : null,
    })),
    writeShortcut: async (file, target) => {
      bridge({ action: 'shortcut', file: windowsPath(file), target: windowsPath(target) });
    },
    readShortcuts: async () =>
      bridge({ action: 'inspect' })
        .shortcuts.filter(
          (link) =>
            link.target && pathKey(path.win32.dirname(link.target)) === pathKey(current.desktop),
        )
        .map((link) => ({ file: hostPath(link.file), target: hostPath(link.target) })),
  });
  console.log(
    JSON.stringify(
      {
        ...result,
        executable: windowsPath(result.executable),
        shortcut: windowsPath(result.shortcut),
        removed: result.removed.map(windowsPath),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Portable deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
