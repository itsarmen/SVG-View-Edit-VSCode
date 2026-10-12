/*
 * SVG View & Edit
 * Author:     Amiran Kimadze (itsarmen)
 * GitHub:     https://github.com/itsarmen
 * Email:      amoswaper@gmail.com
 * Web:        https://xrow.asia
 *
 * The custom editor provider: an XML source editor with syntax highlighting on
 * the left and a live SVG image preview on the right, plus a Save button.
 */

import * as vscode from 'vscode';

type LayoutMode = 'split' | 'source' | 'preview';

interface SvgConfig {
  defaultMode: LayoutMode;
  checkerboard: boolean;
}

const MODE_KEY = 'svgViewEdit.mode';

function readConfig(): SvgConfig {
  const config = vscode.workspace.getConfiguration('svgViewEdit');
  return {
    defaultMode: config.get<LayoutMode>('defaultMode', 'split'),
    checkerboard: config.get<boolean>('preview.checkerboard', true),
  };
}

function basename(document: vscode.TextDocument): string {
  const parts = document.uri.path.split('/');
  return parts[parts.length - 1] || document.uri.path;
}

export class SvgEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'svgViewEdit.editor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(document.uri, '..'),
        ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
      ],
    };
    webview.html = this.getHtml(webview, document);

    let lastFromWebview = document.getText();

    const post = (message: Record<string, unknown>) => {
      void webview.postMessage(message);
    };

    const sendInit = () => {
      const config = readConfig();
      post({
        type: 'init',
        text: document.getText(),
        fileName: basename(document),
        path: vscode.workspace.asRelativePath(document.uri, false),
        mode: this.context.workspaceState.get<LayoutMode>(MODE_KEY, config.defaultMode),
        checkerboard: config.checkerboard,
      });
      post({ type: 'dirty', dirty: document.isDirty });
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      const text = document.getText();
      if (text === lastFromWebview) {
        return;
      }
      lastFromWebview = text;
      post({ type: 'update', text });
    });

    const configSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('svgViewEdit')) {
        post({ type: 'config', checkerboard: readConfig().checkerboard });
      }
    });

    const saveSubscription = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === document.uri.toString()) {
        post({ type: 'dirty', dirty: false });
      }
    });

    const messageSubscription = webview.onDidReceiveMessage(async (message) => {
      const data = message as { type?: string; [key: string]: unknown };
      switch (data.type) {
        case 'ready':
          sendInit();
          break;
        case 'edit':
          await this.applyEdit(document, String(data.text ?? ''));
          lastFromWebview = document.getText();
          post({ type: 'dirty', dirty: true });
          break;
        case 'save': {
          await this.applyEdit(document, String(data.text ?? ''));
          lastFromWebview = document.getText();
          let ok = false;
          try {
            ok = await document.save();
          } catch {
            ok = false;
          }
          post({ type: 'saved', ok });
          post({ type: 'dirty', dirty: document.isDirty });
          break;
        }
        case 'mode':
          await this.context.workspaceState.update(MODE_KEY, data.mode);
          break;
        default:
          break;
      }
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
      configSubscription.dispose();
      saveSubscription.dispose();
      messageSubscription.dispose();
    });
  }

  private async applyEdit(document: vscode.TextDocument, text: string): Promise<void> {
    if (text === document.getText()) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    edit.replace(document.uri, fullRange, text);
    await vscode.workspace.applyEdit(edit);
  }

  private getHtml(webview: vscode.Webview, document: vscode.TextDocument): string {
    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'),
    );
    const config = readConfig();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: http: data: blob:`,
      `media-src ${webview.cspSource} https:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource} https: data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${styleUri}" />
<title>${escapeHtml(basename(document))}</title>
</head>
<body data-view-mode="split" data-checkerboard="${config.checkerboard}">
<div class="app">
  <header class="app-bar">
    <div class="title">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L9 20"/></svg>
      <span class="doc-name" id="doc-name">${escapeHtml(basename(document))}</span>
      <span class="dirty" id="dirty" hidden>•</span>
    </div>
    <div class="spacer"></div>
    <div class="segmented" id="mode-switch" role="group" aria-label="Layout">
      <button type="button" data-mode="source" title="Source" aria-label="Source">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      </button>
      <button type="button" data-mode="split" title="Split" aria-label="Split">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
      </button>
      <button type="button" data-mode="preview" title="Preview" aria-label="Preview">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </div>
    <button class="icon-btn" id="save" title="Save" aria-label="Save">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
    </button>
  </header>
  <div class="body">
    <section class="source-pane">
      <div class="source-host" id="source"></div>
    </section>
    <section class="preview-pane">
      <div class="svg-stage" id="preview"></div>
    </section>
  </div>
  <footer class="status-bar">
    <span class="status-path" id="status-path"></span>
    <span class="status-info" id="status-info"></span>
  </footer>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
