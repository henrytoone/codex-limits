# Codex Limits

See your Codex ChatGPT plan usage in VS Code's bottom status bar:

```text
2h 45m • 61% | 5d 16h • 88%
```

The five-hour window comes first and the weekly window second. Each shows time until reset, then the percentage **remaining**. Hover for two spaced blocks showing remaining percentage, local reset date/time with timezone labels and pace for each window. Labels and percentages are bold in the tooltip, with pace on its own line between the remaining percentage and reset time. Click to refresh immediately. The bar highlights when either quota has 10% or less remaining. VS Code's supported status bar API does not provide bold text formatting.

The tooltip also shows pace separately for each window. The elapsed percentage is calculated from the reset time and window duration. By default, usage within **10 percentage points** of elapsed time, including the boundaries, is **on track**. Below that band is **under usage**; above it is **over usage**. You can configure the below/above thresholds separately, from 0 to 100 percentage points, including fractions. Both settings apply to five-hour and weekly usage. For example, with an under threshold of 15 and an over threshold of 5, halfway through a window 35–55% used is on track. Threshold changes update the tooltip immediately without an HTTP request. Pace labels use shades chosen for dark backgrounds: blue for **on track**, green for **under usage**, and yellow for **over usage**. Pace updates with the countdown timer and is unavailable when the reset time is missing or already due.

A separate **Banked resets** block shows the available reset count and local expiry dates with timezone labels, grouping resets that expire together. Missing counts display `—`; missing dates display **Expiry unavailable**. Expiry lines show the timestamp directly. Timezone labels follow the local timezone and daylight saving at each reset or expiry date. Expiries are read from the service, never guessed from grant times.

## Install

1. Install the official **Codex – OpenAI's coding agent** extension (`openai.chatgpt`) and sign in with ChatGPT.
2. In VS Code, run **Extensions: Install from VSIX…** from the Command Palette and select `codex-limits-0.2.18.vsix` from this folder. This upgrades earlier versions if already installed.
3. Reload the VS Code window if prompted. The status bar appears automatically.

The package is for local installation; it has not been published to the Marketplace.

The tooltip shows the expected quota remaining beside each usage pace message, for example **on track (50%)**. This is the percentage of time remaining in that window, assuming usage is spread evenly over the window.

## Car animation

A car drives left to right over the current code editor using `createTextEditorDecorationType` and `setDecorations`. It opens no tab or webview and never edits the document, selection, undo history, or scroll position. The default animation lasts three seconds. A repeated trigger replaces the current animation. Switching editors, scrolling, editing, losing window focus, or unloading the extension cancels it and releases its decoration and timers.

When either usage window has **30 minutes or less until reset**, a shaking bell appears over the middle visible code line with **three cars driving across together for six seconds**. Configure `codexLimits.resetAnimationMinutes` to change the threshold; `0` disables automatic warnings. Each window triggers once per reset while this extension is active. If both qualify together, they share one animation. Warnings use fresh cached reset times, checked every 15 seconds, and wait for a focused, visible code editor. They do not make extra HTTP requests.

Set `codexLimits.animationEnabled` to `false` to **turn off all animations**. This immediately removes any running animation and blocks automatic, manual, and programmatic triggers. The default is `true`.

Run **Codex Limits: Test Drive Car** from the Command Palette to preview the full bell-and-three-car animation immediately. The minute test timer has been removed. The command does not require usage data.

Other features in this extension can call:

```js
const { driveCar, playResetAnimation } = require('./car');

driveCar();       // Three seconds.
driveCar(5000);   // Five seconds.
playResetAnimation(); // Shaking bell and three cars, six seconds.
```

Extension activation initializes the animation service and also returns `{ driveCar, playResetAnimation }` as its exports. The trigger returns `false` when animations are disabled, no suitable editor is available, the duration is invalid, or the service has been disposed. It can be called programmatically without window focus; automatic reset warnings wait until VS Code is focused.

**Limitations:** VS Code does not expose an unrestricted floating overlay API or the editor's pixel width. This implementation anchors a decoration to the middle of the largest visible code block, uses additional CSS declarations through `textDecoration` for absolute positioning, and updates its horizontal margin about 30 times per second. The CSS workaround is not a supported positioning contract and may behave differently in future releases, wrapped/folded editors, or different layouts. Travel distance uses window viewport units, so narrow/split editors clip the cars before the six-second animation ends. The bell is anchored to the middle visible code line, with its horizontal offset capped at 240 pixels so long lines do not push it far off-screen. Its placement follows the code rather than the exact screen centre; very narrow editors or horizontal scrolling can still clip decorations. In a short or empty document its vertical position follows the available code lines. Frame rate depends on extension-host load.

The workaround affects only the temporary decoration. It does not inject JavaScript into the workbench, patch installation files, load a custom stylesheet, or require another extension. Actual bell and three-car rendering was verified on macOS in VS Code 1.141.0 using an isolated editor fixture; document text, version, dirty state, and selection were unchanged after completion. See [DecorationRenderOptions](https://code.visualstudio.com/api/references/vscode-api#DecorationRenderOptions) and [VS Code extension restrictions](https://code.visualstudio.com/api/extension-capabilities/overview#restrictions).

## How it connects

Codex Limits reads the access token and optional account ID from Codex's existing `auth.json` and makes an HTTPS GET to `https://chatgpt.com/backend-api/wham/usage`. It rereads the file on every refresh so tokens renewed by Codex are picked up automatically. It never starts a Codex process, refreshes tokens, acquires credential locks, writes to Codex files, changes the official extension, or makes model requests. When banked resets are available, it also makes a read-only GET to `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits` for their expiry details. It never redeems a reset. Detail failures keep the usage readings and reset count, with a separate retry cooldown honoring Retry-After. No runtime dependencies are required.

The request uses the saved token in the Authorization header and the account ID when available. Requests go to a fixed ChatGPT endpoint with normal TLS verification; redirects are rejected. Credentials, response bodies and raw network errors are never logged. The refresh token is not used. This HTTP approach is also used by [codex-stats](https://github.com/Maol-1997/codex-stats/blob/main/src/codex-client.ts). The endpoint is an internal ChatGPT endpoint and can change.

The top-level Codex quota is read from `rate_limit.primary_window` and `secondary_window`; additional model-specific quotas are ignored. Five-hour and weekly windows are identified by their durations (18,000 and 604,800 seconds), with positional fallback for missing durations. Absolute `reset_at` timestamps are preferred; `reset_after_seconds` is supported as a fallback.

Usage refreshes approximately once a minute by default. A 15-second timer updates countdowns and checks whether another usage request is due. Window focus refreshes respect the same interval; clicking refresh bypasses the normal interval. Requests never overlap, have a 15-second total timeout and a bounded response size, and are cancelled on unload or credential/polling configuration changes. Failures back off automatically, up to 15 minutes. HTTP 429 responses honor Retry-After with a minimum one-minute cooldown; manual refresh also respects that cooldown.

At a reset the bar waits for a fresh response rather than assuming 100% is available. Temporary network failures retain the last readings with a **stale** marker. Missing, invalid or rejected credentials, API-key mode and changes to the saved token/account clear old readings. If the token expires, use Codex normally or sign in through Codex, then refresh. This extension does not renew it. No credentials or readings are persisted by this extension.

The credential directory is `codexLimits.codexHome`, then `CODEX_HOME`, then `~/.codex`. This version requires existing **file-based credentials**. Codex can also store credentials in the OS keychain or only in memory; those storage modes are not accessed or changed. See [OpenAI authentication documentation](https://learn.chatgpt.com/docs/auth). The extension works independently of the official extension once file-based credentials exist.

The extension runs locally, including in Remote SSH windows. If your Codex account is on a remote host or in WSL, its credentials may differ. You can point `codexLimits.codexHome` to an already accessible credential directory. It uses a direct HTTPS connection; custom proxy configuration is not included. Live HTTP usage retrieval has been verified on macOS.

## Settings and commands

| Setting | Default | Purpose |
| --- | --- | --- |
| `codexLimits.animationEnabled` | `true` | Enable all editor animations; disabling immediately stops the current animation and blocks every trigger |
| `codexLimits.resetAnimationMinutes` | `30` | Minutes before either window resets to play the bell and three cars; `0` disables automatic warnings |
| `codexLimits.refreshIntervalSeconds` | `60` | Usage polling interval, between 30 and 3,600 seconds |
| `codexLimits.showWeeklyReset` | `true` | Show the weekly countdown in the bar |
| `codexLimits.warningThresholdPercent` | `10` | Highlight low remaining quota |
| `codexLimits.underUsageThresholdPercentagePoints` | `10` | Percentage points below elapsed time before showing under usage |
| `codexLimits.overUsageThresholdPercentagePoints` | `10` | Percentage points above elapsed time before showing over usage |
| `codexLimits.codexHome` | empty | Absolute directory containing Codex auth.json |

Commands: **Codex Limits: Refresh Usage**, **Codex Limits: Open Codex**, **Codex Limits: Show Diagnostics**, and **Codex Limits: Test Drive Car**.

Find **Codex Limits: Refresh Interval Seconds** in VS Code Settings, or set it in your user `settings.json`:

```json
"codexLimits.refreshIntervalSeconds": 60
```

Set **Codex Limits: Under Usage Threshold Percentage Points** and **Codex Limits: Over Usage Threshold Percentage Points** in Settings, or add these values to your user `settings.json`:

```json
"codexLimits.underUsageThresholdPercentagePoints": 15,
"codexLimits.overUsageThresholdPercentagePoints": 5
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

The live check reads the saved credential file and sends one usage GET. The 54 tests exercise read-only credential access, token changes, fixed request destination, redirect rejection, HTTP errors, backoff, timeouts, cancellation, quota parsing, configurable pace thresholds and boundaries, configurable polling, banked reset expiry parsing, detail request cooldowns, reset warning thresholds and deduplication, car animation triggers and cleanup, and status bar behavior using temporary credential fixtures and a mocked HTTPS transport.
