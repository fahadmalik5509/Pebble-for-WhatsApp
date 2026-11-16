import { chromium } from "./pw.mjs";
import path from "node:path";
import os from "node:os";
const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const url of ["/lifecycle", "/pending-play", "/pending-play?toolbar=visible"]) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto("http://127.0.0.1:8765" + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => ({ id: b.id, text: b.innerText.trim() })));
  console.log(`\n===== ${url} =====`, JSON.stringify(buttons));
  const btn = page.locator("button").first();
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(15000);
  }
  const body = await page.locator("body").innerText();
  console.log(body.slice(0, 5000));
  await page.screenshot({ path: path.join(os.tmpdir(), "pebble-wa-shots", `harness-extra-${url.replace(/[^a-z0-9]+/gi, "-")}-run.png`), fullPage: true });
  await page.close();
}
await browser.close();