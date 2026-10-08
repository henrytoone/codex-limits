'use strict';
const { readAuth, fetchUsage } = require('../src/usage');
const { parseLimits, statusText } = require('../src/limits');

// One read-only credential read and one HTTPS GET. No Codex processes or token renewal.
async function main() {
  const auth = await readAuth();
  const limits = parseLimits(await fetchUsage(auth));
  console.log(statusText(limits, Date.now(), true));
}
main().catch(() => { console.error('Live usage check failed. Check your saved Codex ChatGPT sign-in and network access.'); process.exitCode = 1; });
