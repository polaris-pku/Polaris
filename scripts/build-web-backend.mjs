import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'electron/backend-host.ts')],
  outfile: path.join(root, 'backend/backend-host.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  logLevel: 'warning',
  alias: { 'node-pty': path.join(root, 'scripts/stub-node-pty.cjs') },
  external: ['pg-native'],
});

console.log('[web-backend] backend-host.cjs 已更新');
