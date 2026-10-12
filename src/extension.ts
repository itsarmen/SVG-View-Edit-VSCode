/*
 * SVG View & Edit
 * Author:     Amiran Kimadze (itsarmen)
 * GitHub:     https://github.com/itsarmen
 * Email:      amoswaper@gmail.com
 * Web:        https://xrow.asia
 *
 * Visual Studio Code extension entry point.
 */

import * as vscode from 'vscode';
import { SvgEditorProvider } from './provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SvgEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SvgEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.commands.registerCommand('svgViewEdit.openEditor', (uri?: vscode.Uri) =>
      openWith(uri, SvgEditorProvider.viewType),
    ),
    vscode.commands.registerCommand('svgViewEdit.openSource', (uri?: vscode.Uri) =>
      openWith(uri, 'default'),
    ),
    vscode.commands.registerCommand('svgViewEdit.openImage', (uri?: vscode.Uri) =>
      openWith(uri, 'imagePreview.previewEditor'),
    ),
  );
}

export function deactivate(): void {
  /* Disposables are torn down by VS Code. */
}

/** Resolve the file the command should act on. */
function resolveUri(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri) {
    return uri;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    return editor.document.uri;
  }
  const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
    return input.uri;
  }
  return undefined;
}

async function openWith(uri: vscode.Uri | undefined, viewType: string): Promise<void> {
  const target = resolveUri(uri);
  if (!target) {
    void vscode.window.showInformationMessage(
      'SVG View & Edit: open an SVG file first.',
    );
    return;
  }
  try {
    await vscode.commands.executeCommand('vscode.openWith', target, viewType);
  } catch {
    void vscode.window.showWarningMessage(
      `SVG View & Edit: could not open the file with "${viewType}".`,
    );
  }
}
