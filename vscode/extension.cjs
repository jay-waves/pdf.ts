const fs = require('node:fs');
const vscode = require('vscode');

const VIEW_TYPE = 'pdf-ts.viewer';
const READING_PROGRESS_KEY = 'pdf-ts.reading-progress-v1';
const THEMES = new Set(['light', 'dark', 'nord', 'solar']);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getParentUri(uri) {
  const slash = uri.path.lastIndexOf('/');
  return uri.with({ path: slash >= 0 ? uri.path.slice(0, slash + 1) : '/' });
}

function nonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function writeThemePreference(uri, theme) {
  if (!THEMES.has(theme)) return;

  const configuration = vscode.workspace.getConfiguration('pdf-ts', uri);
  const inspected = configuration.inspect('theme');
  const target = inspected?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : inspected?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await configuration.update('theme', theme, target);
}

class PdfReadonlyEditorProvider {
  constructor(context) {
    this.context = context;
  }

  openCustomDocument(uri) {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(document, panel) {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, getParentUri(document.uri)],
    };

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'writeThemePreference') {
        try {
          await writeThemePreference(document.uri, message.value);
        } catch (error) {
          console.warn('[pdf-ts] Unable to save theme preference.', error);
        }
        return;
      }

      if (message?.type === 'openExternal') {
        try {
          const url = new URL(message.url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Only HTTP(S) links can be opened externally.');
          }
          await vscode.env.openExternal(vscode.Uri.parse(url.href));
        } catch (error) {
          console.warn('[pdf-ts] Unable to open external link.', error);
        }
        return;
      }

      const requestId = Number(message?.requestId);
      if (!Number.isInteger(requestId) || message?.documentKey !== document.uri.toString()) return;

      try {
        const store = this.context.workspaceState.get(READING_PROGRESS_KEY, {});
        if (message.type === 'readReadingProgress') {
          await panel.webview.postMessage({ type: 'response', requestId, value: store[message.documentKey] });
          return;
        }
        if (message.type === 'writeReadingProgress') {
          const progress = message.progress;
          if (!progress || !Number.isInteger(progress.pageNumber) || progress.pageNumber < 1) {
            throw new Error('Invalid reading progress.');
          }
          await this.context.workspaceState.update(READING_PROGRESS_KEY, {
            ...store,
            [message.documentKey]: progress,
          });
          await panel.webview.postMessage({ type: 'response', requestId });
        }
      } catch (error) {
        await panel.webview.postMessage({
          type: 'response',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    const templateUri = vscode.Uri.joinPath(mediaRoot, 'viewer.html');
    let html = fs.readFileSync(templateUri.fsPath, 'utf8');
    html = html.replace(/(src|href)="(\.\/?|\/)([^"?#]+)"/g, (_match, attribute, _prefix, assetPath) => {
      const assetUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, assetPath));
      return `${attribute}="${assetUri}"`;
    });

    const scriptNonce = nonce();
    const documentUrl = panel.webview.asWebviewUri(document.uri).toString();
    const theme = vscode.workspace.getConfiguration('pdf-ts', document.uri).get('theme', 'light');
    const assetsRoot = vscode.Uri.joinPath(mediaRoot, 'assets');
    const wasmFile = fs.readdirSync(assetsRoot.fsPath).find((name) => /^pdfium-.*\.wasm$/.test(name));
    if (!wasmFile) throw new Error('Bundled PDFium WASM file was not found.');
    const wasmUrl = panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, wasmFile)).toString();
    const csp = [
      "default-src 'none'",
      `img-src ${panel.webview.cspSource} data: blob:`,
      `font-src ${panel.webview.cspSource} data:`,
      `style-src ${panel.webview.cspSource} 'unsafe-inline'`,
      `script-src ${panel.webview.cspSource} 'nonce-${scriptNonce}' 'wasm-unsafe-eval'`,
      `worker-src ${panel.webview.cspSource} blob:`,
      `connect-src ${panel.webview.cspSource} data: blob:`,
    ].join('; ');

    html = html
      .replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">\n    <meta name="pdf-document-url" content="${escapeHtml(documentUrl)}">\n    <meta name="pdf-document-key" content="${escapeHtml(document.uri.toString())}">\n    <meta name="pdfium-wasm-url" content="${escapeHtml(wasmUrl)}">\n    <meta name="pdf-ts-theme" content="${escapeHtml(theme)}">`)
      .replace('<script type="module"', `<script nonce="${scriptNonce}" type="module"`);
    panel.webview.html = html;
  }
}

function activate(context) {
  const provider = new PdfReadonlyEditorProvider(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
    supportsMultipleEditorsPerDocument: false,
    webviewOptions: { retainContextWhenHidden: false },
  }));
}

module.exports = { activate };
