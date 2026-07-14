import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const releaseRoot = resolve(repoRoot, 'release', 'vscode');
const extensionDir = resolve(releaseRoot, 'extension');
const stagingDir = resolve(releaseRoot, 'vsix');
const packageJson = JSON.parse(readFileSync(resolve(extensionDir, 'package.json'), 'utf8'));
const vsixPath = resolve(releaseRoot, `pdf-ts-vscode-v${packageJson.version}.vsix`);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
cpSync(extensionDir, resolve(stagingDir, 'extension'), { recursive: true });

writeFileSync(resolve(stagingDir, '[Content_Types].xml'), `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="cjs" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="wasm" ContentType="application/wasm" />
  <Default Extension="png" ContentType="image/png" />
  <Override PartName="/extension.vsixmanifest" ContentType="text/xml" />
</Types>\n`);
writeFileSync(resolve(stagingDir, 'extension.vsixmanifest'), `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${packageJson.name}" Version="${packageJson.version}" Publisher="${packageJson.publisher}" />
    <DisplayName>${packageJson.displayName}</DisplayName>
    <Description xml:space="preserve">${packageJson.description}</Description>
    <Categories>${packageJson.categories.join(',')}</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${packageJson.engines.vscode}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
    </Properties>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>\n`);

rmSync(vsixPath, { force: true });
const zip = spawnSync('zip', ['-qr', vsixPath, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], {
  cwd: stagingDir,
  stdio: 'inherit',
});
if (zip.status !== 0) process.exit(zip.status ?? 1);
console.log(`Created ${vsixPath}`);
