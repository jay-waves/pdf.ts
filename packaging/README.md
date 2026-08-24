# Packaging

Native packages are intentionally unsigned. They install the launcher and file
association, while viewer data remains in the per-user application data directory.

## Chrome

`packaging/chrome/` contains the extension-only manifest and service worker.
Run `pnpm package:chrome` after `pnpm compile`.

## Linux

[nFPM](https://nfpm.goreleaser.com/) is required. Run `pnpm package:linux`
after `pnpm compile` to create both packages, or use `pnpm package:deb` and
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
toolchain are required. Both run on Linux. Run `pnpm package:windows` after
`pnpm compile`.

The all-users installer requests administrator permission, writes to
`%ProgramFiles%\pdf.ts`, registers the PDF file association, and appears in
Windows Installed Apps. Upgrade and uninstall stop the current user's daemon
first. Uninstall leaves every user's viewer data intact.

Automatic daemon startup is opt-in. Copy
`%ProgramFiles%\pdf.ts\pdf.ts-startup.cmd` into the folder opened by
`shell:startup` for the current user. Remove that copied script to disable it.
