import { createWriteStream, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import yazl from 'yazl';

const repoRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const manifestPath = resolve(repoRoot, 'chrome', 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = packageJson.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const watch = process.argv.includes('--watch');
const vite = spawnSync('pnpm', ['exec', 'vite', 'build', ...(watch ? ['--watch'] : [])], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (vite.error) throw vite.error;
if (vite.status !== 0) process.exit(vite.status ?? 1);
if (watch) process.exit(0);

const extensionDir = resolve(repoRoot, 'release', 'chrome', 'extension');
const archivePath = resolve(repoRoot, 'release', 'chrome', `pdf-ts-chrome-v${packageJson.version}.zip`);
rmSync(archivePath, { force: true });

const zip = new yazl.ZipFile();
function addDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) addDirectory(path);
    else if (entry.isFile()) zip.addFile(path, relative(extensionDir, path).replaceAll('\\', '/'));
  }
}
addDirectory(extensionDir);

await new Promise((resolvePromise, reject) => {
  const output = createWriteStream(archivePath);
  output.on('close', resolvePromise);
  output.on('error', reject);
  zip.outputStream.on('error', reject).pipe(output);
  zip.end();
});

console.log(`Built ${archivePath}`);
