'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { readAuth, fetchUsage, fetchResetCredits, UsageError, retryAfter } = require('../src/usage');

async function authFixture(t, content) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-limits-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  if (content !== undefined) await fs.writeFile(path.join(home, 'auth.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return home;
}
const tokens = access => ({ tokens: { access_token: access, account_id: 'fixture-account', refresh_token: 'must-not-be-used' } });

test('reads auth file without altering contents or modification time, and rereads new tokens', async t => {
  const home = await authFixture(t, tokens('fixture-first'));
  const filename = path.join(home, 'auth.json');
  const before = await fs.stat(filename);
  const content = await fs.readFile(filename);
  const auth = await readAuth(home);
  assert.equal(auth.accessToken, 'fixture-first');
  assert.equal(auth.accountId, 'fixture-account');
  assert.equal(auth.refreshToken, undefined);
  assert.equal(auth.idToken, undefined);
  assert.deepEqual(await fs.readFile(filename), content);
  assert.equal((await fs.stat(filename)).mtimeMs, before.mtimeMs);
  await fs.writeFile(filename, JSON.stringify(tokens('fixture-renewed')));
  const renewed = await readAuth(home);
  assert.equal(renewed.accessToken, 'fixture-renewed');
  assert.notEqual(renewed.fingerprint, auth.fingerprint);
});

test('missing, malformed, API-key and unsafe credentials fail without exposing secrets', async t => {
  for (const [content, code] of [
    [undefined, 'missing-auth'], ['{broken fixture-secret', 'invalid-auth'],
    [{ OPENAI_API_KEY: 'fixture-secret' }, 'api-key'], [{ tokens: {} }, 'missing-token'],
    [tokens('fixture-secret\r\ninjected-header'), 'invalid-auth'],
  ]) {
    const home = await authFixture(t, content);
    await assert.rejects(readAuth(home), error => error instanceof UsageError && error.message === code && !error.message.includes('fixture-secret'));
  }
  await assert.rejects(readAuth('relative-home'), /absolute-home/);
});

const auth = { accessToken: 'fixture-access', accountId: 'fixture-account', fingerprint: 'fixture' };
function transport(t, scenario) {
  const original = https.request;
  const calls = [];
  https.request = (url, options, callback) => {
    const request = new EventEmitter();
    const response = new EventEmitter();
    response.statusCode = 200; response.headers = {};
    response.destroy = () => { response.destroyed = true; };
    request.destroy = () => { request.destroyed = true; };
    request.end = () => setImmediate(() => {
      if (!request.destroyed) scenario({ request, response, callback });
    });
    const abort = () => { request.destroy(); request.emit('error', new Error('fixture-aborted')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    t.after(() => options.signal?.removeEventListener('abort', abort));
    calls.push({ url, options, request });
    return request;
  };
  t.after(() => { https.request = original; });
  return calls;
}

test('makes one GET to the fixed HTTPS host with saved token and account header', async t => {
  const calls = transport(t, ({ response, callback }) => {
    callback(response);
    response.emit('data', Buffer.from('{"rate_limit":'));
    response.emit('data', Buffer.from('{"primary_window":{"used_percent":25}}}'));
    response.emit('end');
  });
  const result = await fetchUsage(auth);
  assert.equal(result.rate_limit.primary_window.used_percent, 25);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-access');
  assert.equal(calls[0].options.headers['chatgpt-account-id'], 'fixture-account');
});

test('reset details use only GET at the fixed detail endpoint and reject redirects', async t => {
  const calls = transport(t, ({ response, callback }) => { response.statusCode = 302; callback(response); });
  await assert.rejects(fetchResetCredits(auth), /redirect/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-access');
});

test('redirects are rejected without sending credentials to another host', async t => {
  const calls = transport(t, ({ response, callback }) => {
    response.statusCode = 302;
    response.headers.location = 'https://different-host.invalid/';
    callback(response);
  });
  await assert.rejects(fetchUsage(auth), /redirect/);
  assert.equal(calls.length, 1);
});

test('401 never initiates token refresh or retries', async t => {
  const calls = transport(t, ({ response, callback }) => { response.statusCode = 401; callback(response); });
  await assert.rejects(fetchUsage(auth), /expired-token/);
  assert.equal(calls.length, 1);
});

test('429 respects Retry-After', async t => {
  transport(t, ({ response, callback }) => { response.statusCode = 429; response.headers['retry-after'] = '300'; callback(response); });
  await assert.rejects(fetchUsage(auth), error => error.message === 'rate-limited' && error.retryAfterMs === 300000);
  const now = Date.UTC(2026, 9, 8);
  assert.equal(retryAfter(new Date(now + 180000).toUTCString(), now), 180000);
  assert.equal(retryAfter('invalid', now), 60000);
});

test('malformed and oversized responses are rejected', async t => {
  transport(t, ({ response, callback }) => { callback(response); response.emit('data', Buffer.from('invalid fixture-body')); response.emit('end'); });
  await assert.rejects(fetchUsage(auth), /invalid-response/);
});

test('response size is bounded', async t => {
  transport(t, ({ response, callback }) => { callback(response); response.emit('data', Buffer.alloc(1024 * 1024 + 1)); });
  await assert.rejects(fetchUsage(auth), /invalid-response/);
});

test('timeout terminates an unresponsive request', async t => {
  const calls = transport(t, () => {});
  await assert.rejects(fetchUsage(auth, { timeoutMs: 20 }), /request-timeout/);
  assert.equal(calls[0].request.destroyed, true);
});

test('cancellation terminates the request and returns a fixed error', async t => {
  const calls = transport(t, () => {});
  const controller = new AbortController();
  const pending = fetchUsage(auth, { signal: controller.signal });
  const rejected = assert.rejects(pending, /cancelled/);
  controller.abort();
  await rejected;
  assert.equal(calls[0].request.destroyed, true);
});
