'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { validateHeaderValue } = require('node:http');
const { createHash } = require('node:crypto');
const { isObject } = require('./limits');

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const MAX_BYTES = 1024 * 1024;

class UsageError extends Error {
  /** @param {string} code @param {number} [retryAfterMs] */
  constructor(code, retryAfterMs = 0) { super(code); this.retryAfterMs = retryAfterMs; }
}

/** @typedef {{accessToken: string, accountId: string|null, fingerprint: string}} Auth */

/** Read the existing file without locks, token renewal or writes.
 * @param {string} [codexHome] @returns {Promise<Auth>} */
async function readAuth(codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  if (!path.isAbsolute(codexHome)) throw new UsageError('absolute-home');
  let file;
  try {
    file = await fs.open(path.join(codexHome, 'auth.json'), 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new UsageError('invalid-auth');
    const raw = JSON.parse(await file.readFile('utf8'));
    if (!isObject(raw)) throw new UsageError('invalid-auth');
    if (raw.auth_mode === 'apikey' || (!isObject(raw.tokens) && raw.OPENAI_API_KEY)) throw new UsageError('api-key');
    if (!isObject(raw.tokens) || typeof raw.tokens.access_token !== 'string' || !raw.tokens.access_token.trim()) throw new UsageError('missing-token');
    const accessToken = raw.tokens.access_token;
    const accountId = typeof raw.tokens.account_id === 'string' && raw.tokens.account_id ? raw.tokens.account_id : null;
    if (/\s/.test(accessToken)) throw new UsageError('invalid-auth');
    validateHeaderValue('Authorization', `Bearer ${accessToken}`);
    if (accountId) validateHeaderValue('chatgpt-account-id', accountId);
    // Retain only a hash to detect changed credentials, never the token itself.
    const fingerprint = createHash('sha256').update(JSON.stringify([accountId, accessToken])).digest('hex');
    return { accessToken, accountId, fingerprint };
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (isObject(error) && error.code === 'ENOENT') throw new UsageError('missing-auth');
    if (isObject(error) && ['EACCES', 'EPERM'].includes(error.code)) throw new UsageError('unreadable-auth');
    throw new UsageError('invalid-auth');
  } finally { await file?.close(); }
}

/** @param {string|string[]|undefined} header @param {number} now */
function retryAfter(header, now) {
  if (typeof header !== 'string') return 60000;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.max(60000, Math.min(86400000, ms)) : 60000;
}

/** One HTTPS GET to a fixed host. Node HTTPS does not follow redirects.
 * @param {Auth} auth @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
 * @returns {Promise<unknown>} */
function fetchUsage(auth, options = {}) {
  return fetchJson(USAGE_URL, auth, options);
}

/** Read earned-reset details without redeeming credits.
 * @param {Auth} auth @param {{signal?: AbortSignal, timeoutMs?: number}} [options] */
function fetchResetCredits(auth, options = {}) {
  return fetchJson(RESET_CREDITS_URL, auth, options);
}

/** @param {string} url @param {Auth} auth
 * @param {{signal?: AbortSignal, timeoutMs?: number}} options @returns {Promise<unknown>} */
function fetchJson(url, auth, options) {
  return new Promise((resolve, reject) => {
    /** @type {NodeJS.Timeout|undefined} */
    let timeout;
    let settled = false;
    /** @param {Error|null} error @param {unknown} [value] */
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (error) reject(error); else resolve(value);
    };
    try {
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
        ...(auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {}),
      };
      const request = https.request(url, { method: 'GET', headers, signal: options.signal }, response => {
        response.on('error', () => finish(new UsageError('network')));
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          const code = status === 401 ? 'expired-token' : status === 403 ? 'forbidden' : status === 429 ? 'rate-limited' : status >= 300 && status < 400 ? 'redirect' : 'http-error';
          finish(new UsageError(code, status === 429 ? retryAfter(response.headers['retry-after'], Date.now()) : 0));
          response.destroy();
          return;
        }
        /** @type {Buffer[]} */
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            finish(new UsageError('invalid-response'));
            response.destroy();
          } else chunks.push(chunk);
        });
        response.on('end', () => {
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(new UsageError('invalid-response')); }
        });
      });
      request.on('error', () => finish(new UsageError(options.signal?.aborted ? 'cancelled' : 'network')));
      timeout = setTimeout(() => {
        finish(new UsageError('request-timeout'));
        request.destroy();
      }, options.timeoutMs ?? 15000);
      request.end();
    } catch { finish(new UsageError('network')); }
  });
}

module.exports = { readAuth, fetchUsage, fetchResetCredits, UsageError, retryAfter };
