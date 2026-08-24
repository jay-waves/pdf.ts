# PDF.ts

A polished PDF viewer powered by EmbedPDF, available for the web, Chrome,
Linux, and Windows.

The browser build targets ES2025 and requires Chrome/Edge 129+, Firefox 147+,
or Safari 26+.

## Build

Compile the shared browser viewer once:

```bash
pnpm compile
```

The static web app is written to `release/web`. Package any host from that
compiled viewer without rebuilding the frontend:

```bash
pnpm package:chrome
pnpm package:windows # Windows binary and NSIS installer
pnpm package:linux   # Linux binary, deb, and Fedora-compatible rpm
pnpm package:deb     # Linux binary and deb only
pnpm package:rpm     # Linux binary and rpm only
```

Native packaging requires nFPM for deb/rpm and NSIS for the Windows installer.
See [`packaging/README.md`](packaging/README.md).

To compile once and package every host:

```bash
pnpm build:all
```

Artifacts are written to:

- `release/pdf-ts-chrome-v<version>.zip`
- `release/pdf.ts`
- `release/pdf.ts.exe`
- `release/pdf-ts_<version>_amd64.deb`
- `release/pdf-ts-<version>-1.x86_64.rpm`
- `release/pdf-ts-setup-v<version>.exe`

The desktop launcher serves the viewer from `pdf.ts.localhost`, safely saves
full or incremental updates, and installs only the PDF file association.
Launching `pdf.ts` without arguments opens the shared Welcome screen; selecting
or dropping a PDF there uses the browser's local-file saving capabilities.

<table>
  <tr>
    <td align="center">
      <img src="./assets/gruvbox-screenshot.webp" width="700" />
      <br />
      Gruvbox
    </td>
    <td align="center">
      <img src="./assets/light-screenshot.webp" width="700" />
      <br />
      Light
    </td>
  </tr>
</table>
