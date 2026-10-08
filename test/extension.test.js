'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { UsageError } = require('../src/usage');

const commands = new Map();
const settings = new Map();
let auth;
let authError;
let usageError;
let usage;
let resetDetails;
let resetDetailsError;
let resetRequests;
let pendingRequest;
let deferResponse;
let reads;
let requests;
let configListener;
const logs = [];
const disposable = () => ({ dispose() {} });
const vscode = {
  StatusBarAlignment: { Right: 2 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class {
    constructor() { this.value = ''; }
    appendText(text) { this.value += text; return this; }
    appendMarkdown(text) { this.value += text; return this; }
  },
  window: {
    createStatusBarItem: () => ({ text: '', visible: false, show() { this.visible = true; }, dispose() { this.visible = false; } }),
    createOutputChannel: () => ({ appendLine(line) { logs.push(line); }, show() {}, dispose() {} }),
    onDidChangeWindowState: disposable,
  },
  workspace: {
    getConfiguration: section => ({ get(key, fallback) { return settings.get(`${section}.${key}`) ?? fallback; } }),
    onDidChangeConfiguration(listener) { configListener = listener; return disposable(); },
  },
  commands: {
    registerCommand(id, fn) { commands.set(id, fn); return disposable(); },
    executeCommand: async () => {},
  },
};
const originalLoad = Module._load;
let activate;
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request === './usage' && parent?.filename.endsWith('/src/extension.js')) return {
      UsageError,
      async fetchResetCredits() { resetRequests++; if (resetDetailsError) throw resetDetailsError; return resetDetails; },
      async readAuth() { reads++; if (authError) throw authError; return auth; },
      async fetchUsage(auth, { signal }) {
        requests++;
        if (deferResponse) return new Promise((resolve, reject) => {
          pendingRequest = { signal, resolve, reject };
          signal.addEventListener('abort', () => reject(new UsageError('cancelled')), { once: true });
        });
        if (usageError) throw usageError;
        return usage;
      },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ activate } = require('../src/extension'));
} finally { Module._load = originalLoad; }

function fixture(t) {
  settings.clear(); logs.length = 0; reads = 0; requests = 0;
  resetRequests = 0; resetDetails = null; resetDetailsError = null;
  auth = { accessToken: 'fixture-token', accountId: 'fixture-account', fingerprint: 'fixture-a' };
  authError = usageError = pendingRequest = null;
  deferResponse = false;
  usage = { rate_limit: {
    primary_window: { used_percent: 28, limit_window_seconds: 18000, reset_at: Date.now() / 1000 + 8000 },
    secondary_window: { used_percent: 95, limit_window_seconds: 604800, reset_at: Date.now() / 1000 + 100000 },
  } };
  const context = { subscriptions: [] };
  activate(context);
  t.after(() => context.subscriptions.forEach(d => d.dispose()));
  return context.subscriptions[0];
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('shows banked count and each expiry in order using a read-only detail request', async t => {
  const c = fixture(t);
  usage.rate_limit_reset_credits = { available_count: 3 };
  const first = Date.now() / 1000 + 86400;
  const second = first + 86400;
  resetDetails = { credits: [
    { status: 'available', expires_at: new Date(second * 1000).toISOString() },
    { status: 'redeemed', expires_at: first },
    { status: 'available', expires_at: first },
    { status: 'available', expires_at: first },
  ] };
  await settle();
  const format = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const firstDate = format.format(new Date(first * 1000));
  const secondDate = format.format(new Date(second * 1000));
  assert.ok(c.item.tooltip.value.includes(`**Banked resets**  **3**  \nExpires at ${firstDate} (2 resets)  \nExpires at ${secondDate}`));
  assert.equal(requests, 1);
  assert.equal(resetRequests, 1);
  assert.doesNotMatch(c.item.text, /Banked/);
  await commands.get('codexLimits.refresh')();
  auth.fingerprint = 'different-account';
  usageError = new UsageError('network');
  await commands.get('codexLimits.refresh')();
  assert.doesNotMatch(c.item.tooltip.value, /Banked resets|Expires at/);
});

test('keeps quotas and banked count when details fail, respecting detail Retry-After', async t => {
  const c = fixture(t);
  usage.rate_limit_reset_credits = { available_count: 2 };
  resetDetailsError = new UsageError('rate-limited', 300000);
  await settle();
  assert.match(c.item.tooltip.value, /\*\*Banked resets\*\*  \*\*2\*\*  \nExpiry unavailable/);
  assert.match(c.item.text, /72%/);
  assert.doesNotMatch(c.item.text, /stale/);
  await commands.get('codexLimits.refresh')();
  assert.equal(resetRequests, 1);
  assert.equal(requests, 2);
});

test('does not invent banked count or request expiry details when none are available', async t => {
  const c = fixture(t); await settle();
  assert.match(c.item.tooltip.value, /\*\*Banked resets\*\*  \*\*—\*\*/);
  usage.rate_limit_reset_credits = { available_count: 0 };
  await commands.get('codexLimits.refresh')();
  assert.match(c.item.tooltip.value, /\*\*Banked resets\*\*  \*\*0\*\*/);
  assert.doesNotMatch(c.item.tooltip.value, /Expiry|Expires/);
  assert.equal(resetRequests, 0);
});

test('shows remaining quota, countdowns and warning tooltip', async t => {
  const c = fixture(t); await settle();
  assert.equal(c.item.visible, true);
  assert.match(c.item.text, /^[0-9]+h [0-9]+m • 72% \|/);
  assert.match(c.item.text, /\| [0-9]+d [0-9]+h • 5%$/);
  assert.equal(c.item.backgroundColor.id, 'statusBarItem.warningBackground');
  assert.match(c.item.tooltip.value, /\*\*5h\*\*  \*\*72% left\*\*  \nunder usage  \nReset at [^\n]+\d{2}:\d{2}[^\n]*\n\n/);
  assert.match(c.item.tooltip.value, /\*\*Weekly\*\*  \*\*5% left\*\*  \nover usage  \nReset at [^\n]+\d{2}:\d{2}[^\n]*\n\n/);
  assert.equal(requests, 1);
});

test('network failure flags stale data and logs no raw errors', async t => {
  const c = fixture(t); await settle();
  usageError = new Error('secret-fixture-token-error');
  await commands.get('codexLimits.refresh')();
  assert.match(c.item.text, /• 72%/);
  assert.match(c.item.text, /stale/);
  assert.match(c.item.tooltip.value, /Last reading is stale/);
  assert.ok(logs.every(line => !line.includes('secret-fixture')));
  usageError = null;
  await commands.get('codexLimits.refresh')();
  assert.doesNotMatch(c.item.text, /stale/);
});

test('missing credentials and API-key mode clear previous quota without HTTP calls', async t => {
  const c = fixture(t); await settle();
  authError = new UsageError('missing-auth');
  await c.refresh(true);
  assert.equal(c.limits, null);
  assert.equal(requests, 1);
  assert.match(c.item.tooltip.value, /auth.json/);
  authError = new UsageError('api-key');
  await c.refresh(true);
  assert.match(c.item.tooltip.value, /API-key/);
});

test('expired token waits for Codex; a renewed token is reread on the next refresh', async t => {
  const c = fixture(t); await settle();
  usageError = new UsageError('expired-token');
  await c.refresh(true);
  assert.equal(c.limits, null);
  assert.match(c.item.tooltip.value, /never refreshes tokens/);
  auth = { ...auth, accessToken: 'renewed-fixture-token', fingerprint: 'fixture-b' };
  usageError = null;
  await c.refresh(true);
  assert.match(c.item.text, /• 72%/);
  assert.equal(reads, 3);
});

test('changed account never displays previous account quota after a failed fetch', async t => {
  const c = fixture(t); await settle();
  auth = { ...auth, accountId: 'other-fixture-account', fingerprint: 'other-fixture' };
  usageError = new UsageError('network');
  await c.refresh(true);
  assert.equal(c.limits, null);
  assert.doesNotMatch(c.item.text, /72%/);
});

test('focus and automatic refreshes are throttled; 429 also throttles manual refresh', async t => {
  const c = fixture(t); await settle();
  await c.refresh(); await c.refresh();
  assert.equal(requests, 1);
  usageError = new UsageError('rate-limited', 300000);
  await c.refresh(true);
  const count = requests;
  await c.refresh(true); await c.refresh();
  assert.equal(requests, count);
  assert.ok(c.rateLimitedUntil >= Date.now() + 290000);
});

test('polling defaults to 60 seconds and respects a changed interval immediately', async t => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const c = fixture(t); await settle();
  assert.equal(c.interval, 60);
  now += 59999;
  await c.refresh();
  assert.equal(requests, 1);
  now += 1;
  await c.refresh();
  assert.equal(requests, 2);
  settings.set('codexLimits.refreshIntervalSeconds', 120);
  configListener({ affectsConfiguration: key => key === 'codexLimits' });
  await settle();
  assert.equal(c.interval, 120);
  assert.equal(requests, 3);
  now += 119999;
  await c.refresh();
  assert.equal(requests, 3);
  now += 1;
  await c.refresh();
  assert.equal(requests, 4);
});

test('configuration updates weekly display without any backend process', async t => {
  const c = fixture(t); await settle();
  settings.set('codexLimits.showWeeklyReset', false);
  configListener({ affectsConfiguration: key => key === 'codexLimits' });
  await settle();
  assert.equal(c.item.text.split('|')[1].trim(), '5%');
});

test('refreshes cannot overlap and unload cancels the HTTP request', async t => {
  const c = fixture(t); await settle();
  deferResponse = true;
  const refresh = c.refresh(true);
  await settle();
  assert.equal(c.busy, true);
  await c.refresh(true);
  assert.equal(requests, 2);
  c.dispose();
  await refresh;
  assert.equal(pendingRequest.signal.aborted, true);
  assert.equal(c.item.visible, false);
});
