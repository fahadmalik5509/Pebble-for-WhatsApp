"use strict";

// Small, framework-free controls for the popup.
globalThis.PebbleUI = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const cap = (s) => s[0].toUpperCase() + s.slice(1);

  // ---------- DOM ----------
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "class") node.className = value;
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  }
  function icon(name, cls = "") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute(
      "viewBox",
      PEBBLE_ICON_META?.[name]?.viewBox ?? "0 0 24 24",
    );
    svg.setAttribute("class", `ic ${cls}`.trim());
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = PEBBLE_ICONS[name] || "";
    return svg;
  }

  // ---------- Keys ----------
  const isMac = /Mac|iPhone|iPad/i.test(
    navigator.userAgentData?.platform || navigator.platform || "",
  );
  const KEY_LABEL = isMac
    ? { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
    : { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };
  const MODIFIERS = { Ctrl: "ctrlKey", Alt: "altKey", Shift: "shiftKey", Meta: "metaKey" };
  const keyLabel = (key) => KEY_LABEL[key] || key;
  const keyText = (combo) => (combo ? combo.split("+").map(keyLabel).join(isMac ? "" : "+") : "");
  function keycaps(combo) {
    return h(
      "span",
      { class: "keys" },
      (combo ? combo.split("+") : []).map((part) =>
        h("kbd", { class: "key" }, keyLabel(part)),
      ),
    );
  }

  // ---------- Switch ----------
  function switchEl({ label, small = false, onChange }) {
    const input = h("input", { type: "checkbox", "aria-label": label });
    const el = h("span", { class: small ? "switch sm" : "switch" }, input, h("i"));
    input.addEventListener("change", () => onChange?.(input.checked));
    return {
      el,
      set(checked) {
        input.checked = checked;
      },
      disabled(value) {
        input.disabled = value;
      },
    };
  }

  // ---------- Radio group ----------
  // One tab stop; arrows, Home and End move the choice. Each option takes a
  // label and icon, or its own `content` nodes. `thumb` adds the sliding pill.
  // Shared roving-tabindex keyboard model for radio-style groups.
  function roving(root, itemSelector, onPick) {
    const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    root.addEventListener("keydown", (event) => {
      const items = [...root.querySelectorAll(itemSelector)];
      const at = items.indexOf(document.activeElement);
      const next =
        event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
        : event.key in STEP
          ? (Math.max(at, 0) + STEP[event.key] + items.length) % items.length
          : null;
      if (next === null) return;
      event.preventDefault();
      onPick(items, next);
    });
  }

  function segmented({
    label,
    options,
    onChange,
    small = false,
    thumb = true,
    className = "seg",
    buttonClass = "seg-btn",
  }) {
    const root = h("div", {
      class: [className, small && "sm"].filter(Boolean).join(" "),
      role: "radiogroup",
      "aria-label": label,
    });
    root.style.setProperty("--n", options.length);
    if (thumb) root.append(h("span", { class: "seg-thumb", "aria-hidden": "true" }));
    let value = null;
    const buttons = options.map((option) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          class: buttonClass,
          title: option.title,
          "aria-label": option.ariaLabel,
          onclick: () => choose(option.value),
        },
        option.content ?? [
          option.icon ? icon(option.icon) : null,
          option.label ? h("span", {}, option.label) : null,
        ],
      ),
    );
    root.append(...buttons);
    function choose(next) {
      if (next === value) return;
      set(next);
      onChange?.(next);
    }
    function set(next) {
      value = next;
      const index = Math.max(0, options.findIndex((o) => o.value === next));
      root.style.setProperty("--i", index);
      buttons.forEach((button, i) => {
        button.setAttribute("aria-checked", String(i === index));
        button.tabIndex = i === index ? 0 : -1;
      });
    }
    roving(root, "." + buttonClass, (items, next) => {
      choose(options[next].value);
      items[next].focus();
    });
    return { el: root, set };
  }

  // ---------- Slider ----------
  function slider({ label, min, max, step = 1, onInput, onChange }) {
    const input = h("input", {
      type: "range",
      min,
      max,
      step,
      "aria-label": label,
    });
    const el = h("div", { class: "slider" }, input);
    const paint = () => {
      const frac = (Number(input.value) - min) / (max - min);
      input.style.setProperty("--p", `calc(10px + (100% - 20px) * ${frac})`);
    };
    input.addEventListener("input", () => {
      paint();
      onInput?.(Number(input.value));
    });
    input.addEventListener("change", () => onChange?.(Number(input.value)));
    return {
      el,
      set(value) {
        if (Number(input.value) !== value) input.value = value;
        paint();
      },
    };
  }

  // ---------- Shortcut recorder ----------
  // Click to record. Held modifiers show as you press them. Esc cancels.
  function shortcutField({ label, defaultValue, clearable, validate, onSave, getValue }) {
    const display = h("span");
    const hint = h("span", { class: "shortcut-hint" });
    const field = h(
      "button",
      { type: "button", class: "shortcut-field", "aria-label": `Change shortcut: ${label}` },
      display,
      hint,
    );
    const resetBtn = h(
      "button",
      { type: "button", class: "btn sm ghost", onclick: () => save(defaultValue) },
      "Reset",
    );
    const clearBtn = h(
      "button",
      { type: "button", class: "btn sm ghost", onclick: () => save("") },
      "Clear",
    );
    const message = h("p", { class: "shortcut-msg", role: "status", "aria-live": "polite" });
    const el = h(
      "div",
      { class: "shortcut", "data-state": "idle" },
      h("div", { class: "shortcut-line" }, field, resetBtn, clearable ? clearBtn : null),
      message,
    );
    let recording = false;

    const say = (text, error = false) => {
      message.textContent = text;
      message.classList.toggle("error", error);
    };
    function save(combo) {
      const problem = combo && validate?.(combo);
      if (problem) return say(problem, true);
      stop();
      onSave(combo);
      say("");
    }
    function render(held = []) {
      el.dataset.state = recording ? "recording" : "idle";
      const combo = getValue();
      if (recording) {
        display.replaceChildren(
          ...held.map((part) => h("kbd", { class: "key" }, keyLabel(part))),
          h("kbd", { class: "key ghost" }, "…"),
        );
        hint.textContent = held.length ? "Now a letter or number" : "Press keys";
      } else if (combo) {
        display.replaceChildren(keycaps(combo));
        hint.textContent = "Change";
      } else {
        display.replaceChildren();
        hint.textContent = "Set shortcut";
      }
      el.dataset.empty = String(!recording && !combo);
      resetBtn.hidden = recording || combo === defaultValue;
      clearBtn.hidden = recording || !combo;
      field.setAttribute(
        "aria-label",
        `Shortcut for ${label}: ${recording ? "recording" : combo || "not set"}`,
      );
    }
    function start() {
      recording = true;
      say(clearable ? "Esc cancels. Backspace clears." : "Esc cancels.");
      render();
      field.focus();
    }
    function stop() {
      recording = false;
      render();
    }
    const held = (event) => Object.keys(MODIFIERS).filter((m) => event[MODIFIERS[m]]);
    field.addEventListener("click", () => (recording ? stop() : start()));
    field.addEventListener("blur", () => {
      if (!recording) return;
      stop();
      say("");
    });
    field.addEventListener("keyup", (event) => recording && render(held(event)));
    field.addEventListener("keydown", (event) => {
      if (!recording || event.key === "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stop();
        return say("");
      }
      if (["Alt", "Control", "Shift", "Meta"].includes(event.key)) return render(held(event));
      if (event.key === "Backspace" || event.key === "Delete") {
        if (clearable) return save("");
        return say(`This one can't be empty. Reset brings back ${keyText(defaultValue)}.`, true);
      }
      const combo = WAB.eventHotkey(event);
      if (!combo) {
        render(held(event));
        return say(`Hold ${isMac ? "⌃, ⌥ or ⌘" : "Ctrl or Alt"}, then press a letter or number.`, true);
      }
      save(combo);
    });
    return { el, update: () => !recording && render() };
  }

  // ---------- Save status ----------
  function statusBinder(box) {
    let timer = null;
    return (state, message) => {
      clearTimeout(timer);
      box.classList.toggle("error", state === "error");
      if (state === "saving") box.replaceChildren("Saving…");
      else if (state === "saved") {
        box.replaceChildren(icon("check"), "Saved");
        timer = setTimeout(() => box.replaceChildren(), 1400);
      } else box.replaceChildren(message);
    };
  }

  return {
    h,
    icon,
    cap,
    keycaps,
    switchEl,
    segmented,
    roving,
    slider,
    shortcutField,
    statusBinder,
  };
})();
