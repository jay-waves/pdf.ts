# EmbedPDF Chrome Extension Wrapper

This project wraps the released `dist/index.js` React component as a Chrome MV3 extension.

## Build

```powershell
npm install
npm run build
```

Load the generated `extension` folder from `chrome://extensions` with Developer mode enabled.

## Open local PDFs

- Click the extension toolbar icon and pick a PDF.
- Or open `viewer.html?file=file:///C:/path/to/file.pdf` inside the extension.
- Enable **Allow access to file URLs** for the unpacked extension in `chrome://extensions` before using `file://` URLs.

The manifest also declares a `.pdf` `file_handlers` entry for Chrome environments that support the Launch Handler flow. On normal desktop Chrome, extensions cannot register themselves as the Windows/macOS/Linux default double-click PDF handler; that OS-level association needs a native app or protocol bridge.
