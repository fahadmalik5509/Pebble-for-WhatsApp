// Probe helper library: connect to the persistent instrumented browser.
import { chromium } from "./pw.mjs";
import path from "node:path";
import os from "node:os";

const SHOTS = path.join(os.tmpdir(), "pebble-wa-shots");

export async function connect() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().includes("web.whatsapp.com"));
  if (!page) page = context.pages()[0];
  await page.bringToFront();
  return { browser, context, page };
}

export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  return `${SHOTS}/${name}.png`;
}

// The unpacked extension's id. It differs per machine; set PEBBLE_EXT_ID or
// edit this default after loading the extension.
const EXT_ID = process.env.PEBBLE_EXT_ID || "pfinhjdcpbcmdammppkoaikgnfindmnj";

async function storageTarget(context) {
  const sw = context.serviceWorkers().find((w) => w.url() === `chrome-extension://${EXT_ID}/sw.js`);
  if (sw) return sw;
  let page = context.pages().find((p) => p.url() === `chrome-extension://${EXT_ID}/popup/popup.html`);
  if (!page) {
    page = await context.newPage();
    await page.goto(`chrome-extension://${EXT_ID}/popup/popup.html`);
    await page.waitForTimeout(800);
  }
  return page;
}

export async function setPrefs(context, patch) {
  const target = await storageTarget(context);
  return target.evaluate(async (patch) => {
    const cur = (await chrome.storage.sync.get("prefs")).prefs || {};
    const next = {
      ...cur,
      ...patch,
      toggles: {
        ...(cur.toggles || {}),
        ...(patch.features || {}),
        ...(patch.subs || {}),
        ...(patch.toggles || {}),
      },
    };
    delete next.features;
    delete next.subs;
    await chrome.storage.sync.set({ prefs: WAB.normalizePrefs(next) });
    return (await chrome.storage.sync.get("prefs")).prefs;
  }, patch);
}

export async function openChat(page, name) {
  const row = page.locator('[data-testid="cell-frame-container"]', { hasText: name }).first();
  await row.waitFor({ state: "visible", timeout: 15000 });
  await row.click({ force: true });
  await page.waitForTimeout(1500);
}