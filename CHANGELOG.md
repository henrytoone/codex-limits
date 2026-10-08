# Changelog

## 0.2.7

- Show banked resets and their local expiry dates in a separate tooltip block.
- Fetch expiry details using a read-only HTTP endpoint; keep quota readings when details are unavailable and respect retry cooldowns.

## 0.2.6

- Put usage pace on its own line between the remaining percentage and reset timestamp for each window.

## 0.2.5

- Give the tooltip more space with separate window blocks, bold labels and percentages, and reset timestamps on their own lines.

## 0.2.4

- Show local reset dates and times in the tooltip's Reset at column.
- Clarify the existing polling interval setting, defaulting to 60 seconds, and verify changes apply immediately.

## 0.2.3

- Replace the verbose tooltip with a two-row table showing remaining quota, reset countdown and usage pace. Show diagnostic text only when needed.

## 0.2.2

- Show under usage, on track or over usage in the tooltip for both quota windows, comparing usage with elapsed time using a 10-percentage-point band.

## 0.2.1

- Simplify the status bar to `2h 45m • 61% | 5d 16h • 88%`, keeping quota labels in the tooltip.

## 0.2.0

- Replace the Codex app-server process with a direct HTTPS usage request.
- Read existing credentials on each refresh, without renewing tokens or modifying Codex files.
- Add request cancellation, timeouts, redirect rejection and retry backoff.
- Replace the executable override with an optional Codex credential directory setting.

## 0.1.0

- Initial status bar extension using Codex app-server.
