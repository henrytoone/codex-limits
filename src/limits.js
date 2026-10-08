'use strict';

/** @typedef {{usedPercent: number, windowDurationMins: number|null, resetsAt: number|null}} Window */
/** @typedef {{availableCount: number|null, expiries: (number|null)[]}} BankedResets */
/** @typedef {{fiveHour: Window|null, weekly: Window|null, bankedResets: BankedResets}} Limits */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {number|null} */
function finiteNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {unknown} value @param {number} now @returns {Window|null} */
function parseWindow(value, now) {
  if (!isObject(value)) return null;
  const used = finiteNumber(value.used_percent);
  if (used === null) return null;
  const duration = finiteNumber(value.limit_window_seconds);
  const absolute = finiteNumber(value.reset_at);
  const relative = finiteNumber(value.reset_after_seconds);
  const reset = absolute ?? (relative !== null && relative >= 0 ? now / 1000 + relative : null);
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    windowDurationMins: duration === null ? null : duration / 60,
    resetsAt: reset !== null && reset > 0 && reset < 8640000000000 ? reset : null,
  };
}

/** Read only the top-level Codex quota, ignoring additional model-specific limits.
 * @param {unknown} result @param {number} [now] @returns {Limits} */
function parseLimits(result, now = Date.now()) {
  if (!isObject(result) || !isObject(result.rate_limit)) throw new Error('invalid-limits');
  const primary = parseWindow(result.rate_limit.primary_window, now);
  const secondary = parseWindow(result.rate_limit.secondary_window, now);
  const windows = [primary, secondary];
  const fiveHour = windows.find(w => w?.windowDurationMins === 300) ?? (primary?.windowDurationMins === null ? primary : null);
  const weekly = windows.find(w => w?.windowDurationMins === 10080) ?? (secondary?.windowDurationMins === null ? secondary : null);
  if (!fiveHour && !weekly) throw new Error('no-windows');
  return { fiveHour, weekly, bankedResets: parseBankedResets(result) };
}

/** Counts are authoritative; never infer missing expiry dates from grant times.
 * @param {unknown} result @param {unknown} [details] @returns {BankedResets} */
function parseBankedResets(result, details) {
  const summary = isObject(result) ? result.rate_limit_reset_credits : null;
  const count = isObject(summary) ? finiteNumber(summary.available_count) : null;
  const availableCount = count !== null && Number.isSafeInteger(count) && count >= 0 ? count : null;
  const expiries = isObject(details) && Array.isArray(details.credits) ? details.credits
    .filter(credit => isObject(credit) && credit.status === 'available')
    .map(credit => {
      const raw = credit.expires_at;
      const numeric = finiteNumber(raw);
      const seconds = numeric ?? (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(raw) ? Date.parse(raw) / 1000 : NaN);
      return Number.isFinite(seconds) && seconds > 0 && seconds < 8640000000000 ? seconds : null;
    }) : [];
  return { availableCount, expiries };
}

/** @param {Window} window */
function remaining(window) { return 100 - window.usedPercent; }

/** Compare quota spent against elapsed time, with inclusive configurable bounds.
 * @param {Window} window @param {number} now @param {number} fallbackDurationMins
 * @param {number} [underThreshold] @param {number} [overThreshold]
 * @returns {{label: 'under usage'|'on track'|'over usage', elapsedPercent: number}|null} */
function usagePace(window, now, fallbackDurationMins, underThreshold = 10, overThreshold = 10) {
  const durationMs = (window.windowDurationMins ?? fallbackDurationMins) * 60000;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || window.resetsAt === null) return null;
  const resetMs = window.resetsAt * 1000;
  if (!Number.isFinite(resetMs) || resetMs <= now) return null;
  const elapsedPercent = Math.min(100, Math.max(0, (now - (resetMs - durationMs)) / durationMs * 100));
  const difference = window.usedPercent - elapsedPercent;
  const under = Number.isFinite(underThreshold) ? Math.min(100, Math.max(0, underThreshold)) : 10;
  const over = Number.isFinite(overThreshold) ? Math.min(100, Math.max(0, overThreshold)) : 10;
  const label = difference < -under - 1e-9 ? 'under usage' : difference > over + 1e-9 ? 'over usage' : 'on track';
  return { label, elapsedPercent };
}

/** @param {number|null} resetsAt @param {number} now */
function countdown(resetsAt, now) {
  if (resetsAt === null) return '?';
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return 'reset due';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Avoid rounding a small nonzero balance to zero (or a used quota to 100%). @param {number} percent */
function percentage(percent) {
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.floor(percent)}%`;
}

/** @param {Limits} limits @param {number} now @param {boolean} showWeeklyReset */
function statusText(limits, now, showWeeklyReset) {
  /** @param {Window|null} window @param {boolean} reset */
  const part = (window, reset) => {
    if (!window) return '—';
    const due = window.resetsAt !== null && window.resetsAt * 1000 <= now;
    const balance = due ? '—' : percentage(remaining(window));
    return reset ? `${countdown(window.resetsAt, now)} • ${balance}` : balance;
  };
  return `${part(limits.fiveHour, true)} | ${part(limits.weekly, showWeeklyReset)}`;
}

module.exports = { isObject, parseLimits, parseBankedResets, countdown, remaining, statusText, usagePace };
