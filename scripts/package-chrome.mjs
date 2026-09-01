import {
  cpSync,
  createWriteStream,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';
import yazl from 'yazl';

const repoRoot = resolve(import.meta.dirname, '..');
const releaseDir = resolve(repoRoot, 'release');
const viewerDir = resolve(releaseDir, 'web');
const extensionDir = resolve(releaseDir, 'chrome-extension');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

if (!existsSync(resolve(viewerDir, 'index.html'))) {
  throw new Error('Run pnpm compile first.');
}

rmSync(extensionDir, { recursive: true, force: true });
cpSync(viewerDir, extensionDir, { recursive: true });
cpSync(resolve(repoRoot, 'packaging', 'chrome', 'service-worker.js'), resolve(extensionDir, 'service-worker.js'));

const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'packaging', 'chrome', 'manifest.json'), 'utf8'));
manifest.version = packageJson.version;
writeFileSync(
  resolve(extensionDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

for (const size of [16, 32, 48, 128]) {
  cpSync(
    resolve(repoRoot, 'assets', `icon-${size}.png`),
    resolve(extensionDir, `icon-${size}.png`),
  );
}

for (const entry of readdirSync(releaseDir)) {
  if (/^pdf-ts-chrome-v.+\.zip$/u.test(entry)) {
    rmSync(resolve(releaseDir, entry), { force: true });
  }
}
const archivePath = resolve(releaseDir, `pdf-ts-chrome-v${packageJson.version}.zip`);

const zip = new yazl.ZipFile();
function addDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) addDirectory(path);
    else if (entry.isFile()) {
      zip.addFile(path, relative(extensionDir, path).replaceAll('\\', '/'));
    }
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

console.log(`Packaged ${archivePath}`);
