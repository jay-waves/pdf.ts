# PDF.ts

A polished PDF viewer powered by EmbedPDF, available for the web, Chrome,
Linux, and Windows.

## Build

Compile the shared browser viewer once:

```bash
pnpm compile
```

The static web app is written to `release/web`. Package any host from that
compiled viewer without rebuilding the frontend:

```bash
pnpm package:chrome
pnpm package:linux
pnpm package:windows
```

To compile once and package every host:

```bash
pnpm build:all
```

Artifacts are written to:

- `release/pdf-ts-chrome-v<version>.zip`
- `release/pdf.ts`
- `release/pdf.ts.exe`

The desktop launcher serves the viewer from `pdf.ts.localhost`, safely saves
full or incremental updates, and installs only the PDF file association.

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
