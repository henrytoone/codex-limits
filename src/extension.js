'use strict';
const vscode = require('vscode');
const { readAuth, fetchUsage, fetchResetCredits, UsageError } = require('./usage');
const { parseLimits, parseBankedResets, statusText, remaining, usagePace } = require('./limits');

const paceColors = {
  'on track': '#75beff',
  'under usage': '#89d185',
  'over usage': '#e5c07b',
};

const resetDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
});
const expiryDateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
});

class LimitsStatus {
  constructor() {
    this.item = vscode.window.createStatusBarItem('codexLimits.usage', vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Codex Limits';
    this.item.command = 'codexLimits.refresh';
    this.output = vscode.window.createOutputChannel('Codex Limits');
    /** @type {AbortController|null} */
    this.request = null;
    /** @type {import('./limits').Limits|null} */
    this.limits = null;
    this.updatedAt = 0;
    this.error = '';
    this.busy = false;
    this.disposed = false;
    this.generation = 0;
    this.fingerprint = '';
    this.failures = 0;
    this.interval = 60;
    this.nextRefreshAt = 0;
    this.rateLimitedUntil = 0;
    this.resetDetailsRetryAt = 0;
    this.tick = setInterval(() => { this.render(); void this.refresh(); }, 15000);
    this.configure();
    this.item.show();
  }

  configure() {
    this.generation++;
    this.request?.abort();
    this.limits = null;
    this.error = '';
    this.fingerprint = '';
    this.failures = 0;
    this.nextRefreshAt = 0;
    this.interval = Math.max(30, Math.min(3600, vscode.workspace.getConfiguration('codexLimits').get('refreshIntervalSeconds', 60)));
    this.render();
    // A cancelled in-flight refresh will restart with the new settings in finally.
    if (!this.busy) void this.refresh();
  }

  /** @param {boolean} [manual] */
  async refresh(manual = false) {
    if (this.busy || this.disposed) return;
    if (Date.now() < this.rateLimitedUntil || (!manual && Date.now() < this.nextRefreshAt)) return;
    this.busy = true;
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    this.nextRefreshAt = Date.now() + this.interval * 1000;
    this.render();
    try {
      const home = vscode.workspace.getConfiguration('codexLimits').get('codexHome', '').trim();
      const auth = await readAuth(home || undefined);
      if (generation !== this.generation || this.disposed) return;
      if (this.fingerprint !== auth.fingerprint) {
        this.limits = null;
        this.fingerprint = auth.fingerprint;
        this.render();
      }
      const result = await fetchUsage(auth, { signal: request.signal });
      const limits = parseLimits(result);
      if (generation !== this.generation || this.disposed) return;
      if (limits.bankedResets.availableCount && Date.now() >= this.resetDetailsRetryAt) {
        try {
          const details = await fetchResetCredits(auth, { signal: request.signal });
          limits.bankedResets = parseBankedResets(result, details);
        } catch (error) {
          if (error instanceof UsageError && ['expired-token', 'forbidden', 'cancelled'].includes(error.message)) throw error;
          this.resetDetailsRetryAt = Date.now() + Math.max(60000, error instanceof UsageError ? error.retryAfterMs : 0);
          this.output.appendLine('Banked reset expiry details unavailable.');
        }
      }
      if (generation !== this.generation || this.disposed) return;
      this.limits = limits;
      this.updatedAt = Date.now();
      this.error = '';
      this.failures = 0;
      this.output.appendLine(`Usage refreshed at ${new Date(this.updatedAt).toLocaleTimeString()}.`);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      const message = error instanceof Error ? error.message : '';
      if (['missing-auth', 'missing-token', 'unreadable-auth', 'invalid-auth', 'api-key', 'expired-token', 'forbidden'].includes(message)) this.limits = null;
      /** @type {Record<string, string>} */
      const errors = {
          'missing-auth': 'No Codex auth.json found. This version needs file-based ChatGPT credentials; it does not access the OS keychain.',
          'missing-token': 'No saved ChatGPT access token found. Sign in through Codex, then refresh.',
          'unreadable-auth': 'Codex auth.json is not readable. Check your local file permissions.',
          'invalid-auth': 'Codex auth.json could not be read as valid credentials. Try again after Codex finishes signing in.',
          'absolute-home': 'Set codexLimits.codexHome to an absolute directory path.',
          'api-key': 'ChatGPT plan limits are unavailable with API-key sign-in.',
          'expired-token': 'Saved token was rejected. Use Codex to renew your sign-in, then refresh. This extension never refreshes tokens.',
          'forbidden': 'ChatGPT denied access to usage. Check your Codex account and network.',
          'rate-limited': 'ChatGPT asked us to slow down. Automatic and manual refreshes will wait before retrying.',
          'redirect': 'ChatGPT redirected the usage request. Credentials were not forwarded.',
          'no-windows': 'This account did not return a five-hour or weekly quota window.',
          'invalid-limits': 'Codex returned an unrecognized quota response.',
          'invalid-response': 'ChatGPT returned an invalid usage response.',
          'request-timeout': 'ChatGPT took too long to respond. Click to retry.',
      };
      this.error = errors[message] || 'Could not fetch Codex usage. Click to retry; check your Codex sign-in and connection.';
      this.failures++;
      const delay = Math.max(this.interval * 1000, Math.min(900000, 60000 * 2 ** Math.min(this.failures - 1, 4)), error instanceof UsageError ? error.retryAfterMs : 0);
      this.nextRefreshAt = Date.now() + delay;
      if (message === 'rate-limited') this.rateLimitedUntil = this.nextRefreshAt;
      // Log only fixed diagnostics; never headers, auth contents or HTTP response bodies.
      this.output.appendLine(this.error);
    } finally {
      this.busy = false;
      this.request = null;
      if (!this.disposed) {
        this.render();
        if (generation !== this.generation) void this.refresh();
      }
    }
  }

  render() {
    if (this.disposed) return;
    const now = Date.now();
    const config = vscode.workspace.getConfiguration('codexLimits');
    const stale = !!this.error || now - this.updatedAt > Math.max(120000, (this.interval ?? 60) * 2000);
    const tooltip = new vscode.MarkdownString();
    tooltip.supportHtml = true;
    if (this.limits) {
      this.item.text = `${stale ? '$(warning) ' : ''}${statusText(this.limits, now, config.get('showWeeklyReset', true))}${stale ? ' (stale)' : ''}`;
      for (const [label, w, durationMins] of /** @type {[string, import('./limits').Window|null, number][]} */ ([['5h', this.limits.fiveHour, 300], ['Weekly', this.limits.weekly, 10080]])) {
        if (!w) { tooltip.appendMarkdown(`**${label}**  Unavailable\n\n`); continue; }
        const due = w.resetsAt !== null && w.resetsAt * 1000 <= now;
        const pace = usagePace(w, now, durationMins);
        const balance = due ? '—' : `${Number(remaining(w).toFixed(1))}%`;
        tooltip.appendMarkdown(`**${label}**  **${due ? '—' : `${balance} left`}**  \n`);
        tooltip.appendMarkdown(`${pace ? `<span style="color:${paceColors[pace.label]};">${pace.label}</span>` : '—'}  \n`);
        tooltip.appendMarkdown(`Reset at ${w.resetsAt === null ? '—' : resetDateFormat.format(new Date(w.resetsAt * 1000))}\n\n`);
      }
      const banked = this.limits.bankedResets;
      tooltip.appendMarkdown(`**Banked resets**  **${banked.availableCount ?? '—'}**`);
      if (banked.availableCount) {
        const dates = new Map();
        for (const expiry of banked.expiries.slice(0, banked.availableCount)) {
          if (expiry !== null && expiry * 1000 > now) dates.set(expiry, (dates.get(expiry) ?? 0) + 1);
        }
        let known = 0;
        for (const [expiry, count] of [...dates.entries()].sort(([a], [b]) => a - b)) {
          known += count;
          tooltip.appendMarkdown(`  \n${expiryDateFormat.format(new Date(expiry * 1000))}${count > 1 ? ` (${count} resets)` : ''}`);
        }
        if (known < banked.availableCount) tooltip.appendMarkdown(`  \n${known ? 'Other expiries unavailable' : 'Expiry unavailable'}`);
      }
      tooltip.appendMarkdown('\n\n');
      if (stale) tooltip.appendMarkdown('\nLast reading is stale.\n');
      const low = [this.limits.fiveHour, this.limits.weekly].some(w => w && (w.resetsAt === null || w.resetsAt * 1000 > now) && remaining(w) <= config.get('warningThresholdPercent', 10));
      this.item.backgroundColor = low ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    } else {
      this.item.text = this.busy ? '$(sync~spin) Codex limits' : '$(warning) Codex limits unavailable';
      this.item.backgroundColor = undefined;
      if (!this.error) tooltip.appendText(this.busy ? 'Refreshing usage…' : 'Usage unavailable.');
    }
    if (this.error) { tooltip.appendMarkdown('\n\n'); tooltip.appendText(this.error); }
    this.item.tooltip = tooltip;
    this.item.accessibilityInformation = { label: this.item.text.replace(/\$\([^)]*\)/g, '') };
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    clearInterval(this.tick);
    this.request?.abort();
    this.item.dispose();
    this.output.dispose();
  }
}

/** @param {import('vscode').ExtensionContext} context */
function activate(context) {
  const status = new LimitsStatus();
  context.subscriptions.push(status,
    vscode.commands.registerCommand('codexLimits.refresh', () => status.refresh(true)),
    vscode.commands.registerCommand('codexLimits.openCodex', () => vscode.commands.executeCommand('chatgpt.openSidebar')),
    vscode.commands.registerCommand('codexLimits.showOutput', () => status.output.show()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('codexLimits')) status.configure();
    }),
    vscode.window.onDidChangeWindowState(state => { if (state.focused) void status.refresh(); }),
  );
}

module.exports = { activate };
