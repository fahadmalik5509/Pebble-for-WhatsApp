// Real pointer/capture regressions for the installed extension. No live account.
// Requires Playwright. Set PEBBLE_PLAYWRIGHT_ROOT to a directory containing
// Playwright's package.json (or node_modules/playwright) if it is not installed
// next to this repository. PEBBLE_BROWSER_EXECUTABLE optionally selects a
// Chromium executable.
// Run: node dev/pebble-check.cjs [--edge]
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const pebbleRequire = createRequire(
  process.env.PEBBLE_PLAYWRIGHT_ROOT
    ? path.join(process.env.PEBBLE_PLAYWRIGHT_ROOT, "anchor.js")
    : "playwright",
);
const { chromium } = pebbleRequire("playwright");
const project = path.resolve(__dirname, "..");
const extension = path.join(project, "extension");
const edge = process.argv.includes("--edge");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "pebble-check-"));
const errors = [];
let context,
  server,
  count = 0;

async function run() {
  server = spawn(
    process.execPath,
    [path.join(__dirname, "browser-check.cjs"), extension],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Test fixture did not start")),
      10000,
    );
    server.once("error", reject);
    server.once("exit", (code) =>
      reject(new Error("Test fixture exited: " + code)),
    );
    server.stderr.on("data", (data) => process.stderr.write(data));
    server.stdout.on("data", (data) => {
      if (String(data).includes("8765")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  context = await chromium.launchPersistentContext(path.join(work, "profile"), {
    headless: true,
    ...(edge ? { channel: "msedge" } : {}),
    ...(process.env.PEBBLE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PEBBLE_BROWSER_EXECUTABLE }
      : {}),
    viewport: { width: 1200, height: 900 },
    args: [
      "--disable-extensions-except=" + extension,
      "--load-extension=" + extension,
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=CalculateNativeWinOcclusion",
    ],
  });
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 20000 }));
  const id = new URL(worker.url()).host;
  const fixture = (
    await (await fetch("http://127.0.0.1:8765/content-fixture")).text()
  )
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
  await context.route("https://web.whatsapp.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture }),
  );
  const page = await context.newPage();
  // This machine disables Windows animations. Pebble must still match the
  // user's supplied, explicitly requested animated HTML in that environment.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.pointerLog = [];
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "gotpointercapture",
      "lostpointercapture",
    ])
      window.addEventListener(
        type,
        (event) => {
          pointerLog.push({
            type,
            time: performance.now(),
            pointer: event.pointerId,
            buttons: event.buttons,
            x: event.clientX,
            y: event.clientY,
            target: event.target.id || event.target.tagName,
          });
          if (pointerLog.length > 40) pointerLog.shift();
        },
        true,
      );
  });
  const options = await context.newPage();
  const prefs = async (patch = {}) => {
    await worker.evaluate(
      async (patch) =>
        chrome.storage.sync.set({
          prefs: WAB.normalizePrefs({
            v: 2,
            idleTimeoutSec: 0,
            coverOnLoad: false,
            revealDelayMode: "instant",
            ...patch,
          }),
        }),
      patch,
    );
    await page.waitForTimeout(80);
  };
  await prefs();
  await options.goto(`chrome-extension://${id}/popup/popup.html#pebble`);
  await options.waitForFunction(() => PebbleStore.ready);
  await page.goto("https://web.whatsapp.com/");
  await page.bringToFront();
  const host = page.locator("#pebble-helper"),
    ball = host.locator(".ball");
  await ball.waitFor({ state: "visible" });
  const blurred = () =>
    page.waitForFunction(
      () =>
        getComputedStyle(document.getElementById("text1")).filter ===
        "blur(8px)",
    );
  const revealed = () =>
    page.waitForFunction(
      () =>
        getComputedStyle(document.getElementById("text1")).filter ===
        "blur(0px)",
    );
  const check = async (name, action) => {
    try {
      await page.bringToFront();
      await action();
      count++;
      console.log("PASS " + name);
    } catch (error) {
      console.error("FAIL " + name + ": " + error.message);
      console.error(
        "Fixture:",
        await page.evaluate((errors) => {
          const host = document.getElementById("pebble-helper"),
            ball = host?.shadowRoot?.querySelector(".ball");
          return {
            classes: document.documentElement.className,
            filter: getComputedStyle(document.getElementById("text1")).filter,
            widget: ball?.getAttribute("aria-label"),
            pressed: ball?.getAttribute("aria-pressed"),
            position: ball?.getBoundingClientRect().toJSON(),
            events: window.pointerLog,
            errors,
          };
        }, errors),
      );
      throw error;
    }
  };
  const centre = async (locator) => {
    const b = await locator.boundingBox();
    assert.ok(b);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const press = async () => {
    const p = await centre(ball);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
  };
  const mutationsDuring = (ms) =>
    host.evaluate((el, ms) => new Promise((resolve) => {
      let count = 0;
      const observer = new MutationObserver((records) => {
        count += records.length;
      });
      observer.observe(el.shadowRoot, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      setTimeout(() => {
        observer.disconnect();
        resolve(count);
      }, ms);
    }), ms);
  const timerMotion = () =>
    host.evaluate((el) => new Promise((resolve) => {
      const buttons = [...el.shadowRoot.querySelectorAll(".tb")];
      const frames = [], start = performance.now();
      const sample = (now) => {
        frames.push(buttons.map((button) => {
          const style = getComputedStyle(button);
          const matrix = new DOMMatrix(style.transform);
          return {
            x: matrix.m41,
            y: matrix.m42,
            scale: Math.hypot(matrix.m11, matrix.m12),
            opacity: Number(style.opacity),
          };
        }));
        if (now - start >= 700) resolve(frames);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
  const chooseTimer = async (seconds, dwell = 0) => {
    await press();
    await page.waitForTimeout(650);
    const target = host.locator(".tb").filter({ hasText: seconds + "s" });
    const p = await centre(target);
    await page.mouse.move(p.x, p.y);
    if (dwell) {
      await page.waitForTimeout(dwell);
      assert.equal(await ball.getAttribute("aria-expanded"), "true");
    }
    await page.mouse.up();
  };
  await check(
    "Widget tap reveals and a second tap conceals without altering settings",
    async () => {
      await ball.evaluate((el) => {
        window.fanFlashed = false;
        window.fanObserver = new MutationObserver((records) => {
          if (
            el.getAttribute("aria-expanded") === "true" ||
            records.some((r) => r.oldValue === "true")
          )
            window.fanFlashed = true;
        });
        fanObserver.observe(el, {
          attributes: true,
          attributeFilter: ["aria-expanded"],
          attributeOldValue: true,
        });
      });
      await ball.click({ delay: 100 });
      await revealed();
      await ball.click({ delay: 100 });
      await blurred();
      await page.waitForTimeout(300);
      assert.equal(
        await page.evaluate(() => {
          fanObserver.disconnect();
          return fanFlashed;
        }),
        false,
        "A toggle tap must never flash timer choices",
      );
      // The countdown ring only shows during a timed peek.
      assert.equal(
        await host.locator(".ring").evaluate((el) => getComputedStyle(el).opacity),
        "0",
      );
      assert.equal(
        (await worker.evaluate(() => chrome.storage.sync.get("prefs"))).prefs
          .on,
        true,
      );
    },
  );
  await check(
    "Hold opens timers promptly, dismisses unchosen timers, and keeps peeking until release",
    async () => {
      for (const reducedMotion of ["reduce", "no-preference"]) {
        await page.emulateMedia({ reducedMotion });
        await press();
        // Sample from the press itself: the stagger starts when the hold opens
        // the fan, so waiting first can miss the first bubble's departure.
        const motion = timerMotion();
        await revealed();
        assert.equal(await ball.getAttribute("aria-expanded"), "true");
        const frames = await motion;
        const first = frames.map((frame) => frame[0]);
        assert.ok(
          first.some((p) => p.opacity > 0.5 && p.scale > 1.02),
          "Timer bubbles must visibly overshoot like the reference",
        );
        const starts = [0, 2].map((i) => frames.findIndex((frame) =>
          frame[i].opacity > 0.5 && Math.hypot(frame[i].x, frame[i].y) > 35));
        assert.ok(
          starts[0] >= 0 && starts[1] > starts[0],
          "Timer bubbles must emerge in a staggered wave",
        );
        const end = first.at(-1);
        const hop = Math.max(...first.map((p) =>
          Math.abs(p.x * end.y - p.y * end.x) / Math.hypot(end.x, end.y)));
        assert.ok(hop > 2, "Timer bubbles must hop along a curved path");
        await page.waitForTimeout(600);
        assert.equal(await ball.getAttribute("aria-expanded"), "false");
        assert.equal(await host.locator(".tb:enabled").count(), 0);
        await revealed();
        await page.mouse.up();
        await blurred();
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  );
  await check(
    "Eyes track distant pointer positions across the viewport",
    async () => {
      const eyeX = () => host.locator(".pe").first().evaluate((el) =>
        new DOMMatrix(getComputedStyle(el).transform).m41);
      await page.mouse.move(20, 100);
      await page.waitForTimeout(650);
      const left = await eyeX();
      await page.mouse.move(1180, 100);
      await page.waitForTimeout(650);
      const right = await eyeX();
      assert.ok(left < -1 && right > 1 && right - left > 3);
    },
  );
  await check(
    "Dragging before hold does not peek and saves a normalized position",
    async () => {
      const start = await centre(ball);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      const target = { x: start.x - 240, y: start.y };
      await page.mouse.move(target.x, target.y);
      await page.waitForTimeout(30);
      const carried = await centre(ball);
      assert.ok(
        Math.abs(carried.x - target.x) < 2,
        "The reference follows the pointer directly while deforming",
      );
      const shape = await ball.boundingBox();
      assert.ok(
        Math.abs(shape.width - shape.height) > 3,
        "Dragging should visibly squash/stretch the body",
      );
      await page.mouse.move(90, 150, { steps: 5 });
      await blurred();
      await page.mouse.up();
      await page.waitForTimeout(100);
      const saved = await worker.evaluate(() =>
        chrome.storage.local.get("pebblePosition"),
      );
      assert.ok(
        saved.pebblePosition.x > 0 && saved.pebblePosition.x < 0.2,
      );
      assert.ok(
        saved.pebblePosition.y > 0 && saved.pebblePosition.y < 0.3,
      );
      await page.waitForTimeout(1400);
      const settled = await centre(ball);
      assert.ok(Math.abs(settled.x - 90) < 2 && Math.abs(settled.y - 150) < 2);
      await page.reload();
      await ball.waitFor();
      const current = await centre(ball);
      assert.ok(Math.abs(current.x - 90) < 5 && Math.abs(current.y - 150) < 5);
    },
  );
  await check(
    "Choosing a timer reveals until its deadline, then conceals",
    async () => {
      await prefs({ pebbleTimers: [1, 2, 3] });
      await chooseTimer(1);
      await revealed();
      await blurred();
    },
  );
  await check("Clicking during a timer cancels it immediately", async () => {
    await chooseTimer(3);
    await revealed();
    await ball.click();
    await blurred();
  });
  await check(
    "Highlighting preserves a timer for release beyond the choice window",
    async () => {
      await chooseTimer(3, 700);
      await revealed();
      assert.match(await ball.getAttribute("aria-label"), /timed peek/);
      await ball.click();
      await blurred();
      await press();
      await page.waitForTimeout(650);
      const p = await centre(host.locator(".tb").first());
      await page.mouse.move(p.x, p.y);
      await page.waitForTimeout(700);
      const origin = await centre(ball);
      await page.mouse.move(origin.x, origin.y);
      assert.equal(await ball.getAttribute("aria-expanded"), "false");
      await revealed();
      await page.mouse.up();
      await blurred();
    },
  );
  await check(
    "Settled animation stops DOM work and timed peeks only update at second boundaries",
    async () => {
      await page.mouse.move(600, 850);
      await page.waitForTimeout(2200);
      assert.equal(await mutationsDuring(700), 0);
      await prefs({ pebbleTimers: [1, 3, 10] });
      await chooseTimer(10);
      await revealed();
      await page.waitForTimeout(2200);
      const changes = await mutationsDuring(1200);
      assert.ok(
        changes < 30,
        `A countdown should not animate every frame: ${changes} mutations`,
      );
      await ball.click();
      await blurred();
    },
  );
  await check(
    "A cancel tap spanning timer expiry cannot start a latched reveal",
    async () => {
      await chooseTimer(1);
      await revealed();
      await page.waitForTimeout(850);
      await press();
      await page.waitForTimeout(180);
      await page.mouse.up();
      await blurred();
    },
  );
  await check(
    "Ending a planted hold keeps an existing latched reveal",
    async () => {
      await ball.click();
      await revealed();
      await press();
      await page.waitForTimeout(350);
      await page.mouse.up();
      await revealed();
      await ball.click();
      await blurred();
    },
  );
  await check(
    "Canceling a pointer cannot toggle or choose a timer",
    async () => {
      await press();
      await page.waitForTimeout(100);
      await ball.evaluate((el) =>
        el.dispatchEvent(
          new PointerEvent("pointercancel", {
            pointerId: 1,
            bubbles: true,
            composed: true,
          }),
        ),
      );
      await page.mouse.up();
      await blurred();
    },
  );
  await check("Function keys no longer trigger global peek", async () => {
    await page.locator("#composer").focus();
    await page.keyboard.down("F8");
    await blurred();
    await page.keyboard.up("F8");
    await blurred();
  });
  await check(
    "Pebble reveal resumes protected video and concealing pauses it again",
    async () => {
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 100;
        canvas.height = 60;
        canvas.getContext("2d").fillRect(0, 0, 100, 60);
        const video = document.createElement("video");
        video.id = "pebbleVideo";
        video.muted = true;
        const message = document.createElement("div");
        message.dataset.testid = "msg-container";
        message.append(video);
        document.getElementById("main").append(message);
        video.srcObject = canvas.captureStream(10);
        window.pebbleVideo = video;
        await video.play();
      });
      try {
        await page.waitForFunction(() => pebbleVideo.paused);
        await ball.click();
        await page.waitForFunction(() => !pebbleVideo.paused);
        await ball.click();
        await page.waitForFunction(() => pebbleVideo.paused);
      } finally {
        await page.evaluate(() => {
          pebbleVideo.srcObject.getTracks().forEach((track) => track.stop());
          pebbleVideo.parentElement.remove();
          delete window.pebbleVideo;
        });
      }
    },
  );
  await check(
    "Screen cover cancels widget reveal and releasing cover cannot restore it",
    async () => {
      await ball.click();
      await revealed();
      await options.evaluate(() =>
        WAB.sendMessage({ type: "WAB_PANIC_ENGAGE" }),
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.documentElement, "::before")
            .backdropFilter === "blur(8px)",
      );
      await options.evaluate(() =>
        WAB.sendMessage({ type: "WAB_PANIC_RELEASE" }),
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.documentElement, "::before")
            .backdropFilter === "none",
      );
      await blurred();
    },
  );
  await check(
    "Leaving the page cancels a latched reveal",
    async () => {
      await ball.click();
      await revealed();
      await page.evaluate(() => dispatchEvent(new Event("blur")));
      await blurred();
    },
  );
  await check("Inactivity cancels a latched reveal", async () => {
    await ball.click();
    await revealed();
    await prefs({ idleTimeoutSec: 1 });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.documentElement, "::before").backdropFilter ===
        "blur(8px)",
    );
    await options.evaluate(() =>
      WAB.sendMessage({ type: "WAB_PANIC_RELEASE" }),
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.documentElement, "::before").backdropFilter ===
        "none",
    );
    await prefs();
    await blurred();
  });
  await check("Zero timer presets leaves ordinary hold-to-peek", async () => {
    await prefs({ pebbleTimers: [] });
    await press();
    await page.waitForTimeout(1100);
    await revealed();
    assert.equal(await host.locator(".tb").count(), 0);
    await page.mouse.up();
    await blurred();
  });
  await check(
    "Disabling the widget conceals content and removes its click target",
    async () => {
      await ball.click();
      await revealed();
      await prefs({ pebbleEnabled: false });
      await blurred();
      await ball.waitFor({ state: "hidden" });
      await prefs();
      await ball.waitFor({ state: "visible" });
    },
  );
  await check(
    "All three timer targets remain distinct and on-screen at viewport corners",
    async () => {
      for (const position of [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]) {
        await worker.evaluate(
          (position) =>
            chrome.storage.local.set({ pebblePosition: position }),
          position,
        );
        await page.waitForTimeout(100);
        await press();
        await page.waitForTimeout(750);
        const boxes = await host.locator(".tb").evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        );
        assert.equal(boxes.length, 3);
        for (const r of boxes)
          assert.ok(
            r.x >= 0 &&
              r.y >= 0 &&
              r.x + r.width <= 1201 &&
              r.y + r.height <= 901,
          );
        for (let i = 0; i < 3; i++)
          for (let j = i + 1; j < 3; j++)
            assert.ok(
              Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y) >=
                38,
            );
        await page.mouse.move(600, 450);
        await page.mouse.up();
        await blurred();
      }
    },
  );

  await check("Native Enter activates once, and Escape conceals", async () => {
    await ball.focus();
    await page.keyboard.press("Enter");
    await revealed();
    await page.keyboard.press("Escape");
    await blurred();
  });
  await check(
    "Reset position and timer preferences work from the real popup settings",
    async () => {
      await options.locator("#pebbleResetPosition").click();
      await page.waitForTimeout(100);
      const p = await centre(ball);
      assert.ok(Math.abs(p.x - 984) < 5 && Math.abs(p.y - 684) < 5);
      const inputs = options.locator("#pebbleTimers input");
      await options.locator("#pebbleTimers button").last().click();
      await inputs.nth(0).fill("4");
      await inputs.nth(0).press("Enter");
      await inputs.nth(1).fill("7");
      await inputs.nth(1).press("Enter");
      await options.waitForFunction(
        () => JSON.stringify(PebbleStore.prefs.pebbleTimers) === "[4,7]",
      );
      await inputs.nth(0).fill("0");
      await inputs.nth(0).press("Enter");
      assert.equal(
        await inputs.nth(0).getAttribute("aria-invalid"),
        "true",
      );
      assert.deepEqual(
        (await worker.evaluate(() => chrome.storage.sync.get("prefs"))).prefs
          .pebbleTimers,
        [4, 7],
      );
      await inputs.nth(0).press("Escape");
      await options.reload();
      await options.waitForFunction(() => PebbleStore.ready);
      assert.deepEqual(await inputs.evaluateAll((els) => els.map((el) => el.value)), ["4", "7"]);
      await page.bringToFront();
      await press();
      await page.waitForTimeout(400);
      assert.deepEqual(await host.locator(".tb span").allTextContents(), ["4s", "7s"]);
      await page.mouse.up();
      await blurred();
    },
  );
  await check(
    "Pebble keeps the requested animation under reduced motion and fits a narrow viewport",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 360, height: 500 });
      await page.waitForFunction(() => {
        const el = document.getElementById("pebble-helper")
          .shadowRoot.querySelector(".ball");
        const r = el.getBoundingClientRect();
        return (
          r.x >= 0 && r.right <= 360 && r.y >= 0 && r.bottom <= 500 &&
          matchMedia("(prefers-reduced-motion: reduce)").matches
        );
      }, null, { timeout: 3000 });
      const p = await centre(ball);
      assert.ok(p.x >= 32 && p.x <= 328 && p.y >= 32 && p.y <= 468);
      assert.equal(
        await host
          .locator(".f")
          .evaluate((el) => getComputedStyle(el).animationName),
        "breathe",
      );
      await ball.click();
      await revealed();
      await ball.click();
      await blurred();
    },
  );
  assert.deepEqual(errors, []);
  console.log(
    `${count}/${count} ${edge ? "Edge" : "Chromium"} installed Pebble scenarios passed. No uncaught errors.`,
  );
}
run()
  .catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (context) await context.close();
    if (server) server.kill();
    // The directory is generated test data; retain it only when debugging failures.
    if (!process.exitCode) {
      const target = fs.realpathSync(work),
        temp = fs.realpathSync(os.tmpdir());
      if (
        path.dirname(target) === temp &&
        path.basename(target).startsWith("pebble-check-")
      )
        fs.rmSync(target, { recursive: true, force: true });
    }
  });
