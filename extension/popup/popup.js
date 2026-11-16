"use strict";

const { h, icon, cap, keycaps, switchEl, segmented, slider, shortcutField, statusBinder } =
  PebbleUI;
const $ = (id) => document.getElementById(id);
const save = (mutate, options) => PebbleStore.set(mutate, options);
const toggle = (label, key) =>
  switchEl({
    label,
    onChange: (on) =>
      save((p) => {
        p[key] = on;
      }),
  });

// ---------- Tabs ----------
const TABS = [
  ["blur", "Blur", "droplet"],
  ["peek", "Peek", "eye"],
  ["cover", "Cover", "shield"],
  ["pebble", "Pebble", "pebble"],
  ["settings", "Settings", "settings-2"],
];
const tabList = $("tabs");
const tabs = TABS.map(([id, label, iconName]) => {
  const button = h(
    "button",
    {
      type: "button",
      role: "tab",
      id: `tab-${id}`,
      class: "tab seg-btn",
      "aria-controls": `pane-${id}`,
      onclick: () => {
        history.replaceState(null, "", `#${id}`);
        route();
      },
    },
    icon(iconName),
    h("span", {}, label),
  );
  tabList.append(button);
  return { id, button, pane: $(`pane-${id}`) };
});
tabList.style.setProperty("--n", TABS.length);
function route() {
  const wanted = location.hash.slice(1);
  const index = Math.max(0, tabs.findIndex((tab) => tab.id === wanted));
  tabList.style.setProperty("--i", index);
  tabs.forEach((tab, i) => {
    const active = i === index;
    tab.pane.hidden = !active;
    tab.pane.tabIndex = active ? 0 : -1;
    tab.button.setAttribute("aria-selected", String(active));
    tab.button.tabIndex = active ? 0 : -1;
  });
  document.querySelector(".content").scrollTop = 0;
  updateFade();
}
// The bottom fade only belongs on a pane that actually overflows.
const content = document.querySelector(".content");
function updateFade() {
  const cut = content.scrollHeight - content.clientHeight;
  content.classList.toggle("fade", cut > 1 && content.scrollTop < cut - 1);
}
content.addEventListener("scroll", updateFade, { passive: true });
// Panes resize when accordions, paste box or messages appear or collapse.
const fadeWatcher = new ResizeObserver(updateFade);
fadeWatcher.observe(content);
tabs.forEach((tab) => fadeWatcher.observe(tab.pane));
tabList.addEventListener("keydown", (event) => {
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[
    event.key
  ];
  if (!step) return;
  event.preventDefault();
  const at = tabs.findIndex((tab) => tab.button === document.activeElement);
  const next =
    step === -Infinity
      ? tabs[0]
      : step === Infinity
        ? tabs[tabs.length - 1]
        : tabs[(at + step + tabs.length) % tabs.length];
  location.hash = next.id;
  next.button.focus();
});
addEventListener("hashchange", route);
route();

// ---------- Header ----------
PebbleStore.onStatus(statusBinder($("status")));
$("master").addEventListener("change", (event) =>
  save((p) => {
    p.on = event.target.checked;
  }),
);
$("panic").addEventListener("click", () => PebbleStore.togglePanic());

// ---------- Credit ----------
const CREDIT_LINKS = [
  {
    label: "GitHub",
    href: "https://github.com/fahadmalik5509",
    icon: "github",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/fahadmalik5509",
    icon: "linkedin",
  },
];
const credit = $("credit");
credit.append(
  "with",
  h("span", { class: "heart" }, icon("heart")),
  "from",
  h("b", {}, "Fahad"),
);
for (const { label, href, icon: name } of CREDIT_LINKS) {
  if (!href) continue;
  credit.append(
    h(
      "a",
      {
        href,
        title: label,
        "aria-label": label,
        target: "_blank",
        rel: "noreferrer",
      },
      icon(name),
    ),
  );
}

// Returns [label, state] for the header card.
function describeState(p, panic) {
  if (!p.on) return ["Off", "off"];
  if (panic) return ["Covered", "covered"];
  return ["Blurred", "blurred"];
}

// ---------- Blur: strength ----------
const level = segmented({
  label: "Blur strength",
  className: "levels",
  buttonClass: "level",
  thumb: false,
  options: WAB.LEVELS.map((value) => {
    const px = WAB.blurFor({ level: value });
    const sample = h(
      "span",
      { class: "level-sample", "aria-hidden": "true" },
      h("span", { class: "sample-avatar" }, "A"),
      h(
        "span",
        { class: "sample-chat" },
        h("span", { class: "sample-bubble" }, "Hey!"),
        h("span", { class: "sample-bubble reply" }, "On it"),
      ),
    );
    // Preview at a third of the real strength so High still shows texture.
    sample.style.setProperty("--b", `${Math.max(1, Math.round(px / 3))}px`);
    return {
      value,
      ariaLabel: `${cap(value)}, ${px} pixels`,
      content: [
        sample,
        h("span", { class: "level-name" }, cap(value), h("small", { class: "num" }, `${px} px`)),
      ],
    };
  }),
  onChange: (value) =>
    save((p) => {
      p.level = value;
    }),
});
$("levelMount").append(level.el);

// ---------- Blur: what to blur ----------
const groups = WAB.ORDER.map((id) => {
  const group = WAB.GROUP[id];
  const children = group.children || [];
  const sw = switchEl({
    label: `Blur ${group.label.toLowerCase()}`,
    onChange: (on) =>
      save((p) => {
        WAB.setGroup(p, id, on);
      }),
  });
  const caption = h("span", { class: "acc-cap num" });
  const face = [
    h("span", { class: "tile-icon" }, icon(group.icon)),
    h(
      "span",
      { class: "acc-text" },
      h("span", { class: "acc-title" }, group.label),
      h("span", { class: "acc-desc", title: group.desc }, group.desc),
    ),
    caption,
  ];
  const leaves = children.map((leaf) => {
    const leafSwitch = switchEl({
      label: leaf.label,
      small: true,
      onChange: (on) =>
        save((p) => {
          WAB.setLeaf(p, leaf.id, on);
        }),
    });
    const row = h(
      "label",
      { class: "sub" },
      h(
        "span",
        { class: "sub-text" },
        h("span", { class: "sub-label" }, leaf.label),
        h("span", { class: "sub-desc" }, leaf.desc),
      ),
      leafSwitch.el,
    );
    return { leaf, row, sw: leafSwitch };
  });
  const subs = h("div", { class: "subs" }, leaves.map((l) => l.row));
  const inner = h("div", { class: "acc-inner" }, subs);
  inner.inert = true;
  const head = h(
    "button",
    {
      type: "button",
      class: "acc-toggle",
      "aria-expanded": "false",
      "aria-controls": `acc-${id}`,
      onclick: () => setOpen(id),
    },
    face,
    icon("chevron-down", "acc-chev"),
  );
  const el = h(
    "div",
    { class: "acc", "data-open": "false" },
    h("div", { class: "acc-head" }, head, sw.el),
    h("div", { class: "acc-body", id: `acc-${id}` }, inner),
  );
  $("groups").append(el);
  return { id, el, head, inner, subs, caption, sw, leaves };
});
let openGroup = null;
function setOpen(id) {
  openGroup = openGroup === id ? null : id;
  for (const g of groups) {
    const open = g.id === openGroup;
    g.el.dataset.open = String(open);
    g.head.setAttribute("aria-expanded", String(open));
    g.inner.inert = !open;
  }
}

// ---------- Blur: videos ----------
const pause = toggle("Pause blurred videos", "pauseVideoOnBlur");
const resume = toggle("Resume when revealed", "autoResumeVideo");
$("pauseMount").append(pause.el);
$("resumeMount").append(resume.el);

// ---------- Peek ----------
const MODE_DESC = {
  hover: "Point at a blurred item to read it. Move away and it blurs again.",
  click: "Click a blurred item to read it. That same click also opens it.",
  hold: "Press and hold a blurred item to read it. Let go and it blurs again. A short click opens it as usual.",
};
const mode = segmented({
  label: "How to peek",
  className: "seg wide",
  options: [
    { value: "hover", label: "Hover", icon: "mouse-pointer" },
    { value: "click", label: "Click", icon: "mouse-pointer-click" },
    { value: "hold", label: "Hold", icon: "hand" },
  ],
  onChange: (value) =>
    save((p) => {
      p.interactionMode = value;
    }),
});
$("modeMount").append(mode.el);

const delay = segmented({
  label: "Hover delay",
  className: "seg wide",
  options: [
    { value: "instant", label: "None" },
    { value: "normal", label: "150 ms" },
    { value: "relaxed", label: "300 ms" },
    { value: "custom", label: "Custom" },
  ],
  onChange: (value) =>
    save((p) => {
      p.revealDelayMode = value;
    }),
});
const customValue = h("span", { class: "range-val num" });
// Dragging previews locally; release saves once.
const customDelay = slider({
  label: "Custom hover delay",
  min: 0,
  max: 600,
  step: 10,
  onInput: (value) =>
    save(
      (p) => {
        p.revealDelayMs = value;
      },
      { persist: false },
    ),
  onChange: () => PebbleStore.commit(),
});
const customRow = h(
  "div",
  { class: "range" },
  h("div", { class: "range-head" }, h("span", { class: "range-title" }, "Custom wait"), customValue),
  customDelay.el,
);
$("delayMount").append(delay.el, customRow);

const autoHide = segmented({
  label: "Blur again after",
  className: "seg wide",
  options: WAB.AUTO_HIDE_CHOICES.map((sec) => ({
    value: sec,
    label: sec === 0 ? "Never" : sec < 60 ? `${sec} s` : `${sec / 60} min`,
  })),
  onChange: (value) =>
    save((p) => {
      p.autoHideSec = value;
    }),
});
$("autoHideMount").append(autoHide.el);

// ---------- Cover ----------
const onLoad = toggle("Cover when WhatsApp opens", "coverOnLoad");
const clickRelease = toggle("Click to uncover", "coverClickRelease");
$("onLoadMount").append(onLoad.el);
$("clickReleaseMount").append(clickRelease.el);

const IDLE_SECONDS = [0, 5, 10, 15, 30, 45, 60];
const idleGroup = h("div", { class: "chips", role: "radiogroup", "aria-label": "After inactivity" });
const idleChips = new Map();
function idleRender(prefs) {
  const saved = prefs.idleTimeoutSec;
  const values = IDLE_SECONDS.includes(saved)
    ? IDLE_SECONDS
    : [...IDLE_SECONDS, saved].sort((a, b) => a - b);
  const sig = values.join(',');
  if (idleGroup.dataset.values !== sig) {
    idleGroup.dataset.values = sig;
    idleChips.clear();
    idleGroup.replaceChildren(
      ...values.map((sec) => {
        const chip = h(
          "button",
          {
            type: "button",
            role: "radio",
            class: "chip",
            "data-sec": sec,
            "aria-label": sec ? `${sec} seconds` : "Off",
            onclick: () =>
              save((p) => {
                p.idleTimeoutSec = sec;
              }),
          },
          sec === 0 ? "Off" : sec < 60 ? `${sec} s` : `${sec / 60} min`,
        );
        idleChips.set(sec, chip);
        return chip;
      }),
    );
  }
  for (const [sec, chip] of idleChips) {
    const on = sec === saved;
    chip.setAttribute("aria-checked", String(on));
    chip.tabIndex = on ? 0 : -1;
  }
}
PebbleUI.roving(idleGroup, ".chip", (chips, next) => {
  chips[next].focus();
  chips[next].click();
});
$("idleMount").append(idleGroup);

const COVER = "cover WhatsApp";
const POWER = "turn Pebble on or off";
function hotkeyProblem(kind, combo) {
  const p = PebbleStore.prefs;
  if (combo === (kind === "panic" ? p.toggleHotkey : p.panicHotkey))
    return `Already used to ${kind === "panic" ? POWER : COVER}.`;
  if (/^(Ctrl|Meta)\+(?:[LWTNRPFD]|Shift\+[TWN])$/.test(combo))
    return "The browser keeps this one for itself. Try another.";
  return "";
}
const panicField = shortcutField({
  label: "Cover WhatsApp",
  defaultValue: WAB.DEFAULT_PANIC,
  clearable: false,
  getValue: () => PebbleStore.prefs.panicHotkey,
  validate: (combo) => hotkeyProblem("panic", combo),
  onSave: (combo) =>
    save((p) => {
      p.panicHotkey = combo;
    }),
});
const toggleField = shortcutField({
  label: "Turn Pebble on or off",
  defaultValue: "",
  clearable: true,
  getValue: () => PebbleStore.prefs.toggleHotkey,
  validate: (combo) => hotkeyProblem("toggle", combo),
  onSave: (combo) =>
    save((p) => {
      p.toggleHotkey = combo;
    }),
});
$("coverShortcutMount").append(panicField.el);
$("toggleMount").append(toggleField.el);

// ---------- Pebble ----------
const MAX_TIMERS = 3;
const pebble = toggle("Show Pebble", "pebbleEnabled");
$("pebbleMount").append(pebble.el);
const timerList = $("pebbleTimers");
const timerAdd = $("pebbleTimerAdd");
const timerError = $("pebbleTimersError");
timerAdd.prepend(icon("plus"));
const savedTimer = (input) => PebbleStore.prefs.pebbleTimers[Number(input.dataset.index)];

function clearTimerError(edited = null) {
  timerError.textContent = "";
  for (const input of timerList.querySelectorAll("input")) {
    if (input !== edited && input.hasAttribute("aria-invalid")) input.value = savedTimer(input);
    input.removeAttribute("aria-invalid");
  }
}
function saveTimer(input) {
  const index = Number(input.dataset.index);
  const seconds = input.valueAsNumber;
  const timers = PebbleStore.prefs.pebbleTimers;
  const problem =
    !Number.isInteger(seconds) || seconds < 1 || seconds > 3600
      ? "Use a whole number from 1 to 3600."
      : timers.some((value, i) => i !== index && value === seconds)
        ? "Each timer needs a different time."
        : "";
  clearTimerError(input);
  if (problem) {
    input.setAttribute("aria-invalid", "true");
    timerError.textContent = problem;
    return;
  }
  input.value = seconds;
  if (timers[index] !== seconds)
    save((p) => {
      p.pebbleTimers[index] = seconds;
    });
}
function renderTimers(timers) {
  if (timerList.childElementCount !== timers.length) {
    clearTimerError();
    timerList.replaceChildren(
      ...timers.map((_, index) =>
        h(
          "div",
          { class: "timer" },
          h("input", {
            type: "number",
            min: 1,
            max: 3600,
            step: 1,
            required: true,
            inputmode: "numeric",
            "data-index": index,
            "aria-label": `Timer ${index + 1}, in seconds`,
            "aria-describedby": "pebbleTimersError",
          }),
          h("span", { class: "timer-unit", "aria-hidden": "true" }, "s"),
          h(
            "button",
            { type: "button", class: "timer-remove", "data-remove": index, title: "Remove" },
            icon("x"),
          ),
        ),
      ),
    );
  }
  [...timerList.children].forEach((timerEl, index) => {
    const input = timerEl.querySelector("input");
    if (document.activeElement !== input) {
      input.value = timers[index];
      input.removeAttribute("aria-invalid");
    }
    timerEl.querySelector("button").setAttribute("aria-label", `Remove the ${timers[index]} second timer`);
  });
  timerAdd.hidden = timers.length >= MAX_TIMERS;
  $("pebbleTimersEmpty").hidden = timers.length !== 0;
  $("pebbleTimersCount").textContent = `${timers.length} of ${MAX_TIMERS} set`;
  if (!timerList.querySelector('[aria-invalid="true"]')) timerError.textContent = "";
}
timerList.addEventListener("change", (event) => {
  if (event.target.matches("input")) saveTimer(event.target);
});
timerList.addEventListener("input", (event) => clearTimerError(event.target));
timerList.addEventListener("keydown", (event) => {
  const input = event.target;
  if (!input.matches("input")) return;
  if (event.key === "Enter") {
    event.preventDefault();
    saveTimer(input);
  } else if (event.key === "Escape") {
    event.preventDefault();
    input.value = savedTimer(input);
    clearTimerError();
  }
});
timerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const index = Number(button.dataset.remove);
  clearTimerError();
  save((p) => {
    p.pebbleTimers.splice(index, 1);
  });
  const inputs = timerList.querySelectorAll("input");
  (inputs[Math.min(index, inputs.length - 1)] || timerAdd).focus();
});
timerAdd.addEventListener("click", () => {
  if (PebbleStore.prefs.pebbleTimers.length >= MAX_TIMERS) return;
  clearTimerError();
  save((p) => {
    p.pebbleTimers.push([5, 10, 15, 30, 60].find((s) => !p.pebbleTimers.includes(s)));
  });
  const input = timerList.querySelector(".timer:last-child input");
  input.focus();
  input.select();
});
$("pebbleResetPosition").addEventListener("click", async () => {
  const message = $("pebblePositionMsg");
  try {
    await chrome.storage.local.remove("pebblePosition");
    message.className = "form-msg ok";
    message.textContent = "Pebble is back in its corner.";
  } catch (error) {
    message.className = "form-msg error";
    message.textContent = error.message || "Couldn't reset the position. Try again.";
  }
});

// ---------- Settings ----------
const theme = segmented({
  label: "Theme",
  small: true,
  options: [
    { value: "system", label: "Auto", icon: "monitor", title: "Match system", ariaLabel: "Match system" },
    { value: "light", label: "Light", icon: "sun", title: "Light", ariaLabel: "Light" },
    { value: "dark", label: "Dark", icon: "moon", title: "Dark", ariaLabel: "Dark" },
  ],
  onChange: (value) =>
    save((p) => {
      p.theme = value;
    }),
});
$("themeMount").append(theme.el);

// Backup format marker. Old backups import with it.
const BACKUP_FORMAT = "pebble-settings";
const messenger = (id) => (text, kind = "") => {
  const el = $(id);
  el.textContent = text;
  el.className = `form-msg ${kind}`.trim();
};
const say = messenger("importMsg");
const sayExport = messenger("exportMsg");
const backup = () =>
  JSON.stringify({ format: BACKUP_FORMAT, version: 2, prefs: PebbleStore.prefs }, null, 2);
$("exportCopy").append(icon("copy"), "Copy");
$("exportFile").append(icon("download"), "Download");
$("importFile").append(icon("upload"), "Choose file");
$("importPaste").append(icon("clipboard-paste"), h("span", {}, "Paste"));
$("exportCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(backup());
    sayExport("Copied to the clipboard.", "ok");
  } catch {
    sayExport("Couldn't copy. Use Download instead.", "error");
  }
});
$("exportFile").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([backup()], { type: "application/json" }));
  h("a", { href: url, download: "pebble-settings.json" }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  sayExport("Backup downloaded.", "ok");
});
function importText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return say("That doesn't look like a Pebble backup.", "error");
  }
  if (
    data?.format !== BACKUP_FORMAT ||
    data.version !== 2 ||
    !data.prefs ||
    typeof data.prefs !== "object"
  )
    return say("That isn't a Pebble backup.", "error");
  PebbleStore.replace(data.prefs);
  showPasteBox(false);
  $("importText").value = "";
  say("Settings imported.", "ok");
}
function showPasteBox(show) {
  $("importBox").hidden = !show;
  $("importPaste").setAttribute("aria-expanded", String(show));
  $("importPaste").replaceChildren(
    icon(show ? "x" : "clipboard-paste"),
    h("span", {}, show ? "Cancel" : "Paste"),
  );
  if (show) {
    $("importText").focus();
  } else {
    $("importText").value = "";
    $("importPaste").focus();
  }
}
$("importFile").addEventListener("click", () => $("importInput").click());
$("importInput").addEventListener("change", async () => {
  const file = $("importInput").files[0];
  $("importInput").value = "";
  if (file) importText(await file.text());
});
$("importPaste").addEventListener("click", () => showPasteBox($("importBox").hidden));
$("importApply").addEventListener("click", () => importText($("importText").value));

let resetTimer = null;
const resetButton = $("reset");
function disarmReset() {
  clearTimeout(resetTimer);
  resetButton.classList.remove("armed");
  $("resetMsg").textContent = "";
}
resetButton.addEventListener("click", () => {
  if (!resetButton.classList.contains("armed")) {
    resetButton.classList.add("armed");
    $("resetMsg").textContent = "Press Reset again to confirm.";
    resetTimer = setTimeout(disarmReset, 4000);
    return;
  }
  disarmReset();
  const { on, theme: savedTheme } = PebbleStore.prefs;
  PebbleStore.replace({ on, theme: savedTheme });
});

$("version").textContent = `v${chrome.runtime.getManifest().version}`;

function render() {
  const p = PebbleStore.prefs;
  const panic = PebbleStore.panic;
  const summaries = groups.map((g) => WAB.groupSummary(p, g.id));
  const groupsOn = summaries.filter((s) => s.active).length;

  $("master").checked = p.on;
  const [label, state] = describeState(p, panic);
  $("hero").dataset.state = state;
  $("powerLabel").textContent = label;

  level.set(p.level);
  $("groupsCount").textContent = `${groupsOn} of ${groups.length} groups on`;
  groups.forEach((g, i) => {
    const info = summaries[i];
    g.el.dataset.on = String(info.active);
    g.sw.set(info.active);
    // The switch already says on or off; the chip only adds a partial count.
    g.caption.textContent = info.active && info.on < info.total ? info.caption : "";
    const groupOff = !p.toggles[g.id];
    g.subs.dataset.disabled = String(groupOff);
    for (const { leaf, row, sw } of g.leaves) {
      const active = !!p.toggles[leaf.id];
      sw.set(active);
      sw.disabled(groupOff);
      row.dataset.off = String(!active);
    }
  });
  pause.set(p.pauseVideoOnBlur);
  resume.set(p.autoResumeVideo);
  resume.disabled(!p.pauseVideoOnBlur);
  resume.el.closest(".row")?.setAttribute("data-disabled", String(!p.pauseVideoOnBlur));
  $("resumeDesc").textContent = p.pauseVideoOnBlur
    ? "A paused video plays again when you reveal it."
    : "Needs “Pause blurred videos” on.";

  mode.set(p.interactionMode);
  $("modeDesc").textContent = MODE_DESC[p.interactionMode];
  $("autoHideNote").textContent =
    p.autoHideSec === 0
      ? "Revealed items stay visible until you move away."
      : "A revealed item blurs again after this long. A video that is playing stays visible.";
  $("delayBlock").hidden = p.interactionMode !== "hover";
  delay.set(p.revealDelayMode);
  customRow.hidden = p.revealDelayMode !== "custom";
  customDelay.set(p.revealDelayMs);
  customValue.replaceChildren(String(p.revealDelayMs), h("small", {}, "ms"));
  autoHide.set(p.autoHideSec);

  onLoad.set(p.coverOnLoad);
  clickRelease.set(p.coverClickRelease);
  idleRender(p);
  panicField.update();
  toggleField.update();

  pebble.set(p.pebbleEnabled);
  renderTimers(p.pebbleTimers);
  // Timer and position controls only matter while the helper is on.
  const pebbleOff = !p.pebbleEnabled;
  for (const card of document.querySelectorAll("[data-pebble-deps]")) {
    card.dataset.disabled = String(pebbleOff);
    for (const el of card.querySelectorAll("input, button")) el.disabled = pebbleOff;
  }
  theme.set(p.theme);

  const cover = $("panic");
  cover.setAttribute("aria-pressed", String(panic));
  cover.disabled = !p.on;
  cover.title = p.on ? "" : "Turn Pebble on to cover";
  $("panicIcon").replaceChildren(icon(panic ? "eye" : "eye-off"));
  $("panicLabel").textContent = panic
    ? "Uncover WhatsApp"
    : p.on
      ? "Cover WhatsApp"
      : "Pebble is off";
  $("panicKeys").replaceChildren(p.on ? keycaps(p.panicHotkey) : []);
  updateFade();
}
PebbleStore.onChange(render);
PebbleStore.init()
  .then(() => {
    document.body.dataset.ready = "true";
  })
  .catch((error) => {
    document.body.dataset.ready = "true";
    $("status").classList.add("error");
    $("status").textContent = error?.message || "Couldn't load settings.";
  });
