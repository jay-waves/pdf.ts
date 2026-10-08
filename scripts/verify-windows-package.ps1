# Install only on the disposable Actions runner, never on a developer's machine.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) {
    throw 'This package smoke check requires a Windows GitHub Actions runner.'
}

$repoRoot = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $repoRoot "release\pdf-ts-$version-x86_64-pc-windows.exe"
$source = Join-Path $repoRoot 'release\pdf.ts.exe'
$installDir = Join-Path $env:RUNNER_TEMP 'pdf ts package check\app'
$installed = Join-Path $installDir 'pdf.ts.exe'
$uninstallKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\pdf.ts'
$associationKey = 'HKLM:\Software\Classes\pdf.ts.Document\shell\open\command'
$startupShortcut = Join-Path ([Environment]::GetFolderPath('CommonStartup')) 'pdf.ts.lnk'

function Invoke-PackageProcess([string] $Path, [string] $Arguments) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(120000)) {
        $process.Kill()
        throw "Process timed out: $Path $Arguments"
    }
    if ($process.ExitCode -ne 0) {
        throw "Process failed ($($process.ExitCode)): $Path $Arguments"
    }
}

# Confirm the linked executable is x64 GUI PE with an embedded resource table.
$bytes = [IO.File]::ReadAllBytes($source)
$pe = [BitConverter]::ToInt32($bytes, 0x3c)
if ([BitConverter]::ToUInt32($bytes, $pe) -ne 0x4550 -or
    [BitConverter]::ToUInt16($bytes, $pe + 4) -ne 0x8664 -or
    [BitConverter]::ToUInt16($bytes, $pe + 24) -ne 0x20b -or
    [BitConverter]::ToUInt16($bytes, $pe + 24 + 68) -ne 2 -or
    [BitConverter]::ToUInt32($bytes, $pe + 24 + 112 + 16) -eq 0) {
    throw 'Launcher must be a Windows x64 GUI executable with embedded resources.'
}

# /D and _?= must be the final, unquoted arguments, even for paths with spaces.
Invoke-PackageProcess $installer "/S /D=$installDir"
if ((Test-Path $startupShortcut) -or (Test-Path (Join-Path $installDir 'pdf.ts-startup.cmd'))) {
    throw 'Startup must be opt-in and must not install a CMD script.'
}
if ((Get-FileHash $installed).Hash -ne (Get-FileHash $source).Hash) {
    throw 'Installed launcher differs from the packaged executable.'
}
$registration = Get-ItemProperty $uninstallKey
if ($registration.DisplayVersion -ne $version -or $registration.InstallLocation -ne $installDir) {
    throw 'Installed application version or location is incorrect.'
}
$openCommand = (Get-Item $associationKey).GetValue('')
if ($openCommand -ne ('"' + $installed + '" open "%1"')) {
    throw 'PDF file association points to an incorrect command.'
}
$openWith = Get-Item 'HKLM:\Software\Classes\.pdf\OpenWithProgids'
if ($openWith.GetValueNames() -notcontains 'pdf.ts.Document') {
    throw 'PDF Open With registration is missing.'
}

Invoke-PackageProcess $installed 'start'
Invoke-PackageProcess $installed 'status'
# Explicit opt-in creates a native shortcut with an independent argument field.
Invoke-PackageProcess $installer "/S /AUTOSTART=1 /D=$installDir"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startupShortcut)
if (-not (Test-Path $startupShortcut) -or $shortcut.TargetPath -ne $installed -or $shortcut.Arguments -ne 'daemon') {
    throw 'Startup shortcut target or arguments are incorrect.'
}
# Reinstallation exercises stopping the running daemon and replacing its executable.
Invoke-PackageProcess $installer "/S /D=$installDir"
if (-not (Test-Path $startupShortcut)) {
    throw 'Upgrade did not preserve startup opt-in.'
}
if ((Get-FileHash $installed).Hash -ne (Get-FileHash $source).Hash) {
    throw 'Launcher was not preserved during reinstallation.'
}
Invoke-PackageProcess $installed 'start'
Invoke-PackageProcess $installer "/S /AUTOSTART=0 /D=$installDir"
if (Test-Path $startupShortcut) { throw 'Explicit startup opt-out failed.' }
Invoke-PackageProcess $installer "/S /AUTOSTART=1 /D=$installDir"
Invoke-PackageProcess (Join-Path $installDir 'Uninstall.exe') "/S _?=$installDir"
if ((Test-Path $installed) -or (Test-Path $uninstallKey) -or (Test-Path $associationKey) -or (Test-Path $startupShortcut)) {
    throw 'Uninstall left the executable or application registration behind.'
}
Write-Host 'Windows package verified: resources, install, daemon startup, upgrade and uninstall.'
