import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const manifestPath = resolve(repoRoot, 'extension-public', 'manifest.json');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version === packageJson.version) {
  console.log(`Manifest version already matches package.json: ${packageJson.version}`);
  process.exit(0);
}

manifest.version = packageJson.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Updated manifest version to ${packageJson.version}`);
