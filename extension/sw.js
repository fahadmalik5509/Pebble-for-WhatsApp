"use strict";
importScripts("shared.js");

const PANIC_FILE = "css/panic.css";
const WA_URL = { url: ["https://web.whatsapp.com/*"] };
let actions = Promise.resolve();

// All state changes and badge writes share this queue.
const serialize = (action) => {
  const result = actions.catch(() => {}).then(action);
  actions = result;
  return result;
};

async function panicState() {
  return (await chrome.storage.local.get("wabPanic")).wabPanic === true;
}

async function updateBadge() {
  const [panic, prefs] = await Promise.all([panicState(), WAB.loadPrefs()]);
  await chrome.action.setBadgeText({
    text: panic ? "!" : prefs.on ? "ON" : "OFF",
  });
  await chrome.action.setBadgeBackgroundColor({
    color: panic ? "#18171c" : prefs.on ? "#f0603f" : "#94909b",
  });
}

async function setTabPanic(tabId, on) {
  const injection = { target: { tabId }, files: [PANIC_FILE] };
  // Reloads and repeated initialization must not stack sheets.
  await chrome.scripting.removeCSS(injection);
  if (on) await chrome.scripting.insertCSS(injection);
}

async function syncPanicTabs(on) {
  const tabs = await chrome.tabs.query(WA_URL);
  const results = await Promise.allSettled(
    tabs.map((tab) => setTabPanic(tab.id, on)),
  );
  return results.filter((result) => result.status === "rejected").length;
}

// This worker owns manual page-blur writes: storage, tabs and badge update here.
async function setPanic(on) {
  if (on && !(await WAB.loadPrefs()).on) on = false;
  await chrome.storage.local.set({ wabPanic: on });
  const failedTabs = await syncPanicTabs(on);
  await updateBadge();
  return { panic: on, failedTabs };
}

async function migratePanic() {
  const legacy = await chrome.storage.sync.get("wab_panic");
  if (legacy.wab_panic === undefined) return;
  const current = await chrome.storage.local.get("wabPanic");
  if (current.wabPanic === undefined && typeof legacy.wab_panic === "boolean") {
    await chrome.storage.local.set({ wabPanic: legacy.wab_panic });
  }
  await chrome.storage.sync.remove("wab_panic");
}

async function initTab(sender) {
  await migratePanic();
  let panic = await panicState();
  if (panic && !(await WAB.loadPrefs()).on) {
    await setPanic(false);
    panic = false;
  } else {
    await updateBadge();
  }
  if (sender.tab?.id !== undefined) await setTabPanic(sender.tab.id, panic);
  return { panic };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    ![
      "WAB_INIT",
      "WAB_SAVE_PREFS",
      "WAB_TOGGLE_KEY",
      "WAB_PANIC_ENGAGE",
      "WAB_PANIC_RELEASE",
      "WAB_PANIC_KEY",
    ].includes(message?.type)
  )
    return false;
  serialize(async () => {
    if (message.type === "WAB_INIT") return initTab(sender);
    if (message.type === "WAB_SAVE_PREFS") {
      await chrome.storage.sync.set({
        prefs: WAB.normalizePrefs(message.prefs),
      });
      return;
    }
    if (message.type === "WAB_PANIC_ENGAGE") return setPanic(true);
    if (message.type === "WAB_PANIC_RELEASE") return setPanic(false);

    const prefs = await WAB.loadPrefs();
    const toggle = message.type === "WAB_TOGGLE_KEY";
    const expected = toggle ? prefs.toggleHotkey : prefs.panicHotkey;
    if (!expected || message.combo !== expected) {
      return toggle ? { on: prefs.on } : { panic: await panicState() };
    }
    if (!toggle) return setPanic(!(await panicState()));
    prefs.on = !prefs.on;
    await chrome.storage.sync.set({ prefs });
    return { on: prefs.on };
  }).then(respond, (error) => respond({ error: error.message }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.prefs) return;
  // Popup edits, synced settings and the on/off shortcut use the same path.
  const on = WAB.normalizePrefs(changes.prefs.newValue).on;
  serialize(() => (on ? updateBadge() : setPanic(false))).catch(console.error);
});

async function initialize() {
  const { panic } = await initTab({});
  await syncPanicTabs(panic);
}
chrome.runtime.onInstalled.addListener(() =>
  serialize(initialize).catch(console.error),
);
chrome.runtime.onStartup.addListener(() =>
  serialize(initialize).catch(console.error),
);
