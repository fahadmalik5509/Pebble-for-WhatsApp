import { connect, setPrefs } from "./lib.mjs";
const { context, page } = await connect();
const EXT_ID = "pfinhjdcpbcmdammppkoaikgnfindmnj";
let extPage = context.pages().find((p) => p.url().startsWith(`chrome-extension://${EXT_ID}/`));
if (!extPage) {
  extPage = await context.newPage();
  await extPage.goto(`chrome-extension://${EXT_ID}/popup/popup.html`);
  await extPage.waitForTimeout(800);
}
await extPage.evaluate(() => chrome.runtime.reload()).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
await page.bringToFront();
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#pane-side", { timeout: 60000 });
await page.waitForTimeout(2500);
await setPrefs(context, {
  on: true,
  level: "medium",
  features: { messages: true, media: true, previews: true, links: true, docs: true, input: true, names: true, pics: true },
  subs: Object.fromEntries(
    ["messages_text","messages_out","messages_senders","messages_cards","messages_reply","messages_status","media_photos","media_videos","media_stickers","media_voice","media_maps","media_viewer","media_status","links_previews","links_inline","links_gallery","docs_chat","docs_gallery","input_chat","input_search","names_list","names_header","names_info","pics_list","pics_header","pics_info"].map((k) => [k, true]),
  ),
  idleTimeoutSec: 0,
  autoHideSec: 0,
  interactionMode: "hover",
  revealDelayMode: "instant",
  pebbleEnabled: false,
  pauseVideoOnBlur: false,
});
await page.waitForTimeout(800);
console.log("RELOADED");
process.exit(0);