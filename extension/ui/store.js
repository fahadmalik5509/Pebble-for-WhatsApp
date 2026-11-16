"use strict";

// The popup's single source of truth. Edits apply at once, so a dragged slider
// previews live. The worker owns the save queue, so pending writes finish even
// after the popup closes.
globalThis.PebbleStore = (() => {
  let prefs = WAB.normalizePrefs(),
    panic = false,
    ready = false,
    dirty = false,
    pending = 0;
  const listeners = new Set(),
    statusListeners = new Set();
  const emit = () => {
    for (const fn of listeners)
      try {
        fn();
      } catch (error) {
        console.error(error);
      }
  };
  const status = (state, message = "") => {
    for (const fn of statusListeners) fn(state, message);
  };
  const applyTheme = () => {
    document.documentElement.dataset.theme = prefs.theme;
  };

  async function init() {
    const [loaded, local] = await Promise.all([
      WAB.loadPrefs(),
      chrome.storage.local.get("wabPanic"),
    ]);
    prefs = loaded;
    panic = local.wabPanic === true;
    ready = true;
    applyTheme();
    emit();
  }

  // Apply a change. `persist: false` is for drags; call commit() on release.
  function set(mutator, { persist = true } = {}) {
    const next = structuredClone(prefs);
    mutator(next);
    prefs = WAB.normalizePrefs(next);
    dirty = true;
    applyTheme();
    emit();
    if (persist) flush();
  }
  function replace(value) {
    set((draft) => Object.assign(draft, WAB.normalizePrefs(value)));
  }
  const commit = () => dirty && flush();
  function flush() {
    dirty = false;
    pending++;
    status("saving");
    WAB.sendMessage({ type: "WAB_SAVE_PREFS", prefs }).then(
      () => {
        pending--;
        if (!pending && !dirty) status("saved");
      },
      (error) => {
        pending--;
        status("error", error?.message || "Couldn't save. Try again.");
      },
    );
  }

  async function togglePanic() {
    try {
      const result = await WAB.sendMessage({
        type: panic ? "WAB_PANIC_RELEASE" : "WAB_PANIC_ENGAGE",
      });
      if (result?.failedTabs)
        throw new Error("Some WhatsApp tabs could not update. Refresh them.");
      panic = result.panic;
      emit();
    } catch (error) {
      status("error", error.message);
    }
  }

  chrome.storage.sync.onChanged.addListener((changes) => {
    if (!ready || dirty || pending || !changes.prefs) return;
    const incoming = WAB.normalizePrefs(changes.prefs.newValue);
    if (JSON.stringify(incoming) === JSON.stringify(prefs)) return;
    prefs = incoming;
    applyTheme();
    emit();
  });
  chrome.storage.local.onChanged.addListener((changes) => {
    if (!changes.wabPanic) return;
    panic = changes.wabPanic.newValue === true;
    emit();
  });

  return {
    init,
    set,
    replace,
    commit,
    togglePanic,
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    onStatus: (fn) => (
      statusListeners.add(fn),
      () => statusListeners.delete(fn)
    ),
    get prefs() {
      return prefs;
    },
    get panic() {
      return panic;
    },
    get ready() {
      return ready;
    },
  };
})();
