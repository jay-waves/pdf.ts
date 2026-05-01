# pdf.ts Chrome Extension

This repository contains the source for a Chrome Manifest V3 PDF viewer extension built with Vite, React, and EmbedPDF.

## Local development

```powershell
pnpm install
pnpm build
```

The unpacked extension output is written to `dist/extension`. Load that directory from `chrome://extensions` with Developer mode enabled.

## Packaging

```powershell
pnpm release:prepare
```

This produces:

- `dist/extension`: unpacked extension directory for local loading
- `dist/release/pdf-ts-chrome-extension-v<version>.zip`: release asset ready for GitHub Releases

## GitHub Release flow

1. Push the repository to `https://github.com/jay-waves/pdf.ts`.
2. Commit and push your changes.
3. Create and publish a GitHub Release in the repository UI.
4. The `Build release package` workflow builds the extension and uploads the zip to that Release automatically.

You can also run the same workflow manually from the Actions tab via `workflow_dispatch`.

## Open local PDFs

- Click the extension toolbar icon and pick a PDF.
- Or open `viewer.html?file=file:///C:/path/to/file.pdf` inside the extension.
- Enable **Allow access to file URLs** for the unpacked extension in `chrome://extensions` before using `file://` URLs.

The manifest includes a `.pdf` `file_handlers` entry for Chrome environments that support the Launch Handler flow. On normal desktop Chrome, extensions cannot register themselves as the OS-level default double-click PDF handler.
