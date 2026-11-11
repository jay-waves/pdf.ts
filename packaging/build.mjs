/** One build plan for local commands and CI. Consumes an existing release/web;
 * platform packagers remain internal steps, never launch a release themselves. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [target, ...formats] = process.argv.slice(2);
const plans = {
  chrome: { formats: [], steps: [['node', 'package-chrome.mjs']] },
  linux: { formats: ['deb', 'rpm'], binary: 'linux-amd64' },
  windows: { formats: ['exe'], binary: 'windows-amd64', steps: [['node', 'package-windows.mjs']] },
  macos: { formats: ['dmg'], binary: 'darwin-arm64', steps: [['sh', 'package-macos.sh']] },
};
const plan = Object.hasOwn(plans, target) ? plans[target] : undefined;
const binaryOnly = formats.length === 1 && formats[0] === 'binary';
if (!plan || (binaryOnly && !plan.binary) || (!binaryOnly && formats.some(format => !plan.formats.includes(format)))) {
  throw Error('Usage: node packaging/build.mjs chrome | linux [deb rpm | binary] | windows [exe | binary] | macos [dmg | binary]');
}
// Validate the complete request before compiling or modifying outputs.
if (target === 'macos' && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
  throw Error('macOS packaging requires Apple Silicon macOS.');
}
function run(tool, script, ...args) {
  const executable = tool === 'node' ? process.execPath : tool;
  const result = spawnSync(executable, [resolve(root, 'scripts', script), ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${script} failed (${result.status ?? result.signal}).`);
}
if (plan.binary) run('node', 'package-launcher.mjs', plan.binary);
if (!binaryOnly) {
  if (target === 'linux') for (const format of new Set(formats.length ? formats : plan.formats)) run('sh', 'package-linux.sh', format);
  else for (const [tool, script] of plan.steps) run(tool, script);
}
