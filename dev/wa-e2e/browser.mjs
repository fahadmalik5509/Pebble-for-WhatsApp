// Keep one Edge/WhatsApp session alive with Pebble loaded and CDP exposed.
import { chromium } from "./pw.mjs";
import path from "node:path";
import os from "node:os";
const ROOT = path.resolve(import.meta.dirname, "../..");
const EXT = path.join(ROOT, "extension");
const PROFILE = path.join(os.tmpdir(), "pebble-wa-profile");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "msedge",
  headless: false,
  viewport: { width: 1600, height: 1000 },
  args: [
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-port=9333",
  ],
  ignoreDefaultArgs: ["--disable-extensions"],
});
const session = await context.browser().newBrowserCDPSession();
const { id } = await session.send("Extensions.loadUnpacked", { path: EXT });
log("EXTENSION", id);
await session.detach();

const page = context.pages()[0] || (await context.newPage());
page.on("pageerror", (e) => log("pageerror:", e.message));
page.on("console", (m) => {
  if (m.text().includes("Pebble")) log("console:", m.text().slice(0, 300));
});
await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
const useHere = page.getByText(/^Use here$/i).first();
if (await useHere.count()) {
  await useHere.evaluate((el) => el.parentElement?.click());
  await page.waitForTimeout(6000);
}
await page.waitForSelector("#pane-side", { timeout: 60000 });
log("READY", page.url());
// Keep the browser process and session alive for connectOverCDP probes.
setInterval(() => {}, 1 << 30);