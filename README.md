<p align="center">
  <img src="assets/logo.png" width="96" alt="PDF.ts logo">
</p>

<h1 align="center">PDF.ts</h1>

<p align="center">A polished, local-first PDF reader and editor powered by EmbedPDF.</p>

Available for the Chrome, Linux, Windows, and macOS. [Try it now!](https://jay-waves.cn/pdf.ts)

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

## Features

PDF.ts is more than a read-only viewer. It combines focused reading with
practical PDF editing and document tools:

- **Edit and save:** highlight, underline, strike out, draw, add shapes, arrows,
  text, and comments; fill forms; undo or redo changes; then save them back to
  the PDF or export a copy
- **Work with documents:** inspect metadata and digital signatures, manage PDF
  protection, and print selected pages with configurable sizing
- **Read efficiently:** full-text search, outlines, thumbnails, multiple scroll
  and spread modes, precise zooming, rotation, and remembered reading progress
- **Enjoy a refined interface:** carefully tuned typography, spacing, motion,
  responsive controls, and cohesive light, dark, Nord, Gruvbox, and Solar themes
- **Recolor the document itself:** dark themes adapt PDF pages, text, vector
  artwork, highlights, and annotation colors instead of merely darkening the UI
- **Keep work local:** documents stay on the device, while supported browsers
  can also translate selected text with an on-device model

## Install and use

Download a package for your platform from
[GitHub Releases](https://github.com/jay-waves/pdf.ts/releases). Install the
`deb` or `rpm` on Linux, run the setup executable on Windows, or copy
`pdf.ts.app` from the DMG to `/Applications` on macOS. Native packages are not
code-signed, so your operating system may ask you to confirm that you trust
them.

For Chrome, extract the extension ZIP and load the extracted directory through
`chrome://extensions` with Developer mode enabled.

On desktop, open a PDF through its file association. Native launchers also
accept a path from the command line:

```sh
pdf.ts open document.pdf
```

Running `pdf.ts` without a file opens the welcome screen. The launcher starts a
local-only background service automatically; use `pdf.ts stop` to stop it and
`pdf.ts status` to inspect it. Installed packages leave user data in place when
removed. Run `pdf.ts purge` before uninstalling if you also want to delete the
current user's PDF.ts data.

In the web and Chrome builds, choose or drop a local PDF. Direct saving depends
on the browser's file-system support; when it is unavailable, PDF.ts downloads
a new copy instead. Desktop packages can save changes back to the opened file.

## Compatibility

The browser build targets ES2025 and requires Chrome/Edge 152+, Firefox 154+,
Safari 26+, or iOS 26+.

Translation is local-only and requires browser support for the built-in
Translator API; Microsoft Edge 148 or later is required. The target language
defaults to the browser's preferred language and can be changed in the
Developer dialog. Translation uses [BCP 47](https://www.rfc-editor.org/info/bcp47)
tags. Language tags are passed through without changing their meaning; an
unspecified `zh` tag is supplemented as `zh-Hans` for the browser Translator
API.
Consult the [official Edge language list](https://github.com/MicrosoftEdge/Demos/blob/main/built-in-ai/static/translator-api.js)
or use the [Edge Built-in AI Playground](https://microsoftedge.github.io/Demos/built-in-ai/)
to check model availability.

## Build from source

Development requires Node.js 24 LTS and pnpm 11.

```sh
corepack install --global pnpm@11.24.0
pnpm install

pnpm compile
```

The static web app is written to `release/web`. See the
[packaging guide](packaging/README.md) for native prerequisites, commands, and
artifacts.
