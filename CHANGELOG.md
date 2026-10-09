# Changelog

## 0.2.18

- Shorten the expected remaining percentage beside tooltip pace messages to just the percentage in brackets.

## 0.2.17

- Show expected quota remaining in brackets beside each tooltip usage pace message, based on the time remaining in that window.

## 0.2.16

- Add animationEnabled to turn off all editor animations, including manual tests and programmatic triggers. Disabling it immediately clears any running animation and its timers.

## 0.2.15

- Anchor the shaking bell to the middle visible code line instead of fixed viewport coordinates, fixing its disappearance in scrolled editors.
- Cap its horizontal offset to keep long code lines from placing the bell far off-screen.

## 0.2.14

- Add a shaking bell and three simultaneous cars lasting six seconds, using editor decorations.
- Trigger once per reset when either window is within a configurable threshold, defaulting to 30 minutes; zero disables automatic warnings.
- Keep the manual Test Drive Car command as a full-animation preview and remove the minute timer.
- Avoid replaying on polling or token renewal; defer warnings while unfocused, without an editor, or using stale data.

## 0.2.13

- Make automatic and manual test car animations last six seconds.

## 0.2.12

- Add reusable driveCar(duration = 3000) using a native text decoration with a CSS positioning workaround to drive across the actual code editor.
- Add a temporary Test Drive Car command and every-minute test timer, configurable with carAnimationTestEnabled.
- Replace overlapping animations and remove decorations on completion, editor switching, scrolling, editing, focus loss, and extension unload.
- Verify rendering in an isolated VS Code 1.141.0 window and confirm document text, version, dirty state, and selection are unchanged.

## 0.2.10

- Add separate configurable under-usage and over-usage thresholds, defaulting to 10 percentage points each for both windows. Boundary values remain on track.
- Apply tooltip and status presentation settings immediately without requesting fresh usage data.

## 0.2.9

- Include local timezone labels on reset and expiry timestamps, accounting for daylight saving at each timestamp.
- Remove the “Expires at” prefix from banked reset expiry lines.

## 0.2.8

- Colour tooltip pace labels in dark-mode-friendly shades: blue for on track, green for under usage, and yellow for over usage.

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
