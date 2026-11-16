import { chromium } from "./pw.mjs";
import path from "node:path";
import os from "node:os";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("http://127.0.0.1:8765", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
await page.locator("#run").click();
await page.waitForFunction(() => /browser checks passed/.test(document.querySelector("#result")?.textContent || ""), null, { timeout: 300000 });
console.log("TITLE", await page.title());
console.log(await page.locator("#result").innerText());
await page.screenshot({ path: path.join(os.tmpdir(), "pebble-wa-shots", "harness-main.png"), fullPage: true });
await browser.close();