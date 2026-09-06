# Packaging

Compile the shared viewer before creating any package:

```sh
corepack install --global pnpm@11.24.0
pnpm install
pnpm compile
```

All builds require Node.js 24 LTS and pnpm 11. Native launchers additionally
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
- `pdf-ts_<version>_amd64.deb`
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
