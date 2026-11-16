# Pebble real-account E2E tools

Local-only Playwright helpers that drive a logged-in WhatsApp Web account with
the unpacked `extension/` loaded in Edge. They are not part of the extension
package.

## Prerequisites

- Windows with Edge installed.
- Playwright. Install it next to this repository (`npm i playwright`) or set
  `PEBBLE_PLAYWRIGHT_ROOT` to a directory containing Playwright's
  `package.json`.
- An Edge profile that is logged into WhatsApp Web. The first
  `node dev/wa-e2e/login.mjs` run prints a pairing code for your phone and
  saves the session to `pebble-wa-profile` in your temp folder.

## Typical session

```powershell
# 1. Log in once (prints an 8-character pairing code for the phone).
node dev/wa-e2e/login.mjs

# 2. Keep one instrumented browser session open on CDP port 9333.
node dev/wa-e2e/browser.mjs

# 3. Reload the unpacked extension after editing CSS/JS.
node dev/wa-e2e/reload.mjs

# 4. Run the checks.
node dev/wa-e2e/audit-clean.mjs
node dev/wa-e2e/run-harness2.mjs
node dev/wa-e2e/verify-uniform.mjs
```

`lib.mjs` exposes `connect`, `setPrefs`, `openChat` and screenshots. Set
`PEBBLE_EXT_ID` to your unpacked extension's id, or edit the default in
`lib.mjs`. The scripts assume the test chat named `Fahad Malik` for message
tests; adjust that name if the account differs.

## Extension-owned checks

These require only the repo and no account:

```powershell
node dev/browser-check.cjs
```

Then open `http://127.0.0.1:8765` and run the main button and the three links.
Expected: 75/75 browser checks, 9/9 lifecycle checks, and PASS on both delayed
playback pages. `run-harness2.mjs` and `run-harness-extra2.mjs` automate that
with Playwright while the harness server runs.
