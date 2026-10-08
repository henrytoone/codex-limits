'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLimits, parseBankedResets, countdown, statusText, usagePace } = require('../src/limits');

const now = Date.UTC(2026, 9, 8, 15, 0);
const window = (usedPercent, duration, minutes) => ({ used_percent: usedPercent, limit_window_seconds: duration * 60, reset_at: now / 1000 + minutes * 60 });

test('banked reset count stays authoritative with incomplete or malformed expiry details', () => {
  const result = { rate_limit_reset_credits: { available_count: 4 } };
  assert.deepEqual(parseBankedResets(result), { availableCount: 4, expiries: [] });
  assert.deepEqual(parseBankedResets(result, { credits: [
    { status: 'available', expires_at: '2026-10-22T20:10:56.493231Z' },
    { status: 'available', expires_at: now / 1000 },
    { status: 'available', expires_at: null },
    { status: 'available', expires_at: 'invalid', granted_at: now / 1000 },
    { status: 'redeemed', expires_at: now / 1000 }, null,
  ] }), { availableCount: 4, expiries: [Date.parse('2026-10-22T20:10:56.493231Z') / 1000, now / 1000, null, null] });
});

test('unknown and invalid banked counts never turn into zero or inferred counts', () => {
  for (const count of [undefined, null, -1, 1.5, Infinity, 'invalid', true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseBankedResets({ rate_limit_reset_credits: { available_count: count } }).availableCount, null);
  }
  assert.equal(parseBankedResets(null).availableCount, null);
  assert.equal(parseBankedResets({ rate_limit_reset_credits: { available_count: '0' } }).availableCount, 0);
});

test('five-hour pace uses an inclusive 10-percentage-point on-track band', () => {
  for (const [usedPercent, expected] of [[39.9, 'under usage'], [40, 'on track'], [50, 'on track'], [60, 'on track'], [60.1, 'over usage']]) {
    const pace = usagePace({ usedPercent, windowDurationMins: 300, resetsAt: now / 1000 + 150 * 60 }, now, 300);
    assert.equal(pace.elapsedPercent, 50);
    assert.equal(pace.label, expected);
  }
});

test('weekly pace uses elapsed time across the whole week and advances with time', () => {
  const w = { usedPercent: 40, windowDurationMins: 10080, resetsAt: now / 1000 + 7560 * 60 };
  assert.deepEqual(usagePace(w, now, 10080), { label: 'over usage', elapsedPercent: 25 });
  assert.deepEqual(usagePace(w, now + 1512 * 60000, 10080), { label: 'on track', elapsedPercent: 40 });
  const later = usagePace(w, now + 3024 * 60000, 10080);
  assert.equal(later.label, 'under usage');
  assert.ok(Math.abs(later.elapsedPercent - 55) < 1e-9);
});

test('custom asymmetric pace thresholds include both boundaries for either window', () => {
  for (const duration of [300, 10080]) {
    for (const [usedPercent, expected] of [[34.9, 'under usage'], [35, 'on track'], [50, 'on track'], [55, 'on track'], [55.1, 'over usage']]) {
      const w = { usedPercent, windowDurationMins: duration, resetsAt: now / 1000 + duration * 30 };
      assert.equal(usagePace(w, now, duration, 15, 5).label, expected);
    }
  }
});

test('pace thresholds accept zero and fractions and handle invalid values safely', () => {
  const w = { usedPercent: 50, windowDurationMins: 300, resetsAt: now / 1000 + 150 * 60 };
  assert.equal(usagePace(w, now, 300, 0, 0).label, 'on track');
  assert.equal(usagePace({ ...w, usedPercent: 49.9 }, now, 300, 0, 0).label, 'under usage');
  assert.equal(usagePace({ ...w, usedPercent: 50.1 }, now, 300, 0, 0).label, 'over usage');
  assert.equal(usagePace({ ...w, usedPercent: 50.5 }, now, 300, 0.5, 0.5).label, 'on track');
  assert.equal(usagePace({ ...w, usedPercent: 40 }, now, 300, NaN, Infinity).label, 'on track');
  assert.equal(usagePace({ ...w, usedPercent: 49 }, now, 300, -5, -5).label, 'under usage');
});

test('pace handles missing metadata and never classifies a reset that is due', () => {
  const w = { usedPercent: 20, windowDurationMins: null, resetsAt: now / 1000 + 150 * 60 };
  assert.deepEqual(usagePace(w, now, 300), { label: 'under usage', elapsedPercent: 50 });
  assert.equal(usagePace({ ...w, resetsAt: null }, now, 300), null);
  assert.equal(usagePace({ ...w, resetsAt: now / 1000 }, now, 300), null);
  assert.equal(usagePace({ ...w, resetsAt: now / 1000 - 1 }, now, 300), null);
  assert.equal(usagePace({ ...w, windowDurationMins: 0 }, now, 300), null);
  assert.equal(usagePace({ ...w, resetsAt: now / 1000 + 400 * 60 }, now, 300).elapsedPercent, 0);
});

test('renders remaining quota and both reset countdowns', () => {
  const limits = parseLimits({ rate_limit: { primary_window: window(28, 300, 134), secondary_window: window(16, 10080, 6120) } });
  assert.equal(statusText(limits, now, true), '2h 14m • 72% | 4d 6h • 84%');
  assert.equal(statusText(limits, now, false), '2h 14m • 72% | 84%');
});

test('ignores additional model-specific quota buckets', () => {
  const limits = parseLimits({ rate_limit: { primary_window: window(20, 300, 100) }, additional_rate_limits: [{ rate_limit: { primary_window: window(99, 300, 10) } }] });
  assert.equal(limits.fiveHour.usedPercent, 20);
});

test('does not label a 15-minute window as five-hour quota', () => {
  const limits = parseLimits({ rate_limit: { primary_window: window(30, 15, 10), secondary_window: window(50, 10080, 100) } });
  assert.equal(limits.fiveHour, null);
  assert.match(statusText(limits, now, true), /^— \|/);
});

test('supports legacy missing duration, missing windows and reset timestamps', () => {
  const limits = parseLimits({ rate_limit: { primary_window: { used_percent: 10 } } });
  assert.equal(limits.weekly, null);
  assert.equal(limits.fiveHour.resetsAt, null);
  assert.equal(statusText(limits, now, true), '? • 90% | —');
  assert.throws(() => parseLimits({ rate_limit: { primary_window: { used_percent: 'invalid' } } }));
  assert.throws(() => parseLimits(null));
  assert.throws(() => parseLimits({ rate_limit: {} }));
});

test('expired windows never invent replenished quota', () => {
  const limits = parseLimits({ rate_limit: { primary_window: window(100, 300, -1), secondary_window: window(0, 10080, 30) } });
  assert.match(statusText(limits, now, true), /^reset due • — \|/);
  assert.equal(countdown(now / 1000, now), 'reset due');
  assert.equal(countdown(now / 1000 + 1, now), '1m');
  assert.equal(countdown(null, now), '?');
});

test('handles full, exhausted, fractional and out-of-range percentages', () => {
  const render = used => statusText(parseLimits({ rate_limit: { primary_window: window(used, 300, 30) } }), now, true);
  assert.match(render(0), /100%/);
  assert.match(render(100), /0%/);
  assert.match(render(99.7), /<1%/);
  assert.match(render(0.1), /99%/);
  assert.match(render(-2), /100%/);
  assert.match(render(105), /0%/);
});

test('supports relative reset times, numeric strings and authoritative absolute resets', () => {
  const limits = parseLimits({ rate_limit: { primary_window: { used_percent: '25', limit_window_seconds: '18000', reset_after_seconds: '120' } } }, now);
  assert.equal(limits.fiveHour.resetsAt, now / 1000 + 120);
  assert.match(statusText(limits, now, true), /75%/);
  const absolute = parseLimits({ rate_limit: { primary_window: { used_percent: 25, reset_at: now / 1000 + 180, reset_after_seconds: 120 } } }, now);
  assert.equal(absolute.fiveHour.resetsAt, now / 1000 + 180);
});
