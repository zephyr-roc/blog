import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nonRuntimeDirectories = new Set(['.github', '__tests__', 'test', 'tests', 'docs', 'doc', 'examples', 'example', 'benchmarks', 'benchmark', 'coverage']);
const metadata = name => /\.(?:d\.ts|d\.mts|d\.cts|tsbuildinfo)$/i.test(name) || /^(?:README|CHANGELOG|HISTORY|CONTRIBUTING)(?:\.[^.]+)?$/i.test(name);

async function visit(directory, onFile) {
  if (!existsSync(directory)) return;
  for (const e of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, e.name);
    if (e.isDirectory()) await visit(location, onFile);
    else if (e.isFile()) await onFile(location);
  }
}
async function folderSize(directory) {
  let bytes = 0; let count = 0;
  await visit(directory, async file => { bytes += (await stat(file)).size; count++; });
  return { bytes, count };
}
async function prune(directory, inModules, saved) {
  if (!existsSync(directory)) return;
  for (const e of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, e.name);
    if (e.isDirectory()) {
      if (inModules && nonRuntimeDirectories.has(e.name.toLowerCase())) {
        const size = await folderSize(file);
        await rm(file, { recursive: true, force: true });
        saved.bytes += size.bytes; saved.count += size.count;
      } else await prune(file, inModules, saved);
    } else if (e.isFile() && (e.name.endsWith('.map') || (inModules && metadata(e.name)))) {
      saved.bytes += (await stat(file)).size; saved.count++;
      await rm(file);
    }
  }
}
async function deduplicatePublic(standalone, saved) {
  const publicDir = path.join(standalone, 'public');
  const clientDir = path.join(standalone, 'dist/client');
  await visit(publicDir, async file => {
    const client = path.join(clientDir, path.relative(publicDir, file));
    if (!existsSync(client)) return;
    const [a, b] = await Promise.all([stat(file), stat(client)]);
    if (a.size !== b.size) return;
    const [left, right] = await Promise.all([readFile(file), readFile(client)]);
    const hash = data => createHash('sha256').update(data).digest('hex');
    if (hash(left) !== hash(right)) return;
    saved.bytes += a.size; saved.count++;
    await rm(file);
  });
}
const human = size => (size / 1048576).toFixed(2) + ' MiB';

export async function optimizeStandalone(root = process.cwd(), log = console.log) {
  const dist = path.join(root, 'dist');
  const standalone = path.join(dist, 'standalone');
  for (const required of ['server.js', 'dist/server/index.js', 'dist/client']) {
    if (!existsSync(path.join(standalone, required))) {
      throw new Error('Vinext standalone missing ' + required);
    }
  }
  const before = await folderSize(standalone);
  const saved = { bytes: 0, count: 0 };
  await prune(path.join(standalone, 'node_modules'), true, saved);
  await prune(path.join(standalone, 'dist/server'), false, saved);
  await prune(path.join(dist, 'server'), false, { bytes: 0, count: 0 });
  // Vinext's Node production server serves static files from dist/client.
  // Keep every public file that is not identically duplicated there.
  await deduplicatePublic(standalone, saved);
  const after = await folderSize(standalone);
  log('[standalone] ' + human(before.bytes) + ' -> ' + human(after.bytes) + ', saved ' + human(before.bytes - after.bytes) + ' (' + saved.count + ' non-runtime/duplicate files)');
  const files = [];
  await visit(standalone, async file => files.push({ file: path.relative(standalone, file), bytes: (await stat(file)).size }));
  for (const item of files.sort((a, b) => b.bytes - a.bytes).slice(0, 15)) {
    log('[standalone] largest: ' + human(item.bytes) + ' ' + item.file);
  }
  if (after.bytes > 128 * 1048576) {
    log('[standalone] Still above 128 MiB before platform packaging; inspect the largest files.');
  }
  return { before, after, saved };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await optimizeStandalone();
}
