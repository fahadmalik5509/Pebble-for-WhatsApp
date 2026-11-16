// Browser regressions for Pebble. Uses actual scripts and media playback;
// Chrome APIs and saved data are isolated by browser-check.cjs.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test) {
  for (let i = 0; i < 120; i++) {
    if (test()) return;
    await wait(25);
  }
  throw new Error("Timed out waiting for browser state");
}

document.getElementById("run").onclick = async () => {
  const results = [],
    output = document.getElementById("result");
  const c = frames.content,
    p = frames.popup,
    o = frames.rules;
  const worker = document.querySelector('iframe[src="/worker"]').contentWindow;
  const root = c.document.documentElement;
  const filter = (element) => c.getComputedStyle(element).filter;
  const clear = (element) => ["none", "blur(0px)"].includes(filter(element));
  const check = async (name, test) => {
    let error;
    try {
      await until(test);
    } catch (e) {
      error = e.message;
    }
    results.push({ name, pass: !error, error });
    output.textContent = results
      .map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.name}`)
      .join("\n");
  };
  const save = (prefs) => p.WAB.sendMessage({ type: "WAB_SAVE_PREFS", prefs });
  const setup = async (extra = {}) => {
    const prefs = {
      v: 3,
      idleTimeoutSec: 0,
      revealDelayMode: "instant",
      ...extra,
      toggles: {
        ...(extra.features || {}),
        ...(extra.subs || {}),
        ...(extra.toggles || {}),
      },
    };
    delete prefs.features;
    delete prefs.subs;
    await save(p.WAB.normalizePrefs(prefs));
    await wait(100);
  };
  const popup = async () => {
    const frame = document.createElement("iframe");
    frame.src = "/popup/popup.html?role=popup";
    frame.style.cssText = "width:400px;height:600px";
    await new Promise((resolve) => {
      frame.onload = resolve;
      document.body.append(frame);
    });
    await until(() => frame.contentWindow.PebbleStore?.ready);
    return frame;
  };
  const move = (element, x) =>
    element.dispatchEvent(
      new c.PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: 20,
      }),
    );
  const reveal = async (element) => {
    c.document.getElementById("composer").focus();
    move(element, 10);
    move(element, 16);
    await wait(100);
  };

  try {
    await until(
      () =>
        p.PebbleStore?.ready &&
        o.PebbleStore?.ready &&
        root.classList.contains("wab-off-names-list"),
    );
    await check(
      "Popup and settings load without browser errors",
      () => hub.errors.length === 0,
    );
    const manifest = p.chrome.runtime.getManifest();
    await check(
      "Extension and action identify Pebble for WhatsApp",
      () =>
        manifest.short_name === "Pebble" &&
        manifest.name === "Pebble for WhatsApp" &&
        manifest.action.default_title === manifest.name,
    );
    await check(
      "The header card names Pebble above the state headline",
      () =>
        [p, o].every(
          (w) =>
            w.document.querySelector(".hero .brand").textContent ===
              "Pebble for WhatsApp" &&
            w.document.querySelector(".hero .brand-line").tagName === "H1" &&
            w.document.getElementById("powerLabel") != null,
        ),
    );
    await check("The header draws Pebble inline with its cover mask", () =>
      [p, o].every(
        (w) =>
          w.document.querySelector(".stage svg.mascot .m-body") &&
          w.document.querySelector(".stage .m-mask"),
      ),
    );
    await check(
      "The header fits without hiding popup controls or adding horizontal overflow",
      () =>
        p.document.documentElement.scrollWidth <= p.innerWidth &&
        p.document.getElementById("panic").getBoundingClientRect().bottom <=
          p.innerHeight,
    );
    await check(
      "The popup uses the five-section vocabulary",
      () =>
        [...p.document.querySelectorAll(".tab")]
          .map((tab) => tab.textContent.trim())
          .join("|") === "Blur|Peek|Cover|Pebble|Settings",
    );
    await check(
      "The header names the current state",
      () => p.document.getElementById("powerLabel").textContent === "Blurred",
    );
    o.document.getElementById("exportCopy").click();
    await check(
      "Pebble exports use the Pebble backup format",
      () =>
        hub.clipboard && JSON.parse(hub.clipboard).format === "pebble-settings",
    );
    await check(
      "Pebble defaults and custom timer presets survive preference normalization",
      () =>
        p.WAB.DEFAULTS.pebbleEnabled === true &&
        JSON.stringify(p.WAB.DEFAULTS.pebbleTimers) === "[5,10,15]" &&
        JSON.stringify(
          p.WAB.normalizePrefs({ pebbleTimers: [] }).pebbleTimers,
        ) === "[]" &&
        JSON.stringify(
          p.WAB.normalizePrefs({ pebbleTimers: [-1, 5, 5, 10, 15, 20, null] })
            .pebbleTimers,
        ) === "[5,10,15]",
    );
    await check(
      "Chat previews live under Messages",
      () =>
        p.WAB.ORDER.length === 7 &&
        p.WAB.GROUP.messages.children.some(
          (child) => child.id === "previews",
        ) &&
        p.WAB.normalizePrefs({ features: { messages: true } }).toggles
          .messages === p.WAB.GROUP.messages.on,
    );
    await check(
      "Toggle masters preserve child choices and seed a dead group",
      () => {
        const state = p.WAB.normalizePrefs({
          v: 3,
          toggles: {
            messages: false,
            messages_text: false,
            previews: false,
            messages_out: false,
            messages_senders: false,
            messages_cards: false,
            messages_reply: false,
            messages_status: false,
          },
        });
        p.WAB.setLeaf(state, "previews", true);
        const forced =
          state.toggles.messages === true && state.toggles.previews === true;
        p.WAB.setGroup(state, "messages", false);
        const preserved = state.toggles.previews === true;
        p.WAB.setGroup(state, "messages", true);
        const kept =
          state.toggles.previews === true && state.toggles.messages_text === false;
        p.WAB.setGroup(state, "messages", false);
        p.WAB.setLeaf(state, "previews", false);
        p.WAB.setGroup(state, "messages", true);
        const seeded = p.WAB.GROUP.messages.children.every(
          (child) => state.toggles[child.id] === true,
        );
        return forced && preserved && kept && seeded;
      },
    );
    await check(
      "Peek offers Hover, Click and Hold",
      () =>
        [...o.document.querySelectorAll('#modeMount [role="radio"]')]
          .map((button) => button.textContent.trim())
          .join("|") === "Hover|Click|Hold",
    );
    await check(
      "Peek offers Hover, Click and Hold",
      () =>
        [...o.document.querySelectorAll('#modeMount [role="radio"]')]
          .map((button) => button.textContent.trim())
          .join("|") === "Hover|Click|Hold",
    );
    await setup({ interactionMode: "click" });
    o.location.hash = "peek";
    await until(() => !o.document.getElementById("pane-peek").hidden);
    const clickHidesDelay = o.document.getElementById("delayBlock").hidden;
    await setup({ interactionMode: "hold" });
    await until(() => o.document.getElementById("delayBlock").hidden);
    const holdHidesDelay = o.document.getElementById("delayBlock").hidden;
    await setup({ interactionMode: "hover" });
    await until(() => !o.document.getElementById("delayBlock").hidden);
    await check(
      "Only Hover mode shows the hover delay control",
      () =>
        clickHidesDelay &&
        holdHidesDelay &&
        !o.document.getElementById("delayBlock").hidden,
    );
    o.location.hash = "pebble";
    await until(() => !o.document.getElementById("pane-pebble").hidden);
    const timerList = o.document.getElementById("pebbleTimers");
    const timerInputs = () => timerList.querySelectorAll("input");
    const editTimer = (index, value) => {
      const input = timerInputs()[index];
      input.value = value;
      input.dispatchEvent(new o.Event("change", { bubbles: true }));
    };
    editTimer(0, "3");
    editTimer(1, "8");
    timerList.querySelectorAll("button")[2].click();
    await check(
      "Individual timer edits and removal save from Pebble settings",
      () => JSON.stringify(hub.sync.prefs?.pebbleTimers) === "[3,8]",
    );
    editTimer(0, "0");
    const rejectsRange = timerInputs()[0].getAttribute("aria-invalid") === "true";
    editTimer(0, "8");
    await check(
      "Invalid and duplicate timer values do not change saved timers",
      () =>
        rejectsRange &&
        timerInputs()[0].getAttribute("aria-invalid") === "true" &&
        o.document.getElementById("pebbleTimersError").textContent.length > 0 &&
        JSON.stringify(hub.sync.prefs.pebbleTimers) === "[3,8]",
    );
    timerInputs()[0].focus();
    timerInputs()[0].dispatchEvent(new o.KeyboardEvent("keydown", {
      key: "Escape", bubbles: true,
    }));
    const addTimer = o.document.getElementById("pebbleTimerAdd");
    addTimer.click();
    addTimer.click();
    await check(
      "Add timer focuses a new duration and stops at three timers",
      () => timerInputs().length === 3 && addTimer.hidden &&
        o.document.activeElement === timerInputs()[2] &&
        JSON.stringify(hub.sync.prefs.pebbleTimers) === "[3,8,5]",
    );
    while (timerList.childElementCount) timerList.querySelector("button").click();
    await check(
      "Removing every timer saves hold-only behavior and focuses Add timer",
      () => hub.sync.prefs.pebbleTimers.length === 0 &&
        !o.document.getElementById("pebbleTimersEmpty").hidden &&
        o.document.activeElement === addTimer,
    );
    o.document.getElementById("exportCopy").click();
    await check(
      "Backups include the Pebble preferences in the existing format",
      () =>
        JSON.parse(hub.clipboard).format === "pebble-settings" &&
        JSON.parse(hub.clipboard).prefs.pebbleEnabled === true &&
        JSON.parse(hub.clipboard).prefs.pebbleTimers.length === 0,
    );
    await o.chrome.storage.local.set({
      pebblePosition: { x: 0.3, y: 0.4 },
    });
    o.document.getElementById("pebbleResetPosition").click();
    await check(
      "Reset position removes the saved local placement",
      () => !hub.local.pebblePosition,
    );
    await save({
      ...hub.sync.prefs,
      pebbleTimers: [5, 10, 15],
      idleTimeoutSec: 30,
    });
    o.location.hash = "cover";
    await until(() => !o.document.getElementById("pane-cover").hidden);
    const idleChips = () => [
      ...o.document.querySelectorAll("#idleMount .chip"),
    ];
    const chipFor = (seconds) =>
      idleChips().find((chip) => chip.dataset.sec === String(seconds));
    const choices = [0, 5, 10, 15, 30, 45, 60];
    await check(
      "Idle offers Off and the complete seconds-only list immediately",
      () =>
        JSON.stringify(idleChips().map((chip) => Number(chip.dataset.sec))) ===
          JSON.stringify(choices) &&
        idleChips().every(
          (chip) =>
            chip.textContent ===
            (chip.dataset.sec === "0"
              ? "Off"
              : Number(chip.dataset.sec) < 60
                ? `${chip.dataset.sec} s`
                : "1 min"),
        ),
    );
    await check(
      "Existing default idle choice remains selected",
      () => chipFor(30).getAttribute("aria-checked") === "true",
    );
    for (const seconds of choices) {
      chipFor(seconds).click();
      await check(
        `Selecting ${seconds ? seconds + " seconds" : "Off"} saves and stays selected`,
        () =>
          hub.sync.prefs?.idleTimeoutSec === seconds &&
          chipFor(seconds).getAttribute("aria-checked") === "true",
      );
    }
    await setup({ idleTimeoutSec: 17 });
    await check(
      "A previously saved custom duration remains available in seconds",
      () =>
        chipFor(17) &&
        chipFor(17).textContent === "17 s" &&
        chipFor(17).getAttribute("aria-checked") === "true",
    );
    for (const theme of ["dark", "light", "system"]) {
      await save({ ...hub.sync.prefs, theme });
    }
    await check(
      "Rerendering settings does not duplicate idle options",
      () =>
        idleChips().filter((chip) => chip.dataset.sec === "17").length === 1 &&
        idleChips().length === 8,
    );
    await setup({ idleTimeoutSec: 1 });
    await wait(1400);
    await check(
      "Inactivity enters the covered state",
      () =>
        hub.local.wabPanic === true &&
        !!c.document.getElementById("test-panic") &&
        c.getComputedStyle(root, "::before").backdropFilter === "blur(8px)",
    );
    c.document.dispatchEvent(
      new c.PointerEvent("pointermove", {
        bubbles: true,
        clientX: 20,
        clientY: 20,
      }),
    );
    await wait(150);
    await check(
      "Covered stays covered on pointer movement",
      () => hub.local.wabPanic === true,
    );
    await p.WAB.sendMessage({ type: "WAB_PANIC_RELEASE" });
    await wait(150);
    await check(
      "Covered can be released explicitly after inactivity",
      () =>
        hub.local.wabPanic === false &&
        !c.document.getElementById("test-panic"),
    );
    await setup({ idleTimeoutSec: 0, coverClickRelease: false });
    await p.WAB.sendMessage({ type: "WAB_PANIC_ENGAGE" });
    await wait(150);
    const blockedClick = new c.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    c.document.body.dispatchEvent(blockedClick);
    await wait(150);
    await check(
      "Click-to-uncover can be disabled",
      () =>
        hub.local.wabPanic === true &&
        blockedClick.defaultPrevented &&
        !!c.document.getElementById("test-panic"),
    );
    await p.WAB.sendMessage({ type: "WAB_PANIC_RELEASE" });
    await wait(150);

    await setup({ idleTimeoutSec: 0, coverClickRelease: true });
    await p.WAB.sendMessage({ type: "WAB_PANIC_ENGAGE" });
    await wait(150);
    c.document.body.dispatchEvent(
      new c.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await check(
      "Click uncovers the page by default",
      () =>
        hub.local.wabPanic === false &&
        !c.document.getElementById("test-panic"),
    );
    await setup({ interactionMode: "hold", autoHideSec: 0 });
    const holdText = c.document.getElementById("text1");
    const holdBox = holdText.getBoundingClientRect();
    const holdX = holdBox.left + holdBox.width / 2;
    const holdY = holdBox.top + holdBox.height / 2;
    const holdPointer = (type, x = holdX, y = holdY) =>
      holdText.dispatchEvent(
        new c.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    holdPointer("pointerdown");
    await wait(400);
    await check("Hold reveals a blurred item after the threshold", () =>
      clear(holdText),
    );
    holdPointer("pointerup");
    await wait(80);
    const heldClick = new c.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    holdText.dispatchEvent(heldClick);
    await check(
      "Releasing a hold re-blurs and swallows the click",
      () => !clear(holdText) && heldClick.defaultPrevented,
    );

    await setup({ interactionMode: "hold", autoHideSec: 0 });
    holdPointer("pointerdown");
    holdPointer("pointerup");
    await wait(100);
    const shortClick = new c.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    holdText.dispatchEvent(shortClick);
    await check(
      "A short click does not reveal and still acts",
      () => !clear(holdText) && !shortClick.defaultPrevented,
    );

    await setup({ interactionMode: "hold", autoHideSec: 0 });
    holdPointer("pointerdown");
    holdPointer("pointermove", holdX + 20, holdY);
    await wait(400);
    await check("Moving cancels a hold", () => !clear(holdText));
    holdPointer("pointerup");
    await setup();

    const quick = await popup();
    quick.contentDocument.getElementById("master").click();
    quick.remove();
    await check(
      "A power toggle survives closing the popup in the same task",
      () =>
        hub.sync.prefs.on === false &&
        root.classList.contains("wab-off") &&
        hub.badge === "OFF",
    );
    await setup();
    const storage = worker.chrome.storage.sync,
      originalSet = storage.set,
      writes = [];
    storage.set = async (value) => {
      writes.push(value.prefs.level);
      await wait(60);
      return originalSet(value);
    };
    try {
      const rapid = await popup();
      for (const value of ["low", "medium", "high"])
        rapid.contentWindow.PebbleStore.set((prefs) => {
          prefs.level = value;
        });
      rapid.remove();
      await check(
        "Queued rapid edits finish in order after the popup closes",
        () =>
          hub.sync.prefs.level === "high" &&
          JSON.stringify(writes) === '["low","medium","high"]' &&
          root.style.getPropertyValue("--wab-blur") === "16px",
      );
    } finally {
      storage.set = originalSet;
    }

    o.location.hash = "peek";
    await until(() => !o.document.getElementById("pane-peek").hidden);
    const delay = o.document.querySelector('#delayMount input[type="range"]');
    const beforeDrag = hub.sync.prefs.revealDelayMs;
    for (const value of [310, 320, 330]) {
      delay.value = value;
      delay.dispatchEvent(new o.Event("input", { bubbles: true }));
    }
    await wait(150);
    await check(
      "Dragging updates the local preview without writing intermediate values",
      () =>
        o.PebbleStore.prefs.revealDelayMs === 330 &&
        hub.sync.prefs.revealDelayMs === beforeDrag,
    );
    delay.dispatchEvent(new o.Event("change", { bubbles: true }));
    await check(
      "Releasing the slider saves its final value",
      () => hub.sync.prefs.revealDelayMs === 330,
    );

    const sliderPopup = await popup();
    const slider = sliderPopup.contentDocument.querySelector(
      '#delayMount input[type="range"]',
    );
    slider.value = 500;
    slider.dispatchEvent(
      new sliderPopup.contentWindow.Event("input", { bubbles: true }),
    );
    const expectedDelay =
      sliderPopup.contentWindow.PebbleStore.prefs.revealDelayMs;
    slider.dispatchEvent(
      new sliderPopup.contentWindow.Event("change", { bubbles: true }),
    );
    sliderPopup.remove();
    await check(
      "A slider release survives immediately closing its popup",
      () => hub.sync.prefs.revealDelayMs === expectedDelay,
    );

    storage.set = async () => {
      throw new Error("Sample storage failure");
    };
    try {
      p.PebbleStore.set((prefs) => {
        prefs.theme = "dark";
      });
      await check(
        "A failed worker save is shown in the popup",
        () =>
          p.document.getElementById("status").classList.contains("error") &&
          p.document
            .getElementById("status")
            .textContent.includes("Sample storage failure"),
      );
    } finally {
      storage.set = originalSet;
    }
    p.PebbleStore.set((prefs) => {
      prefs.theme = "light";
    });
    await check(
      "The same worker queue accepts the next save after a failure",
      () =>
        hub.sync.prefs.theme === "light" &&
        !p.document.getElementById("status").classList.contains("error"),
    );

    await setup();
    const statePopup = await popup();
    const stateLabel = () =>
      statePopup.contentDocument.getElementById("powerLabel").textContent;
    await check(
      "The header switches from Blurred to Covered",
      () => stateLabel() === "Blurred",
    );
    await p.WAB.sendMessage({ type: "WAB_PANIC_ENGAGE" });
    await until(() => stateLabel() === "Covered");
    await check(
      "The header names the covered state",
      () => stateLabel() === "Covered",
    );
    await p.WAB.sendMessage({ type: "WAB_PANIC_RELEASE" });
    await until(() => stateLabel() === "Blurred");
    statePopup.remove();

    await setup();
    await p.WAB.sendMessage({ type: "WAB_PANIC_ENGAGE" });
    const powerPopup = await popup();
    powerPopup.contentDocument.getElementById("master").click();
    powerPopup.remove();
    await check(
      "Saving Power off also clears manual cover and its badge",
      () =>
        hub.sync.prefs.on === false &&
        hub.local.wabPanic === false &&
        !c.document.getElementById("test-panic") &&
        hub.badge === "OFF",
    );

    await setup();
    const formerPeek = new c.KeyboardEvent("keydown", {
      key: "F9",
      code: "F9",
      bubbles: true,
      cancelable: true,
    });
    c.document.body.dispatchEvent(formerPeek);
    await check(
      "Keyboard peek is removed and old backup keys are ignored",
      () =>
        !formerPeek.defaultPrevented &&
        !clear(c.document.getElementById("text1")) &&
        !o.document.getElementById("holdMount") &&
        !("holdToRevealKey" in p.WAB.normalizePrefs({ holdToRevealKey: "F9" })),
    );
    o.location.hash = "settings";
    await until(() => !o.document.getElementById("pane-settings").hidden);
    const toggleRecorder = o.document.querySelector(
      "#toggleMount .shortcut-field",
    );
    toggleRecorder.click();
    toggleRecorder.dispatchEvent(
      new o.KeyboardEvent("keydown", {
        key: "Alt",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    toggleRecorder.dispatchEvent(
      new o.KeyboardEvent("keydown", {
        key: "q",
        code: "KeyQ",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await check(
      "The on/off shortcut recorder still saves modifier shortcuts",
      () => hub.sync.prefs.toggleHotkey === "Alt+Q",
    );
    await setup();

    const canvas = c.document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    let tick = 0;
    const paint = setInterval(() => {
      context.fillStyle = ++tick % 2 ? "#00a884" : "#005c4b";
      context.fillRect(0, 0, 160, 80);
    }, 60);
    let pair;
    const createPair = () => {
      const chatRoot = c.document.createElement("div");
      chatRoot.dataset.testid = "msg-container";
      const chat = c.document.createElement("video");
      chat.muted = true;
      chatRoot.append(chat);
      c.document.getElementById("main").append(chatRoot);
      const viewerRoot = c.document.createElement("div");
      viewerRoot.dataset.testid = "media-viewer-modal";
      viewerRoot.innerHTML =
        '<div data-testid="media-video"><video muted></video><div class="overlay"></div><button><svg><title>ic-play-arrow-filled</title></svg></button></div>';
      c.document.body.append(viewerRoot);
      const viewer = viewerRoot.querySelector("video"),
        button = viewerRoot.querySelector("button"),
        title = button.querySelector("title");
      const stream = canvas.captureStream(12),
        chatEvents = [],
        viewerEvents = [];
      chat.srcObject = stream;
      viewer.srcObject = stream;
      let wants = false;
      button.onclick = () => {
        wants = !wants;
        if (wants) viewer.play().catch(() => {});
        else viewer.pause();
      };
      for (const type of ["play", "pause"]) {
        chat.addEventListener(type, () => chatEvents.push(type));
        viewer.addEventListener(type, () => {
          title.textContent =
            type === "play" ? "ic-pause-filled" : "ic-play-arrow-filled";
          viewerEvents.push(type);
          if (type === "pause" && wants)
            setTimeout(() => {
              if (wants) viewer.play().catch(() => {});
            }, 0);
        });
      }
      return {
        chat,
        viewer,
        chatRoot,
        viewerRoot,
        button,
        chatEvents,
        viewerEvents,
        async start() {
          await chat.play();
          button.click();
          await wait(300);
        },
        stop() {
          wants = false;
          chat.pause();
          viewer.pause();
          chatRoot.remove();
          viewerRoot.remove();
          stream.getTracks().forEach((track) => track.stop());
        },
      };
    };
    try {
      for (const [chatOn, viewerOn] of [
        [false, true],
        [true, false],
        [false, false],
        [true, true],
      ]) {
        pair?.stop();
        await setup({ subs: { media_videos: chatOn, media_viewer: viewerOn } });
        pair = createPair();
        await pair.start();
        await check(
          `Chat video follows its own switch (${chatOn}), viewer switch ${viewerOn}`,
          () => pair.chat.paused === chatOn && clear(pair.chat) === !chatOn,
        );
        await check(
          `Viewer follows its own switch (${viewerOn}), chat switch ${chatOn}`,
          () =>
            pair.viewer.paused === viewerOn && clear(pair.viewer) === !viewerOn,
        );
        const counts = [pair.chatEvents.length, pair.viewerEvents.length];
        await wait(400);
        await check(
          `Playback remains steady with chat ${chatOn} and viewer ${viewerOn}`,
          () =>
            pair.chatEvents.length === counts[0] &&
            pair.viewerEvents.length === counts[1],
        );
      }
      await reveal(pair.chat);
      await check(
        "Hover reveals and resumes only the chat video",
        () =>
          !pair.chat.paused &&
          clear(pair.chat) &&
          pair.viewer.paused &&
          !clear(pair.viewer),
      );
      move(c.document.getElementById("message1"), 70);
      await wait(100);
      await check(
        "Leaving the chat video pauses it and restores blur",
        () => pair.chat.paused && !clear(pair.chat),
      );
      await reveal(pair.viewerRoot.querySelector(".overlay"));
      const count = pair.viewerEvents.length,
        time = pair.viewer.currentTime;
      await wait(1400);
      await check(
        "Viewer hover advances playback without play/pause cycling",
        () =>
          !pair.viewer.paused &&
          clear(pair.viewer) &&
          pair.viewer.currentTime > time + 0.8 &&
          pair.viewerEvents.length === count,
      );
      pair.button.click();
      await wait(120);
      move(pair.viewer, 40);
      await wait(150);
      await check(
        "Manual pause while hovered is respected",
        () => pair.viewer.paused,
      );
      move(c.document.getElementById("message1"), 70);
      await wait(100);
      await setup({ autoResumeVideo: false });
      await reveal(pair.chat);
      await check(
        "Resume disabled keeps a revealed video paused",
        () => pair.chat.paused && clear(pair.chat),
      );
      pair.stop();
      pair = null;

      await setup({ subs: { media_videos: false, media_viewer: false } });
      pair = createPair();
      await pair.start();
      await p.WAB.sendMessage({ type: "WAB_PANIC_ENGAGE" });
      await wait(100);
      await check(
        "Full-page cover pauses both videos even when category blur is off",
        () =>
          pair.chat.paused &&
          pair.viewer.paused &&
          c.getComputedStyle(root, "::before").backdropFilter === "blur(8px)",
      );
      await p.WAB.sendMessage({ type: "WAB_PANIC_RELEASE" });
      await wait(120);
      await check(
        "Removing full-page cover resumes videos the extension paused",
        () => !pair.chat.paused && !pair.viewer.paused,
      );
      pair.stop();
      pair = null;

      await setup({ pauseVideoOnBlur: false });
      pair = createPair();
      await pair.start();
      await check(
        "Disabling pause-on-blur leaves both blurred videos playing",
        () =>
          !pair.chat.paused &&
          !pair.viewer.paused &&
          !clear(pair.chat) &&
          !clear(pair.viewer),
      );
      pair.stop();
      pair = null;
      await setup();
      const outside = c.document.createElement("video");
      outside.muted = true;
      c.document.body.append(outside);
      const stream = canvas.captureStream(12);
      outside.srcObject = stream;
      try {
        await outside.play();
        await wait(200);
        await check(
          "Unrelated videos outside protected chat and viewer surfaces remain playing",
          () => !outside.paused && clear(outside),
        );
      } finally {
        outside.pause();
        outside.remove();
        stream.getTracks().forEach((track) => track.stop());
      }
    } finally {
      pair?.stop();
      clearInterval(paint);
    }

    await setup();
    await check(
      "Text, photos, stickers and GIF thumbnails retain their default blur",
      () =>
        filter(c.document.getElementById("text1")) === "blur(8px)" &&
        filter(c.document.getElementById("chatPhoto")) === "blur(8px)" &&
        filter(c.document.getElementById("sticker")) === "blur(8px)" &&
        filter(c.document.getElementById("gifThumb")) === "blur(8px)",
    );
    await check(
      "No uncaught errors across the browser scenarios",
      () => hub.errors.length === 0,
    );
  } catch (error) {
    results.push({ name: "Unexpected error", pass: false, error: error.stack });
  }
  const passed = results.filter((r) => r.pass).length;
  document.title = `Pebble verification: ${passed}/${results.length} passed`;
  output.textContent =
    `${passed}/${results.length} browser checks passed\n\n` +
    results
      .map(
        (r) =>
          `${r.pass ? "PASS" : "FAIL"} ${r.name}${r.error ? ": " + r.error : ""}`,
      )
      .join("\n");
  window.results = results;
};
