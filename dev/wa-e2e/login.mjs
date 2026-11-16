// Log into real WhatsApp Web with a phone pairing code, with Pebble loaded.
// Persistent Edge profile keeps the session for the e2e suite.
import { chromium } from "./pw.mjs";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXT = path.join(ROOT, "extension");
const PROFILE = path.join(os.tmpdir(), "pebble-wa-profile");
const SHOTS = path.join(os.tmpdir(), "pebble-wa-shots");
fs.mkdirSync(PROFILE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "msedge",
  headless: false,
  viewport: { width: 1600, height: 1000 },
  args: ["--enable-unsafe-extension-debugging", "--start-maximized"],
  ignoreDefaultArgs: ["--disable-extensions"],
});
const browser = context.browser();
const session = await browser.newBrowserCDPSession();
const { id } = await session.send("Extensions.loadUnpacked", { path: EXT });
const { extensions } = await session.send("Extensions.getExtensions");
log("EXTENSION", id, extensions.map((e) => `${e.name}@${e.version}`).join(", "));
await session.detach();

const page = context.pages()[0] || (await context.newPage());
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("Pebble")) log("console:", t.slice(0, 500));
});
page.on("pageerror", (e) => log("pageerror:", e.message));

await page.goto("https://web.whatsapp.com/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SHOTS}/01-login.png` });
log("TITLE", await page.title());
log("TEXT", (await page.locator("body").innerText()).slice(0, 1500).replace(/\n+/g, " | "));
log(
  "LINKS",
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll("a,button,[role=button]")]
        .map((e) => (e.innerText || e.getAttribute("aria-label") || "").trim())
        .filter(Boolean)
        .slice(0, 40),
    ),
  ),
);

const phoneLink = page.getByText(/log in with phone number|link with phone number/i).first();
try {
  await phoneLink.evaluate((el) => {
    let target = el;
    while (
      target &&
      target !== document.body &&
      !["BUTTON", "A"].includes(target.tagName) &&
      !target.getAttribute("role")
    )
      target = target.parentElement;
    (target || el).click();
  });
  log("clicked phone link");
} catch (e) {
  log("phone link click failed:", e.message);
}
await page.waitForTimeout(3000);
log(
  "DIALOG HTML",
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') || document.body;
    return d.innerHTML.slice(0, 6000);
  }),
);
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/02-phone-form.png` });
log(
  "AFTER CLICK",
  (await page.locator("body").innerText()).slice(0, 1500).replace(/\n+/g, " | "),
);
log(
  "INPUTS",
  JSON.stringify(
    await page.evaluate(() =>
      [...document.querySelectorAll("input,select")].map((e) => ({
        tag: e.tagName,
        type: e.type,
        name: e.name,
        placeholder: e.placeholder,
        aria: e.getAttribute("aria-label"),
        value: e.value,
      })),
    ),
  ),
);

const input = page
  .locator(
    '[role="dialog"] input[type="tel"], [role="dialog"] input[inputmode="tel"], [role="dialog"] input, input[type="tel"], input[inputmode="tel"]',
  )
  .first();
try {
  await input.fill("+923196481544", { timeout: 15000 });
  log("filled phone");
} catch (e) {
  log("fill failed:", e.message);
  try {
    await input.fill("00923196481544", { timeout: 5000 });
  } catch (e2) {
    log("fill 2 failed:", e2.message);
  }
}
await page.screenshot({ path: `${SHOTS}/03-phone-filled.png` });

for (const label of [/^next$/i, /continue/i, /link with phone number/i]) {
  const next = page.getByRole("button", { name: label }).first();
  if (await next.count()) {
    try {
      await next.click({ timeout: 5000 });
      log("clicked", label);
      break;
    } catch (e) {
      log("next click failed:", e.message);
    }
  }
}
await page.waitForTimeout(5000);
await page.screenshot({ path: `${SHOTS}/04-code.png` });
const text = await page.locator("body").innerText();
log("CODE PAGE", text.slice(0, 2000).replace(/\n+/g, " | "));
const code = /([A-Z0-9]{4})[-\u2010-\u2015]?([A-Z0-9]{4})/.exec(text);
log("PAIRING CODE", code ? `${code[1]}-${code[2]}` : "NOT FOUND");

// Wait for the user to enter the code on their phone.
log("Waiting up to 10 minutes for login...");
try {
  await page.waitForFunction(
    () => !!document.querySelector("#pane-side") || /chats|whatsapp/i.test(document.querySelector("#app")?.innerText || "") && !!document.querySelector('[data-testid="chat-list"]'),
    null,
    { timeout: 600000, polling: 2000 },
  );
  log("LOGGED IN");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${SHOTS}/05-logged-in.png` });
  log("TITLE", await page.title());
  const body = await page.locator("body").innerText();
  log("BODY", body.slice(0, 2000).replace(/\n+/g, " | "));
} catch (e) {
  log("login wait ended:", e.message);
  await page.screenshot({ path: `${SHOTS}/05-timeout.png` });
}
await context.close();