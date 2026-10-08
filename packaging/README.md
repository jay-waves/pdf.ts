# Packaging

## Automated releases

Run checks and compile locally before publishing. Only version tag pushes trigger
`.github/workflows/release.yml`; branch pushes and pull requests do not build.
To validate packaging before tagging, run **Actions → Release → Run workflow**
on a branch containing these changes. Manual runs build artifacts and verify the
Windows installer, but never update rolling tags, Releases, or Pages. The workflow
must be present on the default branch for GitHub to show the manual run button.

```sh
pnpm check
pnpm compile
# After committing all changes (example for package.json version 0.9.4):
bash scripts/release.sh v0.9.4
```

The helper validates the version and clean working tree, then atomically pushes
the branch and tag using your existing Git authentication. `GITHUB_TOKEN` is
optional. It does not build or deploy locally.

Actions builds the frontend once without rerunning local tests/type checking,
then packages Windows x64 (NSIS), Debian x64 (deb), Fedora x64 (rpm), and macOS
ARM64 (DMG). Chrome packaging remains available locally but is not included in
this initial workflow. Linux packages and the Windows cross-build run on Ubuntu
24.04; macOS runs on Apple Silicon macOS 15. A separate Windows Server 2022
runner verifies the Windows install, upgrade, and uninstall. Node/pnpm and Go
are set up on the runners; nFPM, `rsrc`, and NSIS are installed only in the
Linux packaging job, not the frontend job.
Only the frontend job installs pnpm dependencies. Native packaging jobs run the
scripts directly with Node.js and reuse the shared web artifact, so they do not
install the frontend dependency tree or apply its patches again.

After all four packages succeed, Actions updates one release per version series (minor versions for 0.x,
major versions for 1.x and later):
`v0.9.4` updates `v0.9-latest`, while `v1.2.3` updates `v1-latest`. Version tags stay
unchanged; rolling tags point to the installed version's commit. New attachments
are uploaded before old attachments are removed. The highest version series is
marked as GitHub's Latest release; maintenance releases of older series do not
replace it. Re-running a successful tag is
supported; older versions and ancestor tags cannot overwrite a newer published version, and divergent
histories are rejected. Updates to an existing Release are not atomic, so an
interrupted upload can temporarily leave attachments from both versions; rerun
the failed job to complete it. Do not enable immutable releases for these rolling
Releases or protect rolling tags against workflow updates.

The same frontend is deployed to GitHub Pages after successful publication.
Pages follows the newest published version series; maintenance releases for older
version series update their installers without replacing the web viewer. Intermediate artifacts expire after one day;
rerun all jobs if they have expired.

One-time repository setup:

- In Settings → Pages, select **GitHub Actions** as the build source. Keep the
  existing custom domain configuration.
- Allow the `github-pages` environment to deploy version tags (adjust deployment
  branch/tag restrictions if necessary).
- Allow the workflow's `GITHUB_TOKEN` to write repository contents. No personal
  access token, Apple credentials, or signing certificates are required.

The workflow deliberately does not mark maintenance releases as GitHub's global
“Latest”; each version series has its own stable Release URL. Packages remain
unsigned and macOS is not notarized. The initial successful run creates the
rolling Release; existing releases on other tags are left in place.

## Optional local packaging

Compile the shared viewer before creating any package:

```sh
corepack install --global pnpm@12.3.4
pnpm install
pnpm compile
```

All builds require Node.js 24 LTS and pnpm 12. Native launchers additionally
require Go 1.27 or later.

## Commands

```sh
pnpm package:chrome  # Chrome extension
pnpm package:windows # Windows launcher and NSIS installer
pnpm package:linux   # Linux launcher, deb, and Fedora-compatible rpm
pnpm package:macos   # unsigned Apple Silicon app and DMG
pnpm package:deb     # Linux launcher and deb only
pnpm package:rpm     # Linux launcher and rpm only
pnpm build:all       # compile, then package Chrome, Linux, and Windows
```

Packaging reuses `release/web`; individual package commands do not rebuild the
frontend. `package:all` and `build:all` omit macOS because app bundles and DMGs
must be created on macOS.

Artifacts are written to `release/`. Native installers use
`pdf-ts-<version>-<triplet>.<extension>`; the version comes from `package.json`.
Windows uses `x86_64-pc-windows` without a compiler ABI suffix because the launcher
is built with Go.

- `pdf-ts-chrome-v<version>.zip`
- `pdf.ts` and `pdf.ts.exe`
- `pdf-ts-<version>-x86_64-unknown-linux-gnu.deb`
- `pdf-ts-<version>-x86_64-unknown-linux-gnu.rpm`
- `pdf-ts-<version>-x86_64-pc-windows.exe`
- `macos-arm64/pdf.ts.app`
- `pdf-ts-<version>-aarch64-apple-darwin.dmg`

Linux can cross-build the Windows launcher and installer with Go, `rsrc`, and
NSIS. Install them with `go install github.com/akavel/rsrc@v0.10.2` and
`sudo apt install nsis`. Windows verification still runs natively in CI.

Custom tool locations can be supplied through `PDF_TS_GO`,
`PDF_TS_MAKENSIS`, `PDF_TS_NFPM`, `PDF_TS_RSRC`, and `PDF_TS_HDIUTIL`.

Native packages have no publisher certificate signatures (macOS uses ad-hoc
signing). They install the launcher and file
association, while viewer data remains in the per-user application data directory.
Platform packages own installation and file associations. The macOS app also
provides commands to manage its bundled login agent. Portable launchers provide only `purge`
for explicitly deleting the current user's viewer data.

## Chrome

`packaging/chrome/` contains the extension-only manifest and service worker.
Run `pnpm package:chrome` after `pnpm compile`.

## Linux

[nFPM](https://nfpm.goreleaser.com/docs/install/) is required:

```sh
# Debian / Ubuntu
sudo apt install golang-go

# Fedora
sudo dnf install golang

# Ensure $(go env GOPATH)/bin is in PATH
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest
```

Run `pnpm package:linux` to create both packages, or use `pnpm package:deb` and
`pnpm package:rpm` separately.

The packages install:

- `/usr/bin/pdf.ts`
- `/usr/share/applications/pdf.ts.desktop`
- `/usr/share/icons/hicolor/128x128/apps/pdf.ts.png`
- `/usr/lib/systemd/user/pdf.ts.service`

Removing a package leaves per-user viewer data intact.

The daemon remains on-demand by default. To start it automatically for the
current user:

```sh
systemctl --user enable --now pdf.ts.service
```

Disable it with `systemctl --user disable --now pdf.ts.service` before removing
the package.

## Windows

The release workflow builds on Windows using Go's `rsrc` tool (pinned to
v0.10.2) and [NSIS](https://nsis.sourceforge.io/). `rsrc` generates the icon
resource object directly for Go; no Windows SDK, LLVM, MinGW, or GCC is required.
The workflow installs `rsrc` into a runner temporary directory and explicitly
passes its path, then locates the preinstalled NSIS executable. Before publishing,
the Windows job silently installs the package, checks its icon and registration,
runs the launcher, reinstalls it to exercise upgrades, and uninstalls it. This
package smoke check runs only on the disposable Windows runner; application tests
remain local.
`pnpm package:windows` uses Node.js to invoke NSIS directly, without a POSIX shell.
For local Windows packaging, run `go install github.com/akavel/rsrc@v0.10.2`
and put it and NSIS on PATH, or set `PDF_TS_RSRC` and `PDF_TS_MAKENSIS`.

Linux cross-builds use the same `rsrc` version and Go resource generation path,
plus Linux NSIS. No alternate windres resource compiler is used.

The all-users installer requests administrator permission, writes to
`%ProgramFiles%\pdf.ts`, registers the PDF file association, and appears in
Windows Installed Apps. Upgrade and uninstall stop the current user's daemon
first. Uninstall leaves every user's viewer data intact.

Automatic daemon startup is opt-in. Select **Start background service at login**
on the installer's Installation options page to create a shortcut in the all-users
Startup folder. It runs the GUI executable directly with `daemon`,
without a CMD script or a browser window. Upgrades preserve the existing choice;
unchecking the option removes the shortcut, and uninstall removes it too.
Silent installs accept `/AUTOSTART=1` or `/AUTOSTART=0` before the final `/D=...`
argument. Remove any startup CMD scripts previously copied into `shell:startup`
manually; those user-owned copies are not managed by the installer.

## macOS

Run `pnpm package:macos` on Apple Silicon macOS to build the application and
disk image.

The app requires macOS 13 or later. The app bundle and DMG packaging step runs
only on macOS and uses Xcode Command Line Tools (`xcrun swiftc`), plus the system
`codesign`, `plutil`, `sips`, `iconutil`, `ditto`, and `hdiutil` commands; there is no third-party
packaging dependency. Linux DMG writers are intentionally unsupported because
they do not provide the same compatibility guarantees. Override the `hdiutil`
path with `PDF_TS_HDIUTIL` when necessary.

The resulting `pdf.ts.app` and DMG have no Developer ID signature and are not
notarized. Packaging ad-hoc signs the launcher and app bundle for ServiceManagement.
The app bundle declares PDF metadata in `Info.plist`; macOS owns
application discovery and file-association registration when the app is copied
to or launched from `/Applications`.

After copying the app to `/Applications`, opt into login startup with:

```sh
/Applications/pdf.ts.app/Contents/MacOS/pdf.ts autostart enable
/Applications/pdf.ts.app/Contents/MacOS/pdf.ts autostart status
/Applications/pdf.ts.app/Contents/MacOS/pdf.ts autostart disable
```

The native app entry point uses Apple's `SMAppService` to register the LaunchAgent
inside `Contents/Library/LaunchAgents`; it does not copy a plist into the user's
Library or use `launchctl`. If macOS requires approval, `enable` opens Login Items
in System Settings and reports `requires-approval`. Status reports `enabled`,
`disabled`, `requires-approval`, or `not-found`. The agent runs only `daemon`,
without opening the viewer. Disable it before removing or moving the app.
Disabling unregisters the agent; use `pdf.ts stop` to stop an independently
started, on-demand daemon if needed. Login registration is per user and is not
enabled by packaging or by opening a PDF.
