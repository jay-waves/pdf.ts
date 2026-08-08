const fs = require('node:fs');
const vscode = require('vscode');

const VIEW_TYPE = 'pdf-ts.viewer';
const READING_PROGRESS_KEY = 'pdf-ts.reading-progress-v1';
let nextWebviewRequestId = 1;

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

function resolveDocumentLink(documentUri, value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('The PDF link target is empty.');
  }

  const target = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) return vscode.Uri.parse(target);

  const match = /^([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(target);
  if (!match) throw new Error('The PDF link target is invalid.');

  let relativePath;
  try {
    relativePath = decodeURIComponent(match[1]).replaceAll('\\', '/');
  } catch {
    throw new Error('The PDF link path contains invalid escaping.');
  }

  const resolved = !relativePath
    ? documentUri
    : relativePath.startsWith('/')
      ? documentUri.with({ path: relativePath })
      : vscode.Uri.joinPath(getParentUri(documentUri), relativePath);

  return resolved.with({
    query: match[2] ?? '',
    fragment: match[3] ?? '',
  });
}

function nonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

class PdfCustomDocument {
  constructor(uri) {
    this.uri = uri;
    this.panel = undefined;
    this.saveTarget = undefined;
    this.saveQueue = Promise.resolve();
    this.dirty = false;
  }

  dispose() {
    this.panel = undefined;
  }
}

class PdfEditorProvider {
  constructor(context) {
    this.context = context;
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeCustomDocument = this.changeEmitter.event;
    this.pendingSaves = new Map();
  }

  openCustomDocument(uri) {
    return new PdfCustomDocument(uri);
  }

  requestWebviewSave(document, target, preserveDirty, cancellation) {
    const operation = document.saveQueue.then(() => (
      this.performWebviewSave(document, target, preserveDirty, cancellation)
    ));
    document.saveQueue = operation.catch(() => {});
    return operation;
  }

  performWebviewSave(document, target, preserveDirty, cancellation) {
    const panel = document.panel;
    if (!panel) throw new Error('The PDF editor is not open.');

    const requestId = nextWebviewRequestId++;
    document.saveTarget = target;
    return new Promise((resolve, reject) => {
      const cancellationSubscription = cancellation?.onCancellationRequested(() => {
        this.pendingSaves.delete(requestId);
        reject(new vscode.CancellationError());
      });
      this.pendingSaves.set(requestId, {
        document,
        resolve,
        reject,
        dispose: () => cancellationSubscription?.dispose(),
      });
      void panel.webview.postMessage({
        type: 'performSave',
        requestId,
        preserveDirty,
      }).then((delivered) => {
        if (delivered) return;
        const pending = this.pendingSaves.get(requestId);
        if (!pending) return;
        this.pendingSaves.delete(requestId);
        pending.dispose();
        reject(new Error('The PDF editor did not accept the save request.'));
      });
    }).finally(() => {
      if (document.saveTarget?.toString() === target.toString()) {
        document.saveTarget = undefined;
      }
    });
  }

  async saveCustomDocument(document, cancellation) {
    const saved = await this.requestWebviewSave(document, document.uri, false, cancellation);
    if (!saved) throw new Error('The PDF could not be saved.');
    document.dirty = false;
  }

  async saveCustomDocumentAs(document, destination, cancellation) {
    const saved = await this.requestWebviewSave(document, destination, false, cancellation);
    if (!saved) throw new Error('The PDF could not be saved.');
    document.dirty = false;
  }

  async revertCustomDocument(document) {
    document.dirty = false;
    await document.panel?.webview.postMessage({ type: 'reloadDocument' });
  }

  async backupCustomDocument(document, context, cancellation) {
    const saved = await this.requestWebviewSave(document, context.destination, true, cancellation);
    if (!saved) throw new Error('The PDF backup could not be created.');
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // VS Code may already have removed the backup.
        }
      },
    };
  }

  async resolveCustomEditor(document, panel) {
    document.panel = panel;
    panel.onDidDispose(() => {
      if (document.panel === panel) document.panel = undefined;
    });
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, getParentUri(document.uri)],
    };

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'saveResponse') {
        const pending = this.pendingSaves.get(Number(message.requestId));
        if (!pending || pending.document !== document) return;
        this.pendingSaves.delete(Number(message.requestId));
        pending.dispose();
        pending.resolve(Boolean(message.saved));
        return;
      }

      if (message?.type === 'documentDirty') {
        const dirty = Boolean(message.dirty);
        if (dirty && !document.dirty) {
          document.dirty = true;
          this.changeEmitter.fire({ document });
        } else if (!dirty) {
          document.dirty = false;
        }
        return;
      }

      if (message?.type === 'requestDocumentSave') {
        await vscode.commands.executeCommand('workbench.action.files.save');
        return;
      }

      if (message?.type === 'openExternal') {
        try {
          const target = resolveDocumentLink(document.uri, message.url);
          if (target.scheme === 'http' || target.scheme === 'https') {
            await vscode.env.openExternal(target);
          } else if (target.scheme === document.uri.scheme || target.scheme === 'file') {
            const command = target.path.toLowerCase().endsWith('.pdf') ? 'vscode.openWith' : 'vscode.open';
            const args = command === 'vscode.openWith' ? [target, VIEW_TYPE] : [target];
            await vscode.commands.executeCommand(command, ...args);
          } else {
            throw new Error(`Unsupported PDF link scheme: ${target.scheme}`);
          }
        } catch (error) {
          console.warn('[pdf-ts] Unable to open PDF link.', error);
        }
        return;
      }

      const requestId = Number(message?.requestId);
      if (!Number.isInteger(requestId) || message?.documentKey !== document.uri.toString()) return;

      try {
        if (message.type === 'writeDocument') {
          if (!(message.data instanceof Uint8Array)) {
            throw new Error('Invalid PDF data.');
          }
          await vscode.workspace.fs.writeFile(document.saveTarget ?? document.uri, message.data);
          await panel.webview.postMessage({ type: 'response', requestId });
          return;
        }

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
    const documentName = document.uri.path.split('/').pop() || 'document.pdf';
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
      .replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">\n    <meta name="pdf-document-url" content="${escapeHtml(documentUrl)}">\n    <meta name="pdf-document-key" content="${escapeHtml(document.uri.toString())}">\n    <meta name="pdf-document-name" content="${escapeHtml(documentName)}">\n    <meta name="pdfium-wasm-url" content="${escapeHtml(wasmUrl)}">`)
      .replace('<script type="module"', `<script nonce="${scriptNonce}" type="module"`);
    panel.webview.html = html;
  }
}

function activate(context) {
  const provider = new PdfEditorProvider(context);
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
    supportsMultipleEditorsPerDocument: false,
    // Serialization currently happens in the PDFium worker owned by the
    // webview. Keep it alive so Auto Save and backups also work while hidden.
    webviewOptions: { retainContextWhenHidden: true },
  }));
}

module.exports = { activate };
