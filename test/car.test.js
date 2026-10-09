'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function event() {
  const listeners = new Set();
  return {
    subscribe(fn) { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    fire(value) { for (const fn of listeners) fn(value); },
    listeners,
  };
}
const active = event();
const visible = event();
const focus = event();
const change = event();
const types = [];
let animationEnabled;
const vscode = {
  Range: class { constructor(sl, sc, el, ec) { this.start = { line: sl, character: sc }; this.end = { line: el, character: ec }; } },
  DecorationRangeBehavior: { ClosedClosed: 1 },
  window: {
    state: { focused: true }, activeTextEditor: undefined,
    onDidChangeActiveTextEditor: fn => active.subscribe(fn),
    onDidChangeTextEditorVisibleRanges: fn => visible.subscribe(fn),
    onDidChangeWindowState: fn => focus.subscribe(fn),
    createTextEditorDecorationType(options) {
      const type = { options, disposed: false, dispose() { this.disposed = true; } };
      types.push(type); return type;
    },
  },
  workspace: {
    onDidChangeTextDocument: fn => change.subscribe(fn),
    getConfiguration: () => ({ get: (key, fallback) => key === 'animationEnabled' ? animationEnabled : fallback }),
  },
};
const originalLoad = Module._load;
let driveCar, playResetAnimation, initializeCarAnimation;
try {
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  ({ driveCar, playResetAnimation, initializeCarAnimation } = require('../src/car'));
} finally { Module._load = originalLoad; }

function editor() {
  return {
    document: { isClosed: false, lineCount: 100, text: 'const untouched = true;', version: 1, isDirty: false },
    selections: [{ line: 0, character: 3 }],
    visibleRanges: [new vscode.Range(10, 0, 40, 0)], calls: [],
    setDecorations(type, options) { this.calls.push({ type, options }); },
  };
}
function fixture(t) {
  animationEnabled = true;
  types.length = 0; vscode.window.state.focused = true;
  vscode.window.activeTextEditor = editor();
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1000 });
  const car = initializeCarAnimation();
  t.after(() => car.dispose());
  return { car, editor: vscode.window.activeTextEditor };
}

test('driveCar animates above a zero-length code anchor and finishes without changing editor state', t => {
  const { car, editor } = fixture(t);
  const before = JSON.stringify({ document: editor.document, selections: editor.selections });
  assert.equal(driveCar(), true);
  const first = editor.calls[0].options[0];
  assert.deepEqual(first.range, new vscode.Range(25, 0, 25, 0));
  assert.match(types[0].options.before.textDecoration, /position:absolute/);
  assert.match(types[0].options.before.textDecoration, /pointer-events:none/);
  t.mock.timers.tick(1500);
  const halfway = Number(editor.calls.at(-1).options[0].renderOptions.before.margin.match(/calc\(([\d.]+)vw/)[1]);
  assert.ok(halfway >= 49 && halfway <= 51);
  t.mock.timers.tick(1500);
  assert.equal(car.run, null);
  assert.equal(types[0].disposed, true);
  assert.deepEqual(editor.calls.at(-1).options, []);
  assert.equal(JSON.stringify({ document: editor.document, selections: editor.selections }), before);
  const count = editor.calls.length;
  t.mock.timers.tick(3000);
  assert.equal(editor.calls.length, count);
});

test('repeated triggers replace the old animation and its finish timer cannot cancel the new one', t => {
  const { car, editor } = fixture(t);
  driveCar(); t.mock.timers.tick(1000);
  driveCar(5000);
  assert.equal(types[0].disposed, true);
  const oldCount = editor.calls.filter(c => c.type === types[0]).length;
  t.mock.timers.tick(2000);
  assert.equal(car.run.type, types[1]);
  assert.equal(types[1].disposed, false);
  assert.equal(editor.calls.filter(c => c.type === types[0]).length, oldCount);
  t.mock.timers.tick(3000);
  assert.equal(types[1].disposed, true);
});

test('editor switching clears the original editor and the next trigger targets the new editor', t => {
  const { car, editor: first } = fixture(t);
  driveCar();
  const second = editor(); vscode.window.activeTextEditor = second; active.fire(second);
  assert.equal(car.run, null);
  assert.deepEqual(first.calls.at(-1).options, []);
  assert.equal(types[0].disposed, true);
  assert.equal(second.calls.length, 0);
  driveCar();
  assert.equal(second.calls.length, 1);
});

test('scrolling, document edits and losing focus cancel decorations without changing code', t => {
  const { car, editor } = fixture(t);
  driveCar(); visible.fire({ textEditor: editor }); assert.equal(car.run, null);
  driveCar(); change.fire({ document: {} }); assert.ok(car.run);
  change.fire({ document: editor.document }); assert.equal(car.run, null);
  driveCar(); focus.fire({ focused: false }); assert.equal(car.run, null);
  assert.ok(types.every(type => type.disposed));
});

test('missing editors, invisible ranges, closed documents and invalid durations are harmless', t => {
  const { editor } = fixture(t);
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(driveCar(duration), false);
  editor.visibleRanges = []; assert.equal(driveCar(), false);
  vscode.window.activeTextEditor = undefined; assert.equal(driveCar(), false);
  editor.document.isClosed = true; vscode.window.activeTextEditor = editor;
  assert.equal(driveCar(), false);
  assert.equal(types.length, 0);
});

test('reset animation shakes a bell while three cars move together and clears all decorations at six seconds', t => {
  const { car, editor } = fixture(t);
  const before = JSON.stringify({ document: editor.document, selections: editor.selections });
  assert.equal(playResetAnimation(), true);
  assert.equal(types.length, 4);
  assert.deepEqual(types.map(type => type.options.before.contentText), ['🏎️💨', '🏎️💨', '🏎️💨', '🔔']);
  assert.match(types[3].options.before.textDecoration, /position:absolute/);
  assert.doesNotMatch(types[3].options.before.textDecoration, /position:fixed|50vh|50vw/);
  assert.equal(new Set(types.slice(0, 3).map(type => type.options.before.textDecoration)).size, 3);
  t.mock.timers.tick(75);
  const bell = editor.calls.filter(call => call.type === types[3]).at(-1).options[0];
  assert.match(bell.renderOptions.before.textDecoration, /rotate\(18\.00deg\)/);
  assert.deepEqual(bell.range, new vscode.Range(25, 0, 25, 0));
  t.mock.timers.tick(2925);
  const positions = types.slice(0, 3).map(type => editor.calls.filter(call => call.type === type).at(-1).options[0].renderOptions.before.margin);
  assert.equal(new Set(positions).size, 1);
  assert.match(positions[0], /50\.000vw/);
  t.mock.timers.tick(2999); assert.ok(types.every(type => !type.disposed));
  t.mock.timers.tick(1); assert.equal(car.run, null);
  assert.ok(types.every(type => type.disposed));
  assert.equal(JSON.stringify({ document: editor.document, selections: editor.selections }), before);
  for (const type of types) assert.deepEqual(editor.calls.filter(call => call.type === type).at(-1).options, []);
});

test('no minute timer remains and repeated warnings or editor switching clean up every attachment', t => {
  const { car } = fixture(t);
  t.mock.timers.tick(120000); assert.equal(types.length, 0);
  playResetAnimation(); t.mock.timers.tick(1000); playResetAnimation();
  assert.ok(types.slice(0, 4).every(type => type.disposed));
  t.mock.timers.tick(5000); assert.ok(car.run);
  active.fire(undefined); assert.equal(car.run, null);
  assert.ok(types.every(type => type.disposed));
});

test('unloading releases frame timers, decorations and event subscriptions', t => {
  const { car, editor } = fixture(t);
  driveCar(); car.dispose();
  const count = editor.calls.length;
  t.mock.timers.tick(120000);
  assert.equal(editor.calls.length, count);
  assert.equal(types.length, 1);
  assert.equal(types[0].disposed, true);
  assert.equal(driveCar(), false);
  for (const source of [active, visible, focus, change]) assert.equal(source.listeners.size, 0);
});

test('a disappearing editor or decoration failure disposes the run safely', t => {
  const { car, editor } = fixture(t);
  driveCar(); editor.document.isClosed = true;
  t.mock.timers.tick(33);
  assert.equal(car.run, null); assert.equal(types[0].disposed, true);
  editor.document.isClosed = false;
  editor.setDecorations = () => { throw new Error('Editor unavailable'); };
  assert.equal(driveCar(), false);
  assert.equal(types[1].disposed, true);
});

test('partial warning creation or rendering failures release every decoration already created', t => {
  const { car, editor } = fixture(t);
  const create = vscode.window.createTextEditorDecorationType;
  let creations = 0;
  t.mock.method(vscode.window, 'createTextEditorDecorationType', options => {
    if (++creations === 3) throw new Error('Cannot create attachment');
    return create(options);
  });
  assert.equal(playResetAnimation(), false);
  assert.equal(types.length, 2); assert.ok(types.every(type => type.disposed));
  let renders = 0;
  editor.setDecorations = () => { if (++renders === 2) throw new Error('Editor disappeared'); };
  assert.equal(playResetAnimation(), false);
  assert.equal(types.length, 6); assert.ok(types.every(type => type.disposed));
  assert.equal(car.run, null);
});

test('disabling animation immediately removes the full overlay and blocks all triggers until re-enabled', t => {
  const { car, editor } = fixture(t);
  assert.equal(playResetAnimation(), true);
  t.mock.timers.tick(1000);
  animationEnabled = false; car.configure();
  assert.equal(car.run, null);
  assert.ok(types.every(type => type.disposed));
  const calls = editor.calls.length;
  assert.equal(driveCar(), false);
  assert.equal(playResetAnimation(), false);
  t.mock.timers.tick(120000);
  assert.equal(editor.calls.length, calls);
  assert.equal(types.length, 4);
  animationEnabled = true; car.configure();
  assert.equal(playResetAnimation(), true);
  assert.equal(types.length, 8);
});
