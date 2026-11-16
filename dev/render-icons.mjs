// Render the toolbar and store icons from design/icon/*.svg.
// Run: node dev/render-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./wa-e2e/pw.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (name) =>
  fs.readFileSync(path.join(ROOT, "design/icon", name), "utf8");
const targets = [
  ["pebble-icon-small.svg", 16, "extension/assets/icon16.png"],
  ["pebble-icon-small.svg", 32, "extension/assets/icon32.png"],
  ["pebble-icon.svg", 48, "extension/assets/icon48.png"],
  ["pebble-icon.svg", 128, "extension/assets/icon128.png"],
  ["pebble-icon.svg", 1024, "pebble-icon.png"],
];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
for (const [file, size, out] of targets) {
  const svg = source(file).replace(
    "<svg ",
    `<svg width="${size}" height="${size}" `,
  );
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
  );
  await page.locator("svg").screenshot({
    path: path.join(ROOT, out),
    omitBackground: true,
  });
  console.log(`${out} ${size}px`);
}
await browser.close();
