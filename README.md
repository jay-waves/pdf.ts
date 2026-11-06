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

Chrome extension ZIPs can be built locally (the automated release currently
includes only native installers). Extract the extension ZIP and load the extracted directory through
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

Translate uses the remote model configured in **Developer > LLM**. Its separate
**Translate** card contains the translation prompt. The default uses
`{{browserDefault}}`, which is replaced with the browser's preferred language
for each request; replace it with a fixed language if desired.
`{{selectedText}}` inserts the selection. Source/target language fields,
browser translation models, model downloads, and language detection are removed.
When LLM is off, the Translate action is labeled **Translate (Google Translate)**
and directly opens Google Translate with the selection in a new tab. Google
manages language choices on its page. If LLM is enabled but not configured,
the reader reports a configuration error instead of silently switching providers.

## LLM

Web, desktop, and Chrome builds call an OpenAI-compatible Chat Completions
endpoint directly from the browser. Configure it in Developer > LLM. The endpoint
must use HTTPS (HTTP is also allowed for localhost, 127.0.0.1, and [::1])
and allow browser requests through CORS. The Ask popover supports
streaming replies and follow-up questions while it remains open. The translation
prompt applies only to Translate; Ask sends your message directly. Resetting LLM
settings preserves the separate Translate prompt.

Browser LLM requests always send `reasoning_effort: "none"` through the OpenAI-compatible
Chat Completions API, including streaming responses, follow-ups, and connection tests.
Use an endpoint and model that support this setting. An incompatible provider error is
reported without retrying with reasoning enabled. Providers that ignore this parameter
must be configured to disable thinking on their side or use a compatible gateway.

API keys stay in page memory by default and are lost on reload or close. Selecting
**Remember API key in this browser** explicitly opts into unencrypted local
storage; the warning below the checkbox explains the risk. Use a separate,
revocable key with a provider-enforced hard spending limit. Memory-only storage
and the following safeguards do not protect against arbitrary same-origin XSS.

Requests block redirects and omit cookies and referrers. Changing the Base URL
clears the existing key, and provider error bodies are not displayed. **Clear key**
removes the saved key and its in-memory copy in the current page. Other already
open pages may still hold their own in-memory copies; close them or revoke the key
at the provider to stop all use.

The retired Go LLM proxy and encrypted credential storage have been removed.
On opening an existing registry, the launcher removes its old AI configuration
and `master.key`; it does not import the old credential into browser storage.
Re-enter your key after upgrading.

## Build from source

For frontend-only validation in WSL, run `pnpm dev:wsl` and open
`http://localhost:5173` in your Windows browser (or forward port 5173 to your
browser machine). The welcome screen accepts a dropped PDF or a file selection.
Changes reload through Vite; no compilation, packaging, or Go daemon is required.
This uses the existing browser adapter rather than desktop launcher APIs.

Development requires Node.js 24 LTS and pnpm 12.

```sh
corepack install --global pnpm@12.3.4
pnpm install

pnpm compile
```

The static web app is written to `release/web`. See the
[packaging guide](packaging/README.md) for native prerequisites, commands, and
artifacts.
