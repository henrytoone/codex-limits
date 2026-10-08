# Codex Limits

See your Codex ChatGPT plan usage in VS Code's bottom status bar:

```text
2h 45m • 61% | 5d 16h • 88%
```

The five-hour window comes first and the weekly window second. Each shows time until reset, then the percentage **remaining**. Hover for two spaced blocks showing remaining percentage, local reset date/time with timezone labels and pace for each window. Labels and percentages are bold in the tooltip, with pace on its own line between the remaining percentage and reset time. Click to refresh immediately. The bar highlights when either quota has 10% or less remaining. VS Code's supported status bar API does not provide bold text formatting.

The tooltip also shows pace separately for each window. The elapsed percentage is calculated from the reset time and window duration. Usage within **10 percentage points** of elapsed time, including the boundaries, is **on track**. Below that band is **under usage**; above it is **over usage**. For example, halfway through a window, 40–60% used is on track. Pace labels use shades chosen for dark backgrounds: blue for **on track**, green for **under usage**, and yellow for **over usage**. Pace updates with the countdown timer and is unavailable when the reset time is missing or already due.

A separate **Banked resets** block shows the available reset count and local expiry dates with timezone labels, grouping resets that expire together. Missing counts display `—`; missing dates display **Expiry unavailable**. Expiry lines show the timestamp directly. Timezone labels follow the local timezone and daylight saving at each reset or expiry date. Expiries are read from the service, never guessed from grant times.

## Install

1. Install the official **Codex – OpenAI's coding agent** extension (`openai.chatgpt`) and sign in with ChatGPT.
2. In VS Code, run **Extensions: Install from VSIX…** from the Command Palette and select `codex-limits-0.2.9.vsix` from this folder. This upgrades earlier versions if already installed.
3. Reload the VS Code window if prompted. The status bar appears automatically.

The package is for local installation; it has not been published to the Marketplace.

## How it connects

Codex Limits reads the access token and optional account ID from Codex's existing `auth.json` and makes an HTTPS GET to `https://chatgpt.com/backend-api/wham/usage`. It rereads the file on every refresh so tokens renewed by Codex are picked up automatically. It never starts a Codex process, refreshes tokens, acquires credential locks, writes to Codex files, changes the official extension, or makes model requests. When banked resets are available, it also makes a read-only GET to `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` for their expiry details. It never redeems a reset. Detail failures keep the usage readings and reset count, with a separate retry cooldown honoring Retry-After. No runtime dependencies are required.

The request uses the saved token in the Authorization header and the account ID when available. Requests go to a fixed ChatGPT endpoint with normal TLS verification; redirects are rejected. Credentials, response bodies and raw network errors are never logged. The refresh token is not used. This HTTP approach is also used by [codex-stats](https://github.com/Maol-1997/codex-stats/blob/main/src/codex-client.ts). The endpoint is an internal ChatGPT endpoint and can change.

The top-level Codex quota is read from `rate_limit.primary_window` and `secondary_window`; additional model-specific quotas are ignored. Five-hour and weekly windows are identified by their durations (18,000 and 604,800 seconds), with positional fallback for missing durations. Absolute `reset_at` timestamps are preferred; `reset_after_seconds` is supported as a fallback.

Usage refreshes approximately once a minute by default. A 15-second timer updates countdowns and checks whether another usage request is due. Window focus refreshes respect the same interval; clicking refresh bypasses the normal interval. Requests never overlap, have a 15-second total timeout and a bounded response size, and are cancelled on unload or configuration changes. Failures back off automatically, up to 15 minutes. HTTP 429 responses honor Retry-After with a minimum one-minute cooldown; manual refresh also respects that cooldown.

At a reset the bar waits for a fresh response rather than assuming 100% is available. Temporary network failures retain the last readings with a **stale** marker. Missing, invalid or rejected credentials, API-key mode and changes to the saved token/account clear old readings. If the token expires, use Codex normally or sign in through Codex, then refresh. This extension does not renew it. No credentials or readings are persisted by this extension.

The credential directory is `codexLimits.codexHome`, then `CODEX_HOME`, then `~/.codex`. This version requires existing **file-based credentials**. Codex can also store credentials in the OS keychain or only in memory; those storage modes are not accessed or changed. See [OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth). The extension works independently of the official extension once file-based credentials exist.

The extension runs locally, including in Remote SSH windows. If your Codex account is on a remote host or in WSL, its credentials may differ. You can point `codexLimits.codexHome` to an already accessible credential directory. It uses a direct HTTPS connection; custom proxy configuration is not included. Live HTTP usage retrieval has been verified on macOS.

## Settings and commands

| Setting | Default | Purpose |
| --- | --- | --- |
| `codexLimits.refreshIntervalSeconds` | `60` | Usage polling interval, between 30 and 3,600 seconds |
| `codexLimits.showWeeklyReset` | `true` | Show the weekly countdown in the bar |
| `codexLimits.warningThresholdPercent` | `10` | Highlight low remaining quota |
| `codexLimits.codexHome` | empty | Absolute directory containing Codex auth.json |

Commands: **Codex Limits: Refresh Usage**, **Codex Limits: Open Codex**, and **Codex Limits: Show Diagnostics**.

Find **Codex Limits: Refresh Interval Seconds** in VS Code Settings, or set it in your user `settings.json`:

```json
"codexLimits.refreshIntervalSeconds": 60
```

Changes apply immediately. The polling scheduler checks every 15 seconds, so actual refreshes can occur up to 15 seconds after the configured interval. Request backoff and rate-limit cooldowns still apply.

API-key accounts do not have ChatGPT subscription quotas. Missing quota windows display `—`; missing reset timestamps display `?`. Error details appear on hover, and diagnostics are available in the **Codex Limits** output channel.

## Develop

Requires Node.js 22+ for development tooling.

```sh
npm ci
npm run check
npm test
npm run package
```

Press **F5** in this folder to launch an Extension Development Host with Codex Limits loaded. To check the real endpoint separately using the saved ChatGPT login:

```sh
npm run verify:live
```

The live check reads the saved credential file and sends one usage GET. The 35 tests exercise read-only credential access, token changes, fixed request destination, redirect rejection, HTTP errors, backoff, timeouts, cancellation, quota parsing, pace boundaries, configurable polling, banked reset expiry parsing, detail request cooldowns and status bar behavior using temporary credential fixtures and a mocked HTTPS transport.
