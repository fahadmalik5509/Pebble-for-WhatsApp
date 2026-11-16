// Verifies the single shared blur strength across live WhatsApp surfaces and
// both extension pages. Requires the instrumented browser from browser.mjs.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { connect, openChat, setPrefs } from "./lib.mjs";

const { context, page } = await connect();
await page.emulateMedia({ reducedMotion: "reduce" });
await page.evaluate(() =>
  document.documentElement.style.setProperty("--wab-duration", "0s"),
);
const EXT_ID = "pfinhjdcpbcmdammppkoaikgnfindmnj";
const leaves = [
  "messages_text", "messages_out", "messages_senders", "messages_cards",
  "messages_reply", "messages_status", "media_photos", "media_videos",
  "media_stickers", "media_voice", "media_maps", "media_viewer",
  "media_status", "links_previews", "links_inline", "links_gallery",
  "docs_chat", "docs_gallery", "input_chat", "input_search", "names_list",
  "names_header", "names_info", "pics_list", "pics_header", "pics_info",
];
const base = {
  on: true,
  level: "medium",
  features: Object.fromEntries(["messages", "media", "previews", "links", "docs", "input", "names", "pics"].map((id) => [id, true])),
  subs: Object.fromEntries(leaves.map((id) => [id, true])),
  idleTimeoutSec: 0,
  autoHideSec: 0,
  interactionMode: "hover",
  revealDelayMode: "instant",
  pebbleEnabled: false,
  pauseVideoOnBlur: false,
};
const filterOf = (selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el).filter : null;
  }, selector);
const probe = async () => ({
  root: await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wab-blur").trim()),
  preview: await filterOf('[data-testid="cell-frame-secondary"] > :first-child'),
  name: await filterOf('#pane-side div[role="row"]:not(:has([data-testid="message-yourself-row"])) [data-testid="cell-frame-title"]'),
  message: await filterOf('#main [data-testid="msg-container"] span.selectable-text'),
  photo: await filterOf('#main [data-testid="image-thumb"] img'),
  doc: await filterOf('#main [data-testid="document-thumb"]'),
  link: await filterOf('#main [data-testid="msg-container"] a[href]'),
  avatar: await filterOf('#pane-side div[role="row"] img[alt]'),
});

await setPrefs(context, base);
await page.bringToFront();
await page.waitForTimeout(500);
await page.locator('button[aria-label="Chats"]').first().evaluate((el) => el.click()).catch(() => {});
await page.waitForTimeout(400);
await openChat(page, "Fahad Malik");
await page.waitForTimeout(900);
await page.mouse.move(6, 4);
await page.waitForTimeout(300);

for (const [level, px] of [["low", 4], ["medium", 8], ["high", 16]]) {
  await setPrefs(context, { level });
  await page.waitForTimeout(1500);
  const actual = await probe();
  console.log("LEVEL", level, JSON.stringify(actual));
  assert.equal(actual.root, `${px}px`);
  for (const key of ["preview", "name", "message", "photo", "doc", "link", "avatar"]) {
    if (actual[key] !== null && actual[key] !== "none")
      assert.equal(actual[key], `blur(${px}px)`, `${key} at ${level}`);
  }
}

// The popup offers one shared strength with three choices, never per surface.
// Pixel values appear only on those three strength choices.
await setPrefs(context, { level: "medium" });
await page.waitForTimeout(800);
const popup = await context.newPage();
await popup.setViewportSize({ width: 420, height: 700 });
await popup.goto(`chrome-extension://${EXT_ID}/popup/popup.html`);
await popup.waitForTimeout(1000);
const popupState = await popup.evaluate(() => ({
  level: document.querySelector('#levelMount [aria-checked="true"]')?.getAttribute("aria-label"),
  levels: document.querySelectorAll('#levelMount [role="radio"]').length,
  captions: [...document.querySelectorAll(".acc-cap")].map((el) => el.textContent.trim()),
  ranges: document.querySelectorAll('input[type="range"]').length,
  pxOutsideLevels: [...document.querySelectorAll(".card")].some((el) =>
    /\b\d+\s*px\b/i.test(el.innerText),
  ),
  hasRules: /Custom rules/i.test(document.body.innerText),
  hasPreview: /Preview cover/i.test(document.body.innerText),
}));
console.log("POPUP", JSON.stringify(popupState));
assert.ok(popupState.level?.startsWith("Medium"));
assert.equal(popupState.levels, 3);
assert.ok(popupState.captions.every((text) => !text.includes("px")));
assert.equal(popupState.pxOutsideLevels, false);
assert.equal(popupState.hasRules, false);
assert.equal(popupState.hasPreview, false);
assert.equal(popupState.ranges, 1);
await popup.screenshot({ path: path.join(os.tmpdir(), 'pebble-wa-shots', 'popup-uniform.png'), fullPage: true });

const options = await context.newPage();
await options.setViewportSize({ width: 1400, height: 950 });
await options.goto(`chrome-extension://${EXT_ID}/popup/popup.html`);
await options.waitForTimeout(1000);
const optionsState = await options.evaluate(() => ({
  hasStrengthCopy: /Blur strength|Cover strength|Blur amount|Custom strength/.test(document.body.innerText),
  strengthNodes: document.querySelectorAll(".strength, .level-reset, .dot-custom").length,
  copy: !/Same for everything/.test(document.body.innerText),
  hasCover: !!document.getElementById("idleSelect") && !!document.getElementById("onLoadMount"),
  hasRules: /Custom rules/i.test(document.body.innerText),
}));
console.log("OPTIONS", JSON.stringify(optionsState));
assert.equal(optionsState.hasStrengthCopy, false);
assert.equal(optionsState.strengthNodes, 0);
assert.equal(optionsState.copy, false);
assert.equal(optionsState.hasCover, true);
assert.equal(optionsState.hasRules, false);
await options.screenshot({ path: path.join(os.tmpdir(), 'pebble-wa-shots', 'options-uniform.png'), fullPage: true });

// Every cover path uses the same shared value.
const backdrop = () => page.evaluate(() => ({
  before: getComputedStyle(document.documentElement, "::before").backdropFilter,
  after: getComputedStyle(document.documentElement, "::after").backdropFilter,
}));
await options.evaluate(() => chrome.runtime.sendMessage({ type: "WAB_PANIC_ENGAGE" }));
await page.bringToFront();
await page.waitForTimeout(500);
const panic = await backdrop();
console.log("PANIC", JSON.stringify(panic));
assert.equal(panic.before, "blur(8px)");
await options.evaluate(() => chrome.runtime.sendMessage({ type: "WAB_PANIC_RELEASE" }));
await page.waitForTimeout(400);

await setPrefs(context, { idleTimeoutSec: 1 });
await page.bringToFront();
await page.waitForTimeout(1500);
const idle = await backdrop();
console.log("IDLE", JSON.stringify(idle));
assert.equal(idle.before, "blur(8px)");
await page.mouse.move(12, 12);
await page.waitForTimeout(400);
const stillCovered = await backdrop();
console.log("IDLE STILL COVERED", JSON.stringify(stillCovered));
assert.equal(stillCovered.before, "blur(8px)");
await options.evaluate(() => chrome.runtime.sendMessage({ type: "WAB_PANIC_RELEASE" }));
await page.waitForTimeout(400);
const cleared = await backdrop();
console.log("IDLE CLEARED", JSON.stringify(cleared));
assert.equal(cleared.before, "none");
await setPrefs(context, { idleTimeoutSec: 0, level: "medium" });
await page.waitForTimeout(300);

await popup.close();
await options.close();
console.log("UNIFORM STRENGTH PASS");
process.exit(0);