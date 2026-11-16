"use strict";

(() => {
  const runtimeOk = () => {
    try {
      return !!chrome.runtime.id;
    } catch {
      return false;
    }
  };
  if (!runtimeOk()) return;
  const root = document.documentElement;
  const removers = [];
  let torn = false,
    ready = false,
    panic = false,
    pebble = null;
  let prefs = WAB.normalizePrefs(),
    owner = null,
    armed = null,
    armX = 0,
    armY = 0;
  let idleTimer = null,
    revealTimer = null,
    hideTimer = null,
    videoFrame = null,
    videoControlClick = false,
    holdTimer = null,
    holdTarget = null,
    holdPointer = null,
    holdX = 0,
    holdY = 0,
    holdRevealed = false,
    suppressClick = false,
    suppressClickTimer = null,
    blurredCache = null;
  const HOLD_MS = 300;
  const pausedVideos = new Set();
  const ANCHORS = [
    '[data-testid="msg-container"]',
    '[data-testid="cell-frame-container"]',
    '[data-testid="message-yourself-row"]',
    "#main header",
    '[data-testid="media-canvas"]',
    '[data-testid~="media-canvas-img"]',
    '[data-testid="media-viewer-modal"] :is([data-testid~="media-zoomable"], [data-testid~="media-image"], [data-testid~="media-video"], [data-testid~="media-gif"])',
    '[data-testid="link-gallery-msg"] > div:last-child',
    '[data-testid="document-thumb"]',
    '[data-testid="shared_location_map_image"]',
    '[data-testid="quoted-message-preview"]',
    '[data-testid="contact-info-header"]',
    '[data-testid="drawer-right"] svg:has(image)',
    '[data-testid="drawer-right"] [data-testid~="contact-info-subtitle"]',
    '[data-testid="chat-info-drawer"] span.selectable-text',
    '#main div[data-testid="conversation-compose-box-input"]',
    'footer div[data-testid="conversation-compose-box-input"]',
    '#main footer [contenteditable="true"]',
    '#side [data-testid="chat-list-search-container"]',
    '#side input[role="textbox"]',
    '[data-testid="drawer-right"] input',
    'div[role="dialog"] input',
    'div[role="dialog"] [role="listitem"]',
    'div[role="dialog"] [role="row"]',
    '[data-testid="status-row-cell"]',
    '[data-testid="status-image"]',
    '[data-testid="status-image-thumbnail"]',
    '[data-testid="media-url-provider"]',
    '[data-testid="status-player-uie"] [style*="--x-height: 40px"]',
    '[data-testid="status-player-contact-name"]',
    '[data-testid="status-caption-text"]',
    '[data-testid="media-hub-list-row"]',
    '[data-testid="conversation-subheader"]',
    '[data-testid="media-caption-input-container"]',
    '[data-testid="edit-message-composer"]',
    '[data-testid^="poll-question-input"]',
    '[data-testid^="poll-option-input"]',
    '[data-testid="li-block"]',
    '[data-testid="li-report-spam"]',
    "video",
  ];
  const anchors = ANCHORS.join(",");

  function alive() {
    if (!torn && !runtimeOk()) teardown();
    return !torn;
  }
  function listen(target, type, callback, options) {
    const handler = (event) => {
      if (alive()) callback(event);
    };
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }
  function watch(event, callback) {
    const handler = (...args) => {
      if (alive()) callback(...args);
    };
    event.addListener(handler);
    removers.push(() => event.removeListener(handler));
  }
  function report(error) {
    const message = String(error?.message ?? error);
    if (!runtimeOk() || message.startsWith("Extension context invalidated"))
      teardown();
    else console.warn("Pebble:", message);
  }
  async function send(message) {
    if (!alive()) return;
    return WAB.sendMessage(message);
  }
  function teardown() {
    if (torn) return;
    torn = true;
    clearTimeout(idleTimer);
    clearTimeout(hideTimer);
    clearTimeout(holdTimer);
    clearTimeout(suppressClickTimer);
    cancelAnimationFrame(videoFrame);
    pebble?.destroy();
    pebble = null;
    holdTarget = null;
    holdPointer = null;
    holdRevealed = false;
    suppressClick = false;
    clearReveal();
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {}
    }
    root.classList.remove("wab-peek");
    for (const name of ["--wab-blur", "--wab-msg-halo"])
      root.style.removeProperty(name);
    root.classList.add("wab-off");
    for (const leaf of WAB.LEAVES)
      root.classList.remove(WAB.className(leaf.id));
  }

  function videos() {
    for (const video of pausedVideos)
      if (!video.isConnected) pausedVideos.delete(video);
    return document.querySelectorAll("video");
  }
  const playingWithin = (element) =>
    [...videos()].some(
      (video) => element.contains(video) && !video.paused && !video.ended,
    );
  function setVideoPlayback(video, playing) {
    // WhatsApp's full video player needs its playback UI to update autoplay
    // intent. Inline GIFs and other raw media use the native video API.
    const player = video.closest('[data-testid~="media-video"]');
    const icon = playing ? "ic-play-arrow-filled" : "ic-pause-filled";
    // WhatsApp keeps the same click surface when its toolbar is hidden.
    const surface = player?.querySelector('[role="group"]')?.firstElementChild;
    const control =
      (player &&
        [...player.querySelectorAll("button")].find(
          (button) => button.querySelector("svg title")?.textContent === icon,
        )) ||
      (surface?.matches("div:empty") ? surface : null);
    if (control) {
      videoControlClick = true;
      try {
        control.click();
      } finally {
        videoControlClick = false;
      }
    } else if (!player) {
      if (playing) video.play().catch(() => {});
      else video.pause();
    }
  }
  // Chat videos and the full-screen viewer are separate switches.
  function videoBlurActive(video) {
    if (video.closest('[data-testid="media-viewer-modal"]'))
      return WAB.leafActive(prefs, "media_viewer");
    return (
      !!video.closest('[data-testid="msg-container"]') &&
      WAB.leafActive(prefs, "media_videos")
    );
  }
  function syncVideos() {
    const peek = root.classList.contains("wab-peek");
    for (const video of videos()) {
      const revealed = owner?.contains(video) && revealTimer === null;
      const hidden =
        !torn &&
        prefs.on &&
        prefs.pauseVideoOnBlur &&
        (panic || (videoBlurActive(video) && !peek && !revealed));
      if (hidden && !video.paused && !video.ended) {
        pausedVideos.add(video);
        setVideoPlayback(video, false);
      } else if (!hidden && pausedVideos.has(video)) {
        pausedVideos.delete(video);
        if (prefs.autoResumeVideo && video.paused && !video.ended)
          setVideoPlayback(video, true);
      }
    }
  }
  function queueVideoSync() {
    if (document.hidden) {
      syncVideos();
      return;
    }
    if (videoFrame !== null) return;
    // Wait until playback has started, then let WhatsApp render its Pause control.
    videoFrame = requestAnimationFrame(() => {
      videoFrame = null;
      if (alive()) syncVideos();
    });
  }

  function clearReveal() {
    clearTimeout(revealTimer);
    clearTimeout(hideTimer);
    revealTimer = null;
    hideTimer = null;
    if (owner)
      for (const name of [
        "--wab-reveal",
        "--wab-duration",
        "--wab-delay",
        "--wab-text-clip",
      ])
        owner.style.removeProperty(name);
    owner = null;
    armed = null;
    syncVideos();
  }
  function cancelHold() {
    clearTimeout(holdTimer);
    holdTimer = null;
    const hadReveal = holdRevealed;
    holdTarget = null;
    holdPointer = null;
    holdRevealed = false;
    if (hadReveal) clearReveal();
  }
  function startHold(event) {
    if (!canReveal() || prefs.interactionMode !== "hold") return;
    if (event.button !== 0 || event.isPrimary === false) return;
    if (pebble?.owns(event) || videoControlClick) return;
    const target = revealOwner(event);
    if (!target || !statusMediaTarget(target, event)) return;
    cancelHold();
    suppressClick = false;
    holdTarget = target;
    holdPointer = event.pointerId;
    holdX = event.clientX;
    holdY = event.clientY;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      if (!alive() || !canReveal() || prefs.interactionMode !== "hold") return;
      if (!holdTarget || holdTarget !== target) return;
      holdRevealed = true;
      reveal(target);
    }, HOLD_MS);
  }
  function moveHold(event) {
    if (!holdTarget || event.pointerId !== holdPointer) return;
    if (
      !holdTarget.isConnected ||
      Math.hypot(event.clientX - holdX, event.clientY - holdY) > 6 ||
      !containsPoint(holdTarget, event.clientX, event.clientY)
    )
      cancelHold();
  }
  function endHold(event) {
    if (!holdTarget || event.pointerId !== holdPointer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    const revealed = holdRevealed;
    holdTarget = null;
    holdPointer = null;
    holdRevealed = false;
    if (!revealed) return;
    clearReveal();
    // The click that follows a long press is part of the peek gesture, not an
    // action. A short click never sets this flag, so it still opens normally.
    suppressClick = true;
    clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressClick = false;
      suppressClickTimer = null;
    }, 500);
  }
  function reveal(element) {
    clearReveal();
    owner = element;
    const delay =
      prefs.interactionMode === "hover" ? WAB.revealDelay(prefs) : 0;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 10
      : prefs.revealDelayMode === "instant"
        ? 40
        : 150;
    element.style.setProperty("--wab-reveal", "0");
    element.style.setProperty("--wab-text-clip", "0px");
    element.style.setProperty("--wab-duration", `${duration / 1000}s`);
    element.style.setProperty("--wab-delay", `${delay / 1000}s`);
    // Resume only once the visual reveal has finished, never during its delay.
    revealTimer = setTimeout(() => {
      revealTimer = null;
      if (alive()) syncVideos();
    }, delay + duration);
    scheduleAutoHide(element);
  }
  // "Re-blur after N seconds". Never cuts off a video that is playing.
  function scheduleAutoHide(element) {
    clearTimeout(hideTimer);
    hideTimer = null;
    if (!prefs.autoHideSec) return;
    hideTimer = setTimeout(() => {
      if (!alive() || owner !== element) return;
      if (playingWithin(element)) scheduleAutoHide(element);
      else clearReveal();
    }, prefs.autoHideSec * 1000);
  }
  function outermostOwner(target) {
    let best = null;
    for (
      let element = target instanceof Element ? target : target?.parentElement;
      element && element !== document.body && element !== root;
      element = element.parentElement
    ) {
      if (element.matches(anchors)) best = element;
    }
    return best;
  }
  // The status viewer puts a full-screen hit layer over the media. Reveal
  // only while the pointer is actually over the status photo/video, so
  // moving to the black surround restores blur.
  function statusMediaTarget(owner, event) {
    if (
      !owner.closest('[data-testid="status-player-uie"]') ||
      !owner.matches(
        '[data-testid="status-image"], [data-testid="status-image-thumbnail"], [data-testid="media-url-provider"]',
      )
    )
      return true;
    const media = [...owner.querySelectorAll("img, video")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 120;
    });
    if (!media.length) return true;
    return media.some((el) => containsPoint(el, event.clientX, event.clientY));
  }
  // A blur can sit on a painted sibling underneath a clickable overlay (the
  // contact-info avatar is exactly that). Discover the painted blur at the
  // pointer instead of trusting only the event target's ancestors.
  function blurPixels(element) {
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return 0;
    const match = /blur\(([\d.]+)px\)/.exec(style.filter);
    return match ? parseFloat(match[1]) : 0;
  }
  function containsPoint(element, x, y) {
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }
  const area = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width * rect.height;
  };
  const smallest = (elements) =>
    elements.reduce((best, el) => (!best || area(el) < area(best) ? el : best), null);
  function smallestBlurred(root, x, y) {
    if (area(root) > 250000 || root.childElementCount > 500) return null;
    return smallest(
      [...root.querySelectorAll("*")].filter(
        (element) => containsPoint(element, x, y) && blurPixels(element) > 0,
      ),
    );
  }
  function nearestBlurred(event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const x = event.clientX,
      y = event.clientY,
      now = performance.now();
    if (
      blurredCache &&
      blurredCache.target === target &&
      Math.abs(x - blurredCache.x) < 4 &&
      Math.abs(y - blurredCache.y) < 4 &&
      now - blurredCache.at < 120
    )
      return blurredCache.value;
    let value = null;
    // The hovered element itself or a blurred ancestor (normal path).
    for (
      let node = target;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      if (containsPoint(node, x, y) && blurPixels(node) > 0) {
        value = node;
        break;
      }
    }
    // A blurred descendant painted under a clickable overlay (avatar case).
    if (!value) value = smallestBlurred(target, x, y);
    // A blurred painted sibling below an overlay.
    if (!value) {
      let node = target;
      for (
        let depth = 0;
        node && depth < 5;
        depth++, node = node.parentElement
      ) {
        const parent = node.parentElement;
        if (!parent) break;
        const candidates = [];
        for (const sibling of parent.children) {
          if (sibling === node || !containsPoint(sibling, x, y)) continue;
          if (area(sibling) > 250000) continue;
          if (blurPixels(sibling) > 0) candidates.push(sibling);
          const found = smallestBlurred(sibling, x, y);
          if (found) candidates.push(found);
        }
        value = smallest(candidates);
        if (value) break;
      }
    }
    blurredCache = { target, x, y, at: now, value };
    return value;
  }
  // Identity/caption in the status header are their own reveal targets even
  // though they sit inside the full-screen media layer.
  function revealOwner(event) {
    const identity =
      event.target instanceof Element
        ? event.target.closest(
            '[data-testid="status-player-contact-name"], [data-testid="status-caption-text"]',
          )
        : null;
    if (identity) return identity;
    const anchor = outermostOwner(event.target);
    const blurred = nearestBlurred(event);
    if (anchor && (!blurred || anchor.contains(blurred))) return anchor;
    return blurred || anchor;
  }
  const canReveal = () => !torn && ready && prefs.on && !panic;
  function syncPeek() {
    root.classList.toggle("wab-peek", !!(pebble?.revealed && canReveal()));
    syncVideos();
  }
  function clearPeek() {
    pebble?.cancel();
    syncPeek();
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (!prefs.on || prefs.idleTimeoutSec === 0 || panic) return;
    idleTimer = setTimeout(() => {
      if (!alive() || document.visibilityState !== "visible") return;
      if (
        prefs.interactionMode === "hover" &&
        owner?.matches(":hover") &&
        playingWithin(owner)
      ) {
        resetIdle();
        return;
      }
      send({ type: "WAB_PANIC_ENGAGE" }).catch(report);
    }, prefs.idleTimeoutSec * 1000);
  }
  function clearAwayState() {
    cancelHold();
    clearPeek();
    clearReveal();
  }
  function applyPrefs(value) {
    prefs = WAB.normalizePrefs(value);
    blurredCache = null;
    const blur = WAB.blurFor(prefs);
    root.classList.toggle("wab-off", !prefs.on);
    root.style.setProperty("--wab-blur", `${blur}px`);
    // Chromium does not accept calc() for overflow-clip-margin.
    root.style.setProperty("--wab-msg-halo", `${blur * 2}px`);
    cancelHold();
    clearPeek();
    pebble?.update({
      enabled: prefs.on && prefs.pebbleEnabled,
      presets: prefs.pebbleTimers,
    });
    // One class per leaf surface; CSS keys on exactly that class.
    for (const leaf of WAB.LEAVES)
      root.classList.toggle(
        WAB.className(leaf.id),
        !(prefs.on && WAB.leafActive(prefs, leaf.id)),
      );
    clearReveal();
    resetIdle();
  }
  function applyPanic(on) {
    panic = on;
    clearTimeout(idleTimer);
    idleTimer = null;
    if (on) {
      cancelHold();
      clearPeek();
      clearReveal();
      return;
    }
    syncVideos();
    resetIdle();
  }

  // Wake before calculating a reveal target. All handlers share one owner.
  for (const type of ["pointermove", "pointerdown", "keydown", "wheel"])
    listen(document, type, resetIdle, { capture: true, passive: true });
  listen(
    document,
    "pointermove",
    (event) => {
      if (!canReveal() || prefs.interactionMode !== "hover") return;
      const target = revealOwner(event);
      if (target && !statusMediaTarget(target, event)) {
        clearReveal();
        return;
      }
      if (target === owner) return;
      if (owner) clearReveal();
      if (!target) {
        armed = null;
        return;
      }
      if (armed !== target) {
        armed = target;
        armX = event.clientX;
        armY = event.clientY;
      } else if (Math.hypot(event.clientX - armX, event.clientY - armY) > 3)
        reveal(target);
    },
    { capture: true, passive: true },
  );
  listen(
    document,
    "click",
    (event) => {
      if (pebble?.owns(event)) return;
      if (suppressClick) {
        suppressClick = false;
        clearTimeout(suppressClickTimer);
        suppressClickTimer = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (videoControlClick) return;
      if (panic) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (prefs.coverClickRelease)
          send({ type: "WAB_PANIC_RELEASE" }).catch(report);
        return;
      }
      if (!canReveal() || prefs.interactionMode !== "click") return;
      const target = revealOwner(event);
      if (target && !statusMediaTarget(target, event)) {
        clearReveal();
        return;
      }
      if (target !== owner) {
        if (target) reveal(target);
        else clearReveal();
      }
    },
    { capture: true },
  );
  for (const type of ["scroll", "wheel"])
    listen(
      document,
      type,
      () => {
        cancelHold();
        clearReveal();
      },
      { capture: true, passive: true },
    );
  listen(
    document,
    "pointerdown",
    (event) => {
      if (owner && outermostOwner(event.target) !== owner) clearReveal();
      startHold(event);
    },
    { capture: true },
  );
  listen(document, "pointermove", moveHold, {
    capture: true,
    passive: true,
  });
  listen(document, "pointerup", endHold, {
    capture: true,
    passive: true,
  });
  listen(document, "pointercancel", cancelHold, {
    capture: true,
    passive: true,
  });
  listen(
    document,
    "contextmenu",
    (event) => {
      if (holdRevealed) event.preventDefault();
    },
    { capture: true },
  );
  listen(
    document,
    "pointerleave",
    (event) => {
      if (!event.relatedTarget) {
        cancelHold();
        clearReveal();
      }
    },
    { capture: true },
  );
  listen(document, "playing", queueVideoSync, { capture: true });
  listen(window, "blur", clearAwayState);
  listen(document, "visibilitychange", () => {
    if (document.visibilityState === "hidden") clearAwayState();
    else resetIdle();
  });

  listen(
    window,
    "keydown",
    (event) => {
      const combo = WAB.eventHotkey(event);
      if (combo && combo === prefs.toggleHotkey) {
        if (!event.repeat) {
          event.preventDefault();
          event.stopPropagation();
          send({ type: "WAB_TOGGLE_KEY", combo }).catch(report);
        }
        return;
      }
      if (combo === prefs.panicHotkey) {
        clearPeek();
        event.preventDefault();
        event.stopPropagation();
        send({ type: "WAB_PANIC_KEY", combo }).catch(report);
      }
    },
    { capture: true },
  );
  async function initialize() {
    // Registration can also throw if the extension is reloaded mid-startup.
    watch(chrome.storage.sync.onChanged, (changes) => {
      if (changes.prefs) applyPrefs(changes.prefs.newValue);
    });
    watch(chrome.storage.local.onChanged, (changes) => {
      if (changes.wabPanic) applyPanic(changes.wabPanic.newValue === true);
      if (changes.pebblePosition)
        pebble?.setPosition(changes.pebblePosition.newValue);
    });

    // Await each read so a synchronous API throw cannot orphan another read's
    // rejected promise while constructing Promise.all's argument list.
    const settings = await WAB.loadPrefs();
    if (!alive()) return;
    const local = await chrome.storage.local.get([
      "wabPanic",
      "pebblePosition",
    ]);
    if (!alive()) return;
    ready = true;
    applyPrefs(settings);
    applyPanic(local.wabPanic === true);
    const response = await send({ type: "WAB_INIT" });
    if (!response || !alive()) return;
    applyPanic(response.panic);
    pebble = WAB.createPebble({
      parent: root,
      position: local.pebblePosition,
      canReveal,
      onActivity: resetIdle,
      onReveal() {
        // Per-item hover/click reveals must not outlive a Pebble interaction.
        syncPeek();
        clearReveal();
      },
      onPosition: async (position) => {
        if (!alive()) return;
        try {
          await chrome.storage.local.set({ pebblePosition: position });
        } catch (error) {
          report(error);
        }
      },
      onError: report,
    });
    pebble.update({
      enabled: prefs.on && prefs.pebbleEnabled,
      presets: prefs.pebbleTimers,
    });
    // "Start covered": engage once per page load, before anything is read.
    if (prefs.on && prefs.coverOnLoad && !response.panic)
      send({ type: "WAB_PANIC_ENGAGE" }).catch(report);
  }
  initialize().catch(report);
})();
