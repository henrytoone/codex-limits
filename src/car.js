'use strict';
const vscode = require('vscode');

// These extra declarations intentionally use the decoration textDecoration workaround.
// They style only this attachment; no workbench CSS, DOM access or installation edits.
const CAR_STYLE = 'none; position:absolute; left:0; top:-12px; z-index:20; pointer-events:none; font-size:40px; line-height:44px; white-space:nowrap; transform:scaleX(-1);';
// Keep the bell relative to the visible code line. Fixed viewport coordinates are
// relative to Monaco's transformed, scrolled content and can put it off-screen.
// Cap the horizontal offset so a long code line cannot push it out of the editor.
const BELL_STYLE = 'none; position:absolute; left:min(50%,240px); top:9px; z-index:30; pointer-events:none; font-size:64px; line-height:80px; white-space:nowrap; transform-origin:50% 15%; transform:translate(-50%,-50%);';

/** @typedef {{editor: import('vscode').TextEditor, type: import('vscode').TextEditorDecorationType,
 * types: import('vscode').TextEditorDecorationType[],
 * range: import('vscode').Range, startedAt: number, duration: number,
 * frames: NodeJS.Timeout|null, finish: NodeJS.Timeout|null}} Run */

class CarAnimation {
  constructor() {
    /** @type {Run|null} */
    this.run = null;
    this.disposed = false;
    this.listeners = [
      vscode.window.onDidChangeActiveTextEditor(() => this.cancel()),
      vscode.window.onDidChangeTextEditorVisibleRanges(event => {
        if (event.textEditor === this.run?.editor) this.cancel();
      }),
      vscode.window.onDidChangeWindowState(event => { if (!event.focused) this.cancel(); }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === this.run?.editor.document) this.cancel();
      }),
    ];
  }

  configure() {
    if (!vscode.workspace.getConfiguration('codexLimits').get('animationEnabled', true)) this.cancel();
  }

  /** Start in the current editor. A new trigger replaces the previous animation.
   * @param {number} [duration] @param {boolean} [warning] @returns {boolean} */
  drive(duration = 3000, warning = false) {
    if (this.disposed || !Number.isFinite(duration) || duration <= 0) return false;
    this.cancel();
    if (!vscode.workspace.getConfiguration('codexLimits').get('animationEnabled', true)) return false;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.isClosed || !editor.visibleRanges.length) return false;
    // Choose the middle of the largest visible block, including folded documents.
    const visible = [...editor.visibleRanges].sort((a, b) =>
      (b.end.line - b.start.line) - (a.end.line - a.start.line))[0];
    const line = Math.min(editor.document.lineCount - 1, Math.floor((visible.start.line + visible.end.line) / 2));
    /** @type {import('vscode').TextEditorDecorationType[]} */
    const types = [];
    try {
      for (const top of warning ? [-84, -12, 60] : [-12]) types.push(vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        before: { contentText: '🏎️💨', width: '100px', height: '44px',
          textDecoration: `${CAR_STYLE} top:${top}px;` },
      }));
      if (warning) types.push(vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        before: { contentText: '🔔', width: '80px', height: '80px', textDecoration: BELL_STYLE },
      }));
    } catch {
      types.forEach(type => type.dispose());
      return false;
    }
    const run = /** @type {Run} */ ({
      editor, type: types[0], types, range: new vscode.Range(line, 0, line, 0),
      startedAt: Date.now(), duration, frames: null, finish: null,
    });
    this.run = run;
    const frame = () => {
      if (this.run !== run) return;
      if (vscode.window.activeTextEditor !== editor || editor.document.isClosed) {
        this.cancel(); return;
      }
      const progress = Math.max(0, Math.min(1, (Date.now() - run.startedAt) / duration));
      try {
        for (const type of types.slice(0, warning ? 3 : 1)) editor.setDecorations(type, [{ range: run.range, renderOptions: {
          // Native API exposes no editor pixel width. Viewport units carry the car
          // beyond the editor's clipped right edge, including on short code lines.
          before: { margin: `0 0 0 calc(${(progress * 100).toFixed(3)}vw - 100px)` },
        } }]);
        if (warning) {
          const angle = (Math.sin((Date.now() - run.startedAt) / 300 * Math.PI * 2) * 18).toFixed(2);
          editor.setDecorations(types[3], [{ range: run.range, renderOptions: { before: {
            textDecoration: `${BELL_STYLE} transform:translate(-50%,-50%) rotate(${angle}deg);`,
          } } }]);
        }
      } catch { this.cancel(); }
    };
    frame();
    if (this.run !== run) return false;
    run.frames = setInterval(frame, 33); // About 30 frames/s; only while driving.
    run.finish = setTimeout(() => { if (this.run === run) this.cancel(); }, duration);
    return true;
  }

  cancel() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    if (run.frames) clearInterval(run.frames);
    if (run.finish) clearTimeout(run.finish);
    for (const type of run.types) {
      try { if (!run.editor.document.isClosed) run.editor.setDecorations(type, []); }
      catch { /* The editor may have closed before its change event arrived. */ }
      finally { type.dispose(); }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.listeners.forEach(listener => listener.dispose());
  }
}

/** @type {CarAnimation|null} */
let animation = null;

/** Called by extension activation; return value belongs in context.subscriptions. */
function initializeCarAnimation() {
  animation?.dispose();
  animation = new CarAnimation();
  return animation;
}

/** Reusable trigger for other extension features. Returns false if no editor is available.
 * @param {number} [duration] */
function driveCar(duration = 3000) { return animation?.drive(duration) ?? false; }

/** Show a shaking bell and three cars for six seconds. */
function playResetAnimation() { return animation?.drive(6000, true) ?? false; }

module.exports = { driveCar, playResetAnimation, initializeCarAnimation };
