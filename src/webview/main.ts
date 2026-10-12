/*
 * SVG View & Edit
 * Author:     Amiran Kimadze (itsarmen)
 * GitHub:     https://github.com/itsarmen
 * Email:      amoswaper@gmail.com
 * Web:        https://xrow.asia
 *
 * Webview client: an editable, syntax-highlighted XML source editor
 * (CodeMirror 6) on the left and a live SVG image preview on the right.
 */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { xml } from '@codemirror/lang-xml';
import { oneDark } from '@codemirror/theme-one-dark';
import './styles.css';

const vscode = acquireVsCodeApi();

type LayoutMode = 'source' | 'split' | 'preview';

interface InitMessage {
  type: 'init';
  text?: string;
  fileName?: string;
  path?: string;
  mode?: LayoutMode;
  checkerboard?: boolean;
}

const sourceHost = document.getElementById('source') as HTMLElement;
const previewEl = document.getElementById('preview') as HTMLElement;
const statusPathEl = document.getElementById('status-path') as HTMLElement;
const statusInfoEl = document.getElementById('status-info') as HTMLElement;
const docNameEl = document.getElementById('doc-name') as HTMLElement;
const dirtyEl = document.getElementById('dirty') as HTMLElement;
const saveButton = document.getElementById('save') as HTMLButtonElement | null;

let text = '';
let editTimer: number | undefined;
let previewTimer: number | undefined;
let suppressDocChange = false;

function post(message: Record<string, unknown>): void {
  vscode.postMessage(message);
}

// ---- Source editor (CodeMirror) ------------------------------------------

const dark =
  document.body.classList.contains('vscode-dark') ||
  document.body.classList.contains('vscode-high-contrast');

const vscodeTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editor-foreground)',
    fontSize: 'var(--vscode-editor-font-size, 13px)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--vscode-editor-font-family, ui-monospace, monospace)',
    lineHeight: '1.5',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground))',
    border: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
});

const themeCompartment = new Compartment();

const view = new EditorView({
  parent: sourceHost,
  state: EditorState.create({
    doc: '',
    extensions: [
      basicSetup,
      xml(),
      themeCompartment.of(dark ? [oneDark, vscodeTheme] : vscodeTheme),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppressDocChange) {
          return;
        }
        handleDocChange(update.state.doc.toString());
      }),
    ],
  }),
});

function setDoc(next: string): void {
  text = next;
  if (view.state.doc.toString() !== next) {
    suppressDocChange = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
    suppressDocChange = false;
  }
  updateStatus();
}

function handleDocChange(next: string): void {
  text = next;
  updateStatus();
  schedulePreview();
  scheduleEdit();
}

function scheduleEdit(): void {
  if (editTimer) {
    window.clearTimeout(editTimer);
  }
  editTimer = window.setTimeout(() => {
    editTimer = undefined;
    post({ type: 'edit', text });
  }, 250);
}

function schedulePreview(): void {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
  }
  previewTimer = window.setTimeout(() => {
    previewTimer = undefined;
    renderPreview(text);
  }, 80);
}

function flushEdit(): void {
  if (editTimer) {
    window.clearTimeout(editTimer);
    editTimer = undefined;
  }
  post({ type: 'edit', text });
}

// ---- SVG preview ---------------------------------------------------------

function renderPreview(svgText: string): void {
  if (svgText.trim() === '') {
    previewEl.replaceChildren();
    return;
  }
  let svg: Element | null = null;
  const xmlDoc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (!xmlDoc.querySelector('parsererror')) {
    svg = xmlDoc.documentElement;
  } else {
    const htmlDoc = new DOMParser().parseFromString(svgText, 'text/html');
    svg = htmlDoc.querySelector('svg');
  }
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
    showError('Not valid SVG markup.');
    return;
  }
  try {
    previewEl.replaceChildren(document.importNode(svg, true));
  } catch {
    showError('Could not render this SVG.');
  }
}

function showError(message: string): void {
  const box = document.createElement('div');
  box.className = 'svg-error';
  box.textContent = message;
  previewEl.replaceChildren(box);
}

// ---- Modes ---------------------------------------------------------------

function setMode(next: LayoutMode, notify = true): void {
  document.body.dataset.viewMode = next;
  for (const button of Array.from(
    document.querySelectorAll<HTMLElement>('.segmented button'),
  )) {
    button.classList.toggle('active', button.dataset.mode === next);
  }
  updateStatus();
  if (notify) {
    vscode.setState({ mode: next });
    post({ type: 'mode', mode: next });
  }
}

// ---- Status bar ----------------------------------------------------------

function updateStatus(path?: string): void {
  const lines = text === '' ? 0 : text.split('\n').length;
  const chars = text.length;
  statusInfoEl.textContent = `${lines} lines · ${chars} chars`;
  if (path) {
    statusPathEl.textContent = path;
  }
}

// ---- Save ----------------------------------------------------------------

const saveIcon = saveButton?.innerHTML ?? '';
const checkIcon =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
let savedTimer: number | undefined;

function flashSaved(): void {
  if (!saveButton) {
    return;
  }
  saveButton.innerHTML = checkIcon;
  saveButton.classList.add('saved');
  if (savedTimer) {
    window.clearTimeout(savedTimer);
  }
  savedTimer = window.setTimeout(() => {
    saveButton.innerHTML = saveIcon;
    saveButton.classList.remove('saved');
  }, 1200);
}

function requestSave(): void {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = undefined;
  }
  renderPreview(text);
  flushEdit();
  flashSaved();
  post({ type: 'save', text });
}

// ---- Wiring --------------------------------------------------------------

saveButton?.addEventListener('click', requestSave);

for (const button of Array.from(
  document.querySelectorAll<HTMLElement>('.segmented button'),
)) {
  button.addEventListener('click', () => {
    setMode((button.dataset.mode as LayoutMode) ?? 'split');
  });
}

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    requestSave();
  }
});

// ---- Messages from the host ----------------------------------------------

window.addEventListener('message', (event) => {
  const message = event.data as (InitMessage | Record<string, unknown>) | undefined;
  if (!message || typeof message !== 'object') {
    return;
  }
  switch ((message as { type?: string }).type) {
    case 'init': {
      const init = message as InitMessage;
      if (init.fileName) {
        docNameEl.textContent = init.fileName;
      }
      document.body.dataset.checkerboard = String(init.checkerboard !== false);
      setDoc(init.text ?? '');
      renderPreview(text);
      setMode(init.mode ?? 'split', false);
      updateStatus(init.path);
      break;
    }
    case 'update': {
      const data = message as { text?: string };
      setDoc(data.text ?? '');
      renderPreview(text);
      break;
    }
    case 'config': {
      const data = message as { checkerboard?: boolean };
      document.body.dataset.checkerboard = String(data.checkerboard !== false);
      break;
    }
    case 'saved':
      flashSaved();
      break;
    case 'dirty':
      dirtyEl.hidden = !(message as { dirty?: boolean }).dirty;
      break;
    case 'path': {
      const data = message as { path?: string };
      if (data.path) {
        statusPathEl.textContent = data.path;
      }
      break;
    }
    default:
      break;
  }
});

post({ type: 'ready' });
