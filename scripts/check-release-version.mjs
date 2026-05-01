import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const rawTag = process.env.GITHUB_REF_NAME ?? process.env.RELEASE_TAG ?? '';

if (!rawTag) {
  console.log('No release tag detected. Skipping release version check.');
  process.exit(0);
}

const normalizedTag = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;

if (normalizedTag !== packageJson.version) {
  console.error(
    `Release tag ${rawTag} does not match package.json version ${packageJson.version}.`,
  );
  process.exit(1);
}

console.log(`Release tag ${rawTag} matches package.json version ${packageJson.version}`);
