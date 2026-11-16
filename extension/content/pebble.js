"use strict";

// Pebble, the on-page helper. It owns its gestures and its look. The content
// script owns reveal permission, storage and the shared video reveal state.
//
// Performance model:
// - Idle motion (breathing, blinking, snoozing, the awake aura) is CSS
//   keyframes on transform and opacity, so it runs on the compositor with no
//   script and no DOM writes.
// - Gesture motion runs in one requestAnimationFrame loop that writes a few
//   CSS variables per frame and stops as soon as every spring settles.
// - The timer ring is one Web Animation with stepped easing, and the countdown
//   text changes once per second.
WAB.createPebble = ({
  parent,
  position: initialPosition,
  onPosition = () => {},
  onReveal = () => {},
  onActivity = () => {},
  canReveal = () => true,
  onError = () => {},
}) => {
  const HOLD_MS = 230; // press this long to peek and open the timers
  const CHOICE_MS = 800; // timers close after this unless one is highlighted
  const DRAG_PX = 6; // move this far before the hold fires to drag instead
  const FAN_RADIUS = 88;
  const FAN_STEP = 0.8; // radians between timer bubbles
  const FAN_GAP = 49; // minimum distance between timer bubbles
  const FAN_STAGGER_MS = 55;
  const HIT_PX = 34;
  const MARGIN = 40;
  const HOP = 16;
  const RING = 2 * Math.PI * 36; // timer ring circumference

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const normalizePosition = (value) =>
    value && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) }
      : { x: 0.82, y: 0.76 };

  // Semi-implicit Euler spring. It snaps to rest once it is close enough, so
  // a settled spring reports `moving === false` and the frame loop can stop.
  class Spring {
    constructor(k, damping) {
      this.k = k;
      this.damping = damping;
      this.x = this.t = this.v = 0;
    }
    step(dt) {
      this.v += (this.k * (this.t - this.x) - this.damping * this.v) * dt;
      this.x += this.v * dt;
      if (!this.moving) {
        this.x = this.t;
        this.v = 0;
      }
      return this.x;
    }
    get moving() {
      return Math.abs(this.t - this.x) > 0.001 || Math.abs(this.v) > 0.01;
    }
  }

  // ---------- Look ----------
  // Geometry matches the popup mascot (viewBox 96x88) drawn at 5/6 scale, so
  // the body sits centred in the 64 px hit area.
  const CSS = `
    :host { color-scheme: light dark; }
    *, *::before, *::after { box-sizing: border-box; }
    button { all: unset; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    .pebble {
      position: absolute; left: 0; top: 0; width: 0; height: 0;
      pointer-events: none; will-change: transform;
      --p: 0; --r: 0; --m: 0; --l: 0; --px: 0; --py: 0;
      --ink: #4a1b1d;
      --r1: clamp(0, var(--r), 1);
      --asleep: clamp(0, 1 - var(--r) * 2, 1);
    }

    .ball {
      position: absolute; left: -32px; top: -32px; width: 64px; height: 64px;
      border-radius: 50%; pointer-events: auto; cursor: grab;
      touch-action: none; user-select: none; -webkit-user-select: none;
      will-change: transform;
    }
    .ball:active { cursor: grabbing; }
    .ball:focus-visible, .tb:focus-visible { outline: 2px solid #ff6a62; outline-offset: 5px; }
    .ball i, .ball b, .ball svg { position: absolute; display: block; pointer-events: none; }

    /* Awake aura: a soft coral halo that says "content is visible". */
    .aura {
      inset: -14px; border-radius: 50%;
      background: radial-gradient(closest-side, rgb(255 122 92 / 0.38), rgb(255 122 92 / 0.12) 62%, transparent);
      opacity: var(--r1);
    }
    .pebble:not([data-mood="asleep"]) .aura { animation: aura 2.6s ease-in-out infinite; }

    /* Ground shadow: shrinks and fades as Pebble lifts while dragging. */
    .sh {
      left: 11px; top: 55px; width: 42px; height: 8px;
      translate: 0 calc(var(--l) * 6px);
      scale: calc(1 - 0.3 * var(--l));
      opacity: calc(1 - 0.55 * var(--l));
    }
    .sh i {
      inset: 0; border-radius: 50%;
      background: radial-gradient(closest-side, rgb(40 10 14 / 0.34), transparent);
      animation: shadow 4.2s ease-in-out infinite;
    }

    /* Timer ring drains once over the chosen time. */
    .ring {
      left: -8px; top: -8px; width: 80px; height: 80px; overflow: visible;
      opacity: clamp(0, var(--m), 1);
      scale: calc(0.82 + 0.18 * clamp(0, var(--m), 1.1));
    }
    .ring circle { fill: none; stroke-width: 3; }
    .ring .track { stroke: rgb(255 106 98 / 0.22); }
    .ring .prog { stroke: #ff6a62; stroke-linecap: round; stroke-dasharray: ${RING.toFixed(2)}; }

    .lift { inset: 0; translate: 0 calc(var(--l) * -5px); }
    .f {
      inset: 0; transform-origin: 50% 90%;
      animation: breathe 4.2s ease-in-out infinite;
    }
    .body {
      left: -8px; top: -8px; width: 80px; height: 73.33px; overflow: visible;
      filter: drop-shadow(0 5px 7px rgb(110 25 35 / 0.26));
    }

    .hl {
      left: 12.8px; top: 12px; width: 15px; height: 8.3px; border-radius: 50%;
      background: radial-gradient(closest-side, rgb(255 255 255 / 0.8), rgb(255 255 255 / 0.3) 60%, transparent);
      rotate: -24deg;
      translate: calc(var(--px) * 2.5px) calc(var(--py) * 1.5px);
    }
    .ck {
      left: 10px; top: 38.7px; width: 8.4px; height: 5px; border-radius: 50%;
      background: radial-gradient(closest-side, rgb(255 63 107 / 0.62), transparent);
      opacity: calc(0.75 + 0.25 * var(--r1));
      transition: scale 0.25s;
    }
    .ck.r { left: 45.6px; }

    /* Eyes follow the pointer. Each holds a closed arc and an open eye. */
    .pe {
      left: 16px; top: 28px; width: 12px; height: 12px;
      transform: translate(calc(var(--px) * 5px), calc(var(--py) * 3.5px));
    }
    .pe.r { left: 36px; }
    .shut {
      left: 0; top: 4px; width: 12px; height: 6px; overflow: visible;
      opacity: var(--asleep);
      scale: 1 clamp(0.3, 1 - var(--r), 1);
      transition: translate 0.3s cubic-bezier(0.34, 1.4, 0.5, 1);
    }
    .shut path, .pm path { fill: none; stroke: var(--ink); stroke-linecap: round; }
    .shut path { stroke-width: 2.8; }
    .open {
      left: 2.3px; top: 1.3px; width: 7.4px; height: 9.4px; border-radius: 50%;
      background: radial-gradient(circle at 60% 32%, #5c2523, #2a0f0e 72%);
      scale: 1 clamp(0, var(--r), 1.2);
      opacity: clamp(0, var(--r) * 3, 1);
    }
    .open::after {
      content: ""; position: absolute; left: 3.8px; top: 1.6px;
      width: 2.5px; height: 2.5px; border-radius: 50%; background: #fff;
    }
    .pebble:not([data-mood="asleep"]) .open { animation: blink 5.4s infinite; }
    .pe.r .open { animation-delay: 0.04s; }

    /* Mouth: a sleepy smile, a small "o" when awake, the countdown on a timer. */
    .pm {
      left: 28px; top: 41px; width: 8px; height: 4px; overflow: visible;
      opacity: calc(var(--asleep) * clamp(0, 1 - var(--m), 1));
    }
    .pm path { stroke-width: 2; }
    .mo {
      left: 29px; top: 40.4px; width: 6px; height: 4.8px;
      border-radius: 45% 45% 50% 50% / 35% 35% 65% 65%;
      background: #5b1a1a; box-shadow: inset 0 -1.4px 0 #e0566a;
      scale: clamp(0, var(--r), 1.2);
      opacity: calc(clamp(0, var(--r) * 2, 1) * clamp(0, 1 - var(--m), 1));
    }
    .n {
      left: 0; right: 0; top: 39px; text-align: center;
      font: 750 12px/12px ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
      font-variant-numeric: tabular-nums; color: var(--ink);
      scale: clamp(0, var(--m), 1.2); opacity: clamp(0, var(--m), 1);
    }

    /* Snoozing z's while blurred. Hidden while pressed or dragged. */
    .zz { left: 46px; top: 2px; opacity: clamp(0, 1 - (var(--p) + var(--l)) * 2, 1); }
    .ball .z {
      left: 0; top: 0; display: none; opacity: 0;
      font: 800 10px/1 ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
      color: #ff7a5c; text-shadow: 0 1px 2px rgb(60 10 20 / 0.25);
    }
    .z + .z { font-size: 7.5px; animation-delay: 1.7s !important; }
    .pebble[data-mood="asleep"] .z { display: block; animation: snooze 5s ease-out infinite; }
    .pebble[data-mood="asleep"] .ball:hover .shut { translate: 0 -0.9px; }
    .pebble[data-mood="asleep"] .ball:hover .ck { scale: 1.2; }

    /* Timer bubbles: small Pebbles that open their eyes when highlighted. */
    .tb {
      position: absolute; left: -22px; top: -22px; width: 44px; height: 44px;
      border-radius: 50%; pointer-events: none; touch-action: none; cursor: pointer;
      opacity: 0; --h: 0;
    }
    .tb:disabled { pointer-events: none !important; }
    .tb i, .tb span { position: absolute; pointer-events: none; scale: calc(1 + 0.3 * var(--h)); }
    .tb i {
      inset: 3px; border-radius: 50% 50% 46% 46% / 55% 55% 45% 45%;
      background:
        radial-gradient(ellipse 34% 20% at 34% 24%, rgb(255 255 255 / 0.7), transparent),
        radial-gradient(circle at 36% 26%, #ffd6c6, #ffa184 30%, #ff6a62 72%, #d93f58);
      box-shadow: inset 0 -3px 6px rgb(190 50 60 / 0.3), 0 4px 10px rgb(110 25 35 / 0.28);
    }
    .tb svg { position: absolute; inset: 0; overflow: visible; }
    .tb .bz { fill: none; stroke: var(--ink); stroke-width: 2.2; stroke-linecap: round; opacity: clamp(0, 1 - var(--h) * 2, 1); }
    .tb .bo {
      fill: #2a0f0e; transform-box: fill-box; transform-origin: center;
      scale: 1 clamp(0, var(--h), 1.2); opacity: clamp(0, var(--h) * 3, 1);
    }
    .tb span {
      inset: 0; display: grid; place-items: center; padding-top: 14px;
      font: 750 10.5px ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
      font-variant-numeric: tabular-nums; color: var(--ink);
    }

    .sr {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip-path: inset(50%); white-space: nowrap;
    }
    :host([data-paused]) *, :host([data-paused]) *::after { animation-play-state: paused !important; }

    @keyframes breathe { 50% { transform: translateY(-1.5px) scale(1.03, 0.972); } }
    @keyframes shadow { 50% { transform: scaleX(0.88); opacity: 0.72; } }
    @keyframes aura { 50% { transform: scale(1.07); opacity: 0.7; } }
    @keyframes blink { 0%, 93%, 100% { transform: none; } 95.5% { transform: scaleY(0.08); } }
    @keyframes snooze {
      0% { opacity: 0; transform: translate(0, 2px) scale(0.5); }
      14% { opacity: 0.85; }
      52% { opacity: 0; transform: translate(9px, -16px) scale(1.1) rotate(14deg); }
      100% { opacity: 0; transform: translate(9px, -16px) scale(1.1) rotate(14deg); }
    }
  `;

  const BODY = "M48 17c22 0 36 14 36 32S70 79 48 79 12 69 12 49 26 17 48 17Z";
  const SHUT_EYE = `<svg class="shut" viewBox="0 0 12 6"><path d="M1.4 1.2q4.6 4.6 9.2 0"/></svg>`;
  const MARKUP = `
    <div class="pebble" data-mood="asleep">
      <div class="timers" id="pebble-timers" role="group" aria-label="Peek timers"></div>
      <button class="ball" type="button" aria-label="Pebble: blurred"
        aria-description="Click to show or blur everything. Hold to peek. Drag to move. Down Arrow opens the timers."
        aria-pressed="false" aria-controls="pebble-timers" aria-expanded="false">
        <i class="aura" aria-hidden="true"></i>
        <i class="sh" aria-hidden="true"><i></i></i>
        <svg class="ring" viewBox="0 0 80 80" aria-hidden="true">
          <circle class="track" cx="40" cy="40" r="36"/>
          <circle class="prog" cx="40" cy="40" r="36" transform="rotate(-90 40 40)"/>
        </svg>
        <i class="lift" aria-hidden="true"><i class="f">
          <svg class="body" viewBox="0 0 96 88">
            <defs>
              <radialGradient id="pebble-body" cx="0.36" cy="0.26" r="0.86">
                <stop offset="0" stop-color="#ffd6c6"/>
                <stop offset="0.3" stop-color="#ffa184"/>
                <stop offset="0.72" stop-color="#ff6a62"/>
                <stop offset="1" stop-color="#d93f58"/>
              </radialGradient>
              <linearGradient id="pebble-rim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#fff" stop-opacity="0.4"/>
                <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <path d="${BODY}" fill="url(#pebble-body)"/>
            <path d="${BODY}" fill="none" stroke="url(#pebble-rim)" stroke-width="1.5"/>
          </svg>
          <i class="hl"></i>
          <i class="ck"></i><i class="ck r"></i>
          <i class="pe">${SHUT_EYE}<i class="open"></i></i>
          <i class="pe r">${SHUT_EYE}<i class="open"></i></i>
          <svg class="pm" viewBox="0 0 8 4"><path d="M1 1q3 2.4 6 0"/></svg>
          <i class="mo"></i>
          <b class="n"></b>
        </i></i>
        <i class="zz" aria-hidden="true"><i class="z">z</i><i class="z">z</i></i>
      </button>
      <span class="sr" role="status" aria-live="polite"></span>
    </div>`;
  const BABY_FACE = `<svg viewBox="0 0 38 38" aria-hidden="true">
      <path class="bz" d="M9.6 15.4q3.4 3.4 6.8 0M21.6 15.4q3.4 3.4 6.8 0"/>
      <g class="bo"><ellipse cx="13" cy="15.6" rx="2.5" ry="3.3"/><circle cx="14" cy="14.3" r="0.9" fill="#fff"/></g>
      <g class="bo"><ellipse cx="25" cy="15.6" rx="2.5" ry="3.3"/><circle cx="26" cy="14.3" r="0.9" fill="#fff"/></g>
    </svg>`;

  const host = document.createElement("div");
  host.id = "pebble-helper";
  // The page blurs almost everything. Shield the host from those rules.
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;display:none!important;filter:none!important;backdrop-filter:none!important;opacity:1!important;transform:none!important;--wab-reveal:0!important;--wab-duration:0s!important;--wab-delay:0s!important;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${CSS}</style>${MARKUP}`;
  parent.append(host);
  const $ = (selector) => shadow.querySelector(selector);
  const widget = $(".pebble");
  const ball = $(".ball");
  const number = $(".n");
  const ringProgress = $(".ring .prog");
  const menu = $(".timers");
  const status = $(".sr");

  const events = new AbortController();
  let timerEvents = new AbortController();
  const listen = (target, type, fn, options = {}) =>
    target.addEventListener(type, fn, { ...options, signal: events.signal });

  // ---------- State ----------
  let pos = normalizePosition(initialPosition);
  let width = Math.max(1, innerWidth);
  let height = Math.max(1, innerHeight);
  let enabled = false;
  let destroyed = false;
  let presets = [];
  let babies = [];
  // mode: 0 blurred, 1 revealed by a tap, 2 timed peek.
  let mode = 0;
  let peek = false;
  let deadline = 0;
  let ringAnimation = null;
  let lastReveal = false;
  let lastLabel = "";
  let pointer = null;
  let dragging = false;
  let planted = false;
  let fan = false;
  let hover = -1;
  let startX = 0;
  let startY = 0;
  let grabX = 0;
  let grabY = 0;
  let dragOrigin = null;
  let mouseX = null;
  let mouseY = null;
  let fanAt = 0;
  let fanDeadline = 0;
  let holdTimeout = 0;
  let fanTimeout = 0;
  let expiryTimeout = 0;
  let raf = 0;
  let lastFrame = 0;
  let previousX = 0;
  let previousY = 0;
  let speed = 0;
  let angle = 0;

  const press = new Spring(260, 12);
  const reveal = new Spring(150, 12);
  const timerMode = new Spring(130, 17);
  const lift = new Spring(200, 18);
  const lookX = new Spring(420, 24);
  const lookY = new Spring(420, 24);
  const springs = [press, reveal, timerMode, lift, lookX, lookY];

  // ---------- Helpers ----------
  function error(reason) {
    try {
      onError(reason);
    } catch {}
  }
  function call(fn, ...args) {
    try {
      const result = fn(...args);
      if (result?.catch) result.catch(error);
    } catch (reason) {
      error(reason);
    }
  }
  function permitted() {
    if (destroyed || !enabled || document.hidden) return false;
    try {
      return !!canReveal();
    } catch (reason) {
      error(reason);
      return false;
    }
  }
  const isRevealed = () => mode !== 0 || peek;
  const keepIn = (value, size) =>
    clamp(value, Math.min(MARGIN, size / 2), Math.max(size / 2, size - MARGIN));
  const center = () => ({
    x: keepIn(pos.x * width, width),
    y: keepIn(pos.y * height, height),
  });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const pause = () => host.toggleAttribute("data-paused", document.hidden || !document.hasFocus());

  function resetMotion() {
    const point = center();
    previousX = point.x;
    previousY = point.y;
    speed = 0;
    widget.style.transform = `translate(${point.x}px,${point.y}px)`;
  }
  function lookAtPointer() {
    const point = center();
    const dx = mouseX === null ? 0 : mouseX - point.x;
    const dy = mouseY === null ? 0 : mouseY - point.y;
    // A smooth, bounded response across the whole page. Quantize targets so
    // repeated subpixel pointer events do not keep a settled loop awake.
    const x = Math.round((dx / (Math.abs(dx) + Math.max(48, width * 0.06))) * 200) / 200;
    const y = Math.round((dy / (Math.abs(dy) + Math.max(48, height * 0.06))) * 200) / 200;
    if (x !== lookX.t || y !== lookY.t) {
      lookX.t = x;
      lookY.t = y;
      wake();
    }
  }
  function lookAhead() {
    mouseX = mouseY = null;
    lookX.t = lookY.t = 0;
    wake();
  }
  function wake() {
    if (!raf && enabled && !destroyed && !document.hidden) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function stateLabel() {
    if (mode === 2) return "Timed peek";
    if (fan) return "Choose a timer";
    if (peek) return "Peeking";
    if (mode) return "Revealed";
    if (dragging) return "Moving";
    return "Blurred";
  }
  // Push state to the page, the accessibility tree and the face.
  function publish() {
    const shown = isRevealed();
    if (shown !== lastReveal) {
      lastReveal = shown;
      call(onReveal, shown);
    }
    ball.setAttribute("aria-pressed", String(shown));
    ball.setAttribute("aria-expanded", String(fan));
    const mood = mode === 2 ? "timer" : shown ? "awake" : "asleep";
    if (widget.dataset.mood !== mood) widget.dataset.mood = mood;
    const label = stateLabel();
    if (label !== lastLabel) {
      lastLabel = label;
      status.textContent = label;
      ball.setAttribute("aria-label", `Pebble: ${label.toLowerCase()}`);
    }
    wake();
  }

  // ---------- Timers ----------
  function clearGestureTimers() {
    clearTimeout(holdTimeout);
    clearTimeout(fanTimeout);
    holdTimeout = fanTimeout = 0;
  }
  function clearTimer() {
    clearTimeout(expiryTimeout);
    expiryTimeout = 0;
    deadline = 0;
    // Freeze the ring where it is while it fades out. A paused animation costs
    // nothing per frame.
    ringAnimation?.pause();
  }
  function expire() {
    if (destroyed || mode !== 2) return;
    const remaining = deadline - performance.now();
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      number.textContent = seconds;
      ball.setAttribute("aria-label", `Pebble: timed peek, ${seconds} seconds left`);
      // Wake at the next visible second, on the same monotonic deadline that
      // controls privacy expiry. No per-frame countdown work.
      expiryTimeout = setTimeout(expire, Math.max(1, remaining - (seconds - 1) * 1000));
      return;
    }
    clearTimer();
    mode = 0;
    press.v -= 3;
    publish();
  }
  function startTimer(seconds) {
    if (!permitted()) {
      cancel();
      return;
    }
    clearGestureTimers();
    clearTimer();
    closeFan();
    mode = 2;
    peek = false;
    deadline = performance.now() + seconds * 1000;
    ringAnimation?.cancel();
    // About two steps per ring pixel: smooth for short timers, and an hour
    // long timer repaints once every few seconds.
    ringAnimation = ringProgress.animate(
      [{ strokeDashoffset: "0" }, { strokeDashoffset: `${RING}` }],
      { duration: seconds * 1000, easing: "steps(480, end)", fill: "forwards" },
    );
    press.v -= 5;
    publish();
    expire();
  }

  // ---------- Gestures ----------
  function closeFan() {
    clearTimeout(fanTimeout);
    fanTimeout = fanDeadline = 0;
    fan = false;
    hover = -1;
    for (const baby of babies) {
      baby.emerge.t = 0;
      baby.button.disabled = true;
      baby.button.setAttribute("aria-hidden", "true");
    }
  }
  function releaseCapture() {
    const old = pointer;
    pointer = null;
    if (old !== null && ball.hasPointerCapture(old.id)) {
      try {
        ball.releasePointerCapture(old.id);
      } catch {}
    }
  }
  function cancel() {
    clearGestureTimers();
    clearTimer();
    if (dragging && dragOrigin) pos = { ...dragOrigin };
    resetMotion();
    dragging = planted = peek = false;
    dragOrigin = null;
    mode = 0;
    releaseCapture();
    closeFan();
    press.t = reveal.t = timerMode.t = lift.t = 0;
    publish();
  }
  function activate() {
    call(onActivity);
    if (!permitted()) return;
    clearGestureTimers();
    clearTimer();
    closeFan();
    peek = false;
    mode = mode ? 0 : 1;
    press.v -= 4;
    publish();
  }
  function measure() {
    const bounds = host.getBoundingClientRect();
    width = Math.max(1, bounds.width || innerWidth);
    height = Math.max(1, bounds.height || innerHeight);
    resetMotion();
    if (fan) layoutFan();
    wake();
  }

  // Place the timer bubbles on an arc that points toward the middle of the
  // page. Near a corner the whole arc rotates and shrinks rather than piling
  // bubbles on top of each other. Falls back to a 3x3 grid of safe spots.
  function layoutFan() {
    const origin = center();
    const count = babies.length;
    const inBounds = (point) =>
      point.x >= 28 && point.y >= 28 && point.x <= width - 28 && point.y <= height - 28;
    const spaced = (points) =>
      points.every((point, i) => points.slice(i + 1).every((other) => distance(point, other) >= FAN_GAP));
    const desired = Math.atan2(height / 2 - origin.y, width / 2 - origin.x);
    let points = null;
    search: for (const radius of [FAN_RADIUS, 76, 64]) {
      for (let step = 0; step <= 64; step++) {
        for (const sign of step ? [-1, 1] : [1]) {
          const start = desired + (sign * step * Math.PI) / 64;
          const candidate = babies.map((_, i) => {
            const a = start + (i - (count - 1) / 2) * FAN_STEP;
            return { x: origin.x + Math.cos(a) * radius, y: origin.y + Math.sin(a) * radius };
          });
          if (candidate.every(inBounds) && spaced(candidate)) {
            points = candidate;
            break search;
          }
        }
      }
    }
    if (!points) {
      const middle = { x: width / 2, y: height / 2 };
      const spots = [];
      for (const x of [28, width / 2, width - 28])
        for (const y of [28, height / 2, height - 28]) {
          const point = { x, y };
          if (inBounds(point) && distance(point, origin) >= 62) spots.push(point);
        }
      spots.sort((a, b) => distance(a, middle) - distance(b, middle));
      points = [];
      for (const point of spots)
        if (points.every((other) => distance(point, other) >= FAN_GAP)) points.push(point);
      if (points.length < count) return false;
      points.length = count;
    }
    babies.forEach((baby, i) => {
      baby.x = points[i].x - origin.x;
      baby.y = points[i].y - origin.y;
    });
    return true;
  }
  function openFan(keyboard = false) {
    if (!permitted() || !babies.length || !layoutFan()) return;
    fan = true;
    hover = -1;
    fanAt = performance.now();
    fanDeadline = keyboard ? 0 : fanAt + CHOICE_MS;
    clearTimeout(fanTimeout);
    if (!keyboard)
      fanTimeout = setTimeout(() => {
        fanTimeout = 0;
        if (fan) probe(true);
      }, CHOICE_MS);
    for (const baby of babies) {
      baby.button.disabled = false;
      baby.button.setAttribute("aria-hidden", "false");
    }
    publish();
    if (keyboard) babies[0].button.focus({ preventScroll: true });
  }
  // Highlight the bubble under the pointer. Close the fan once the choice
  // window has passed with nothing highlighted.
  function probe(choiceElapsed = false) {
    const point = center();
    let best = -1;
    let nearest = HIT_PX;
    babies.forEach((baby, i) => {
      const d = Math.hypot(mouseX - point.x - baby.drawX, mouseY - point.y - baby.drawY);
      if (baby.emerge.x > 0.75 && d < nearest) {
        nearest = d;
        best = i;
      }
    });
    if (best < 0 && fanDeadline && (choiceElapsed || performance.now() >= fanDeadline)) {
      closeFan();
      publish();
      return;
    }
    if (best !== hover) {
      hover = best;
      wake();
    }
  }
  function rebuild() {
    timerEvents.abort();
    timerEvents = new AbortController();
    const signal = timerEvents.signal;
    menu.replaceChildren();
    babies = presets.map((seconds) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tb";
      button.disabled = true;
      button.setAttribute("aria-hidden", "true");
      button.setAttribute("aria-label", `Show for ${seconds} seconds`);
      const skin = document.createElement("i");
      skin.setAttribute("aria-hidden", "true");
      skin.innerHTML = BABY_FACE;
      const label = document.createElement("span");
      label.textContent = `${seconds}s`;
      button.append(skin, label);
      menu.append(button);
      const baby = {
        seconds,
        button,
        emerge: new Spring(170, 11),
        highlight: new Spring(320, 18),
        x: 0,
        y: 0,
        drawX: 0,
        drawY: 0,
      };
      button.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          call(onActivity);
          if (!fan) return;
          startTimer(seconds);
          ball.focus({ preventScroll: true });
        },
        { signal },
      );
      button.addEventListener(
        "focus",
        () => {
          hover = babies.indexOf(baby);
          wake();
        },
        { signal },
      );
      return baby;
    });
  }

  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  listen(ball, "pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false || pointer !== null) return;
    swallow(event);
    call(onActivity);
    if (!permitted()) return;
    if (mode === 2 && performance.now() >= deadline) expire();
    try {
      ball.setPointerCapture(event.pointerId);
    } catch (reason) {
      error(reason);
      return;
    }
    // A timer may expire before release. Keep the tap's intended result with
    // this gesture so a cancel click can never become a fresh reveal.
    pointer = { id: event.pointerId, tapMode: mode ? 0 : 1 };
    dragging = planted = false;
    closeFan();
    startX = mouseX = event.clientX;
    startY = mouseY = event.clientY;
    const point = center();
    grabX = point.x - mouseX;
    grabY = point.y - mouseY;
    dragOrigin = { ...pos };
    holdTimeout = setTimeout(() => {
      if (pointer === null || dragging || !permitted()) return;
      planted = true;
      if (!mode) peek = true;
      openFan();
      publish();
    }, HOLD_MS);
    publish();
  });
  listen(
    window,
    "pointermove",
    (event) => {
      if (!enabled || destroyed || document.hidden) return;
      mouseX = event.clientX;
      mouseY = event.clientY;
      lookAtPointer();
      if (event.pointerId !== pointer?.id) return;
      if (event.buttons !== 1 || !permitted()) {
        cancel();
        return;
      }
      if (!planted && !dragging && Math.hypot(mouseX - startX, mouseY - startY) > DRAG_PX) {
        dragging = true;
        clearGestureTimers();
        publish();
      }
      if (dragging) {
        const edgeX = Math.min(MARGIN / width, 0.5);
        const edgeY = Math.min(MARGIN / height, 0.5);
        pos = {
          x: clamp((mouseX + grabX) / width, edgeX, 1 - edgeX),
          y: clamp((mouseY + grabY) / height, edgeY, 1 - edgeY),
        };
        wake();
      } else if (fan) probe();
    },
    { capture: true, passive: true },
  );
  listen(ball, "pointerup", (event) => {
    if (event.pointerId !== pointer?.id) return;
    swallow(event);
    if (event.button !== 0 || !permitted()) {
      cancel();
      return;
    }
    clearGestureTimers();
    if (fan) probe();
    const selected = fan && hover >= 0 ? babies[hover].seconds : 0;
    const moved = dragging;
    const held = planted;
    const { tapMode } = pointer;
    releaseCapture();
    dragging = planted = peek = false;
    dragOrigin = null;
    closeFan();
    if (moved) {
      call(onPosition, { ...pos });
    } else if (!held) {
      clearTimer();
      mode = tapMode;
      press.v -= 4;
    } else if (selected) startTimer(selected);
    publish();
  });
  listen(ball, "pointercancel", (event) => {
    if (event.pointerId === pointer?.id) {
      event.preventDefault();
      cancel();
    }
  });
  listen(ball, "lostpointercapture", (event) => {
    if (event.pointerId === pointer?.id) cancel();
  });
  listen(ball, "click", (event) => {
    swallow(event);
    // Pointer gestures commit on release. Only a keyboard or assistive click
    // (detail 0) acts here.
    if (event.detail === 0) activate();
  });
  listen(ball, "keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      swallow(event);
      if (!event.repeat) activate();
    } else if (event.key === "ArrowDown") {
      swallow(event);
      call(onActivity);
      if (!event.repeat) openFan(true);
    }
  });
  const ARROWS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  listen(shadow, "keydown", (event) => {
    if (event.key === "Escape") {
      swallow(event);
      cancel();
      ball.focus({ preventScroll: true });
      return;
    }
    if (!fan || event.target === ball) return;
    const delta = ARROWS[event.key];
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    swallow(event);
    const index = babies.findIndex((baby) => baby.button === shadow.activeElement);
    const last = babies.length - 1;
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? last : (index + delta + babies.length) % babies.length;
    babies[next].button.focus({ preventScroll: true });
  });
  listen(shadow, "focusout", (event) => {
    if (fan && pointer === null && !shadow.contains(event.relatedTarget)) {
      closeFan();
      peek = false;
      publish();
    }
  });
  listen(document, "pointerleave", (event) => {
    if (!event.relatedTarget) lookAhead();
  });
  listen(document, "visibilitychange", () => {
    pause();
    if (document.hidden) {
      cancel();
      stopLoop();
    } else measure();
  });
  listen(window, "blur", () => {
    host.setAttribute("data-paused", "");
    lookAhead();
  });
  listen(window, "focus", pause);
  const observer = new ResizeObserver(measure);
  observer.observe(host);
  listen(window, "resize", measure);

  // ---------- Frame ----------
  function frame(now) {
    raf = 0;
    if (destroyed || !enabled || document.hidden) return;
    if ((isRevealed() || pointer !== null || fan) && !permitted()) {
      cancel();
      return;
    }
    const dt = Math.min(0.033, Math.max(0.001, (now - lastFrame) / 1000));
    lastFrame = now;
    if (mode === 2 && now >= deadline) expire();
    const point = center();
    lookAtPointer();
    press.t = pointer !== null ? 1 : 0;
    reveal.t = isRevealed() ? 1 : 0;
    timerMode.t = mode === 2 ? 1 : 0;
    lift.t = dragging ? 1 : 0;
    for (const spring of springs) spring.step(dt);
    // Pebble follows the pointer directly, then stretches along its
    // frame-to-frame movement. Position lag would change that feel, so keep
    // the displacement, smoothing and deformation equations together.
    const vx = (point.x - previousX) / dt;
    const vy = (point.y - previousY) / dt;
    previousX = point.x;
    previousY = point.y;
    const velocity = Math.hypot(vx, vy);
    speed += (velocity - speed) * Math.min(1, dt * 10);
    if (speed < 0.5) speed = 0;
    if (velocity > 60) angle = (Math.atan2(vy, vx) * 180) / Math.PI;
    const stretch = clamp(speed / 2400, 0, 0.32) * 1.8;
    const squash = 1 - 0.07 * press.x;
    widget.style.cssText = `transform:translate(${point.x}px,${point.y}px);--p:${press.x};--r:${reveal.x};--m:${timerMode.x};--l:${lift.x};--px:${lookX.x};--py:${lookY.x}`;
    ball.style.transform = `rotate(${angle}deg) scale(${(1 + stretch) * squash},${(1 - stretch * 0.7) * squash}) rotate(${-angle}deg)`;

    let babiesMoving = false;
    babies.forEach((baby, i) => {
      const due = fan && now - fanAt >= i * FAN_STAGGER_MS;
      baby.emerge.t = due ? 1 : 0;
      baby.highlight.t = fan && i === hover ? 1 : 0;
      if (fan && !due) babiesMoving = true;
      if (!baby.emerge.moving && !baby.highlight.moving && baby.emerge.x === 0) return;
      // The same underdamped spring in both directions gives the hop out and
      // the tuck back in.
      const emerge = Math.max(0, baby.emerge.step(dt));
      const highlight = baby.highlight.step(dt);
      baby.drawX = baby.x * emerge;
      baby.drawY = baby.y * emerge - HOP * Math.sin(Math.PI * clamp(emerge, 0, 1));
      baby.button.style.cssText = `transform:translate(${baby.drawX}px,${baby.drawY}px) scale(${0.4 + 0.6 * emerge});opacity:${clamp(emerge * 3, 0, 1)};--h:${highlight};pointer-events:${fan && emerge > 0.75 ? "auto" : "none"}`;
      if (baby.emerge.moving || baby.highlight.moving) babiesMoving = true;
    });
    if (fan && pointer !== null) probe();
    if (!raf && (dragging || speed > 0 || babiesMoving || springs.some((spring) => spring.moving)))
      raf = requestAnimationFrame(frame);
  }

  // ---------- API ----------
  function setPosition(value) {
    if (destroyed) return;
    const next = normalizePosition(value);
    if (Math.abs(next.x - pos.x) < 1e-6 && Math.abs(next.y - pos.y) < 1e-6) return;
    cancel();
    pos = next;
    measure();
  }
  function update({ enabled: nextEnabled, presets: nextPresets }) {
    if (destroyed) return;
    const list = WAB.normalizePebbleTimers(nextPresets);
    const changed = list.length !== presets.length || list.some((seconds, i) => seconds !== presets[i]);
    const show = !!nextEnabled;
    if (changed || show !== enabled) cancel();
    enabled = show;
    pause();
    host.style.setProperty("display", enabled ? "block" : "none", "important");
    if (changed) {
      presets = list;
      rebuild();
    }
    if (enabled) {
      measure();
      publish();
    } else stopLoop();
  }
  function destroy() {
    if (destroyed) return;
    cancel();
    destroyed = true;
    stopLoop();
    ringAnimation?.cancel();
    events.abort();
    timerEvents.abort();
    observer.disconnect();
    host.remove();
  }
  return {
    update,
    setPosition,
    cancel,
    destroy,
    owns: (event) => event?.target === host || !!event?.composedPath?.().includes(host),
    get revealed() {
      return isRevealed();
    },
  };
};
