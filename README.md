<p align="center">
  <img src="assets/logo.png" width="96" alt="PDF.ts logo">
</p>

<h1 align="center">PDF.ts</h1>

<p align="center">A local-first PDF reader and editor powered by EmbedPDF.</p>

[Try it online](https://jay-waves.cn/pdf.ts) · [Download for Linux, Windows, or macOS](https://github.com/jay-waves/pdf.ts/releases)

<table>
  <tr>
    <td align="center"><img src="assets/gruvbox-screenshot.webp" width="700" alt="PDF.ts in Gruvbox theme"><br>Gruvbox</td>
    <td align="center"><img src="assets/light-screenshot.webp" width="700" alt="PDF.ts in Light theme"><br>Light</td>
  </tr>
</table>

## Features

- **Read comfortably:** search, outlines, thumbnails, flexible page layouts, zoom,
  rotation, and remembered reading progress.
- **Edit and save:** highlight, draw, add text and comments, fill forms, undo/redo,
  and save changes to a PDF or export a copy.
- **Work with documents:** inspect metadata and digital signatures, manage
  password protection, and print selected pages.
- **Theme the page, too:** light, dark, Nord, Gruvbox, and Solar themes adapt
  document colors as well as the interface.
- **Keep work local:** PDF processing runs on your device, with automatic editing
  drafts and shared edits across supported same-origin tabs. Optional AI actions
  send selected text and conversation messages to your chosen service.

## Get started

Install a `deb` or `rpm` on Linux, run the setup executable on Windows, or copy
`pdf.ts.app` from the DMG to `/Applications` on macOS. Desktop packages are
unsigned, so your OS may ask you to confirm that you trust them.

Open a PDF through its file association, or run:

```sh
pdf.ts open document.pdf
```

Running `pdf.ts` alone opens the welcome screen. In the web app, choose or drop a
PDF. For Chrome, build the extension with `pnpm package:chrome` after compiling,
extract the ZIP, and load it through `chrome://extensions` with Developer mode
enabled.

The browser build targets Chrome/Edge 152+, Firefox 154+, Safari/iOS 26+.

## Reading and saving

Use the toolbar for annotations and document tools, and the navigation panels
for search, outlines, and thumbnails. Reading position is remembered when the
document has a stable identity.

**Save to PDF** (`Ctrl+S`) writes your changes to the original file on desktop.
Browser builds save directly when file-system access and permission are available;
otherwise they download a copy. External file updates preserve your view, and
unsaved edits require confirmation before replacement.

Annotation edits and simple form values are saved automatically as drafts:
`original.pdf.swp` beside the PDF on desktop, or in private browser storage on
the web. Reopening restores a matching draft; conflicts let you download or
discard it. Drafts do not change the original PDF and are not backups. Encrypted
PDFs do not create plaintext drafts; metadata and security changes require
**Save to PDF**.

Supported same-origin tabs share edits and undo/redo for the same file and
revision, while keeping navigation and selection independent. Copies and files
without a stable identity, such as dropped files, remain separate.

The desktop background service starts automatically. Use `pdf.ts status` to
inspect it or `pdf.ts stop` to stop it. Uninstalling preserves user data; run
`pdf.ts purge` before uninstalling to remove it.

## Translation and AI

Select text to **Translate** or **Ask**. Configure an OpenAI-compatible endpoint,
model, and API key in **Developer > LLM**. The endpoint must allow browser requests
through CORS, use HTTPS (or HTTP on localhost), and support
`reasoning_effort: "none"`. Ask supports streaming replies and follow-up questions.

Customize translation in **Developer > Translate**: `{{selectedText}}` inserts
the selection and `{{browserDefault}}` uses your browser's preferred language.
When LLM is off, Translate opens Google Translate with the selection instead.

API keys stay in memory unless you enable **Remember API key in this browser**,
which stores the key unencrypted locally. **Clear key** removes it from the
current page and saved settings; other open pages may retain an in-memory copy.

## Development

Requires Node.js 24+ and pnpm 12.

```sh
corepack install --global pnpm@12.3.4
pnpm install
pnpm dev       # Local development; use pnpm dev:wsl for WSL
pnpm check     # Type checking and unit tests
pnpm compile  # Static web app in release/web
```

For installers, run `pnpm package:linux`, `pnpm package:windows`, or
`pnpm package:macos` after compiling. Native builds require Go; Linux packaging
also needs nFPM, Windows needs NSIS and rsrc, and macOS needs Apple Silicon
with Xcode Command Line Tools.

## Architecture

The React viewer owns navigation, selection and presentation. EmbedPDF provides
PDF editing and rendering, backed by PDFium in a worker. A SharedWorker shares
document edits and history across supported tabs; a dedicated worker is the
fallback. Each tab renders its own view.

The worker coordinates document state, drafts and saves. Platform adapters handle
browser files, the Chrome extension and the desktop Go service, including file
permissions and disk access.

See [development workflows](docs/development-workflows.md) for targeted checks and script usage,
[GLOSSARY.md](GLOSSARY.md) for terminology,
[interface boundaries](docs/interfaces.md) for developer contracts, and
[rendering implementation and checks](docs/rendering.md) for rendering details.
