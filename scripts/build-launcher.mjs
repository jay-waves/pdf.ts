import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'release/web');
const embedded = resolve(root, 'launcher/viewer');
const target = process.argv[2];
if (!['linux-amd64', 'windows-amd64'].includes(target)) throw new Error('Expected linux-amd64 or windows-amd64.');
if (!existsSync(resolve(source, 'index.html'))) throw new Error('Run pnpm build:web first.');

function copy(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(targetDir)) {
    if (entry !== 'placeholder.txt') rmSync(resolve(targetDir, entry), { recursive: true, force: true });
  }
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const from = resolve(sourceDir, entry.name);
    const to = resolve(targetDir, entry.name);
    if (entry.isDirectory()) copy(from, to);
    else writeFileSync(`${to}.gz`, gzipSync(readFileSync(from), { level: 9 }));
  }
}

copy(source, embedded);
const windows = target === 'windows-amd64';
const output = resolve(root, 'release/launcher', windows ? 'pdf.ts.exe' : 'pdf.ts');
mkdirSync(resolve(root, 'release/launcher'), { recursive: true });
const linkerFlags = windows ? '-s -w -H=windowsgui' : '-s -w';
let windowsResource = null;
if (windows) {
  const candidates = [process.env.PDF_TS_WINDRES, "llvm-windres", "x86_64-w64-mingw32-windres", "windres"].filter(Boolean);
  const windres = candidates.find((candidate) => {
    const check = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    return !check.error && check.status === 0;
  });
  if (!windres) throw new Error("build:windows requires llvm-windres or windres");
  windowsResource = resolve(root, "launcher", "icon_windows_amd64.syso");
  const compiled = spawnSync(windres, [
    "--input", resolve(root, "launcher", "icon.rc"),
    "--output", windowsResource,
    "--output-format", "coff",
    "--target", "pe-x86-64",
  ], { cwd: root, stdio: "inherit" });
  if (compiled.error) throw compiled.error;
  if (compiled.status !== 0) process.exit(compiled.status ?? 1);
}
const result = spawnSync(process.env.PDF_TS_GO ?? 'go', ['build', '-trimpath', `-ldflags=${linkerFlags}`, '-o', output, './launcher'], {
  cwd: root,
  env: { ...process.env, GOOS: windows ? 'windows' : 'linux', GOARCH: 'amd64' },
  stdio: 'inherit',
});
if (windowsResource) rmSync(windowsResource, { force: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Built ${output}`);
