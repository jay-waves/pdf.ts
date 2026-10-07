# Packaging

## Automated releases

Run checks and compile locally before publishing. Only version tag pushes trigger
`.github/workflows/release.yml`; branch pushes and pull requests do not build.

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
this initial workflow. Node/pnpm and Go are set up on the runners; nFPM and NSIS
are needed only for optional local native packaging, not frontend development.

After all four packages succeed, Actions updates one release per version series (minor versions for 0.x,
major versions for 1.x and later):
`v0.9.4` updates `v0.9-latest`, while `v1.2.3` updates `v1-latest`. Version tags stay
unchanged; rolling tags point to the installed version's commit. New attachments
are uploaded before old attachments are removed. Re-running a successful tag is
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

Artifacts are written to `release/`:

- `pdf-ts-chrome-v<version>.zip`
- `pdf.ts` and `pdf.ts.exe`
- `pdf-ts-<version>-amd64.deb`
- `pdf-ts-<version>-1.x86_64.rpm`
- `pdf-ts-setup-v<version>.exe`
- `macos-arm64/pdf.ts.app`
- `pdf-ts-v<version>-macos-arm64.dmg`

Custom tool locations can be supplied through `PDF_TS_GO`, `PDF_TS_WINDRES`,
`PDF_TS_MAKENSIS`, `PDF_TS_NFPM`, and `PDF_TS_HDIUTIL`.

Native packages are intentionally unsigned. They install the launcher and file
association, while viewer data remains in the per-user application data directory.
The launcher itself does not install or uninstall platform integration; each
platform package owns that lifecycle. Portable launchers provide only `purge`
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

[NSIS](https://nsis.sourceforge.io/) and a Windows launcher cross-build
toolchain are required. Both run on Linux.

```sh
# Debian / Ubuntu
sudo apt install golang-go binutils-mingw-w64-x86-64 nsis

# Fedora
sudo dnf install golang mingw64-binutils mingw32-nsis
```

The Fedora `mingw32-nsis` package is intentional. NSIS uses a traditional x86
installer bootstrap to install the 64-bit launcher into `%ProgramFiles%`.

The all-users installer requests administrator permission, writes to
`%ProgramFiles%\pdf.ts`, registers the PDF file association, and appears in
Windows Installed Apps. Upgrade and uninstall stop the current user's daemon
first. Uninstall leaves every user's viewer data intact.

Automatic daemon startup is opt-in. Copy
`%ProgramFiles%\pdf.ts\pdf.ts-startup.cmd` into the folder opened by
`shell:startup` for the current user. Remove that copied script to disable it.

## macOS

Run `pnpm package:macos` on Apple Silicon macOS to build the application and
disk image.

The app bundle and DMG packaging step runs only on macOS and uses the system
`sips`, `iconutil`, `ditto`, and `hdiutil` commands; there is no third-party
packaging dependency. Linux DMG writers are intentionally unsupported because
they do not provide the same compatibility guarantees. Override the `hdiutil`
path with `PDF_TS_HDIUTIL` when necessary.

The resulting `pdf.ts.app` and DMG have no Developer ID signature and are not
notarized. The packaging script does not invoke `codesign`; the Go linker may
add the minimal ad-hoc signature structure required for an Apple Silicon
executable. The app bundle declares PDF metadata in `Info.plist`; macOS owns
application discovery and file-association registration when the app is copied
to or launched from `/Applications`.
