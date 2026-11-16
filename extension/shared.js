"use strict";

// Shared settings model for the worker, content script and every extension page.
globalThis.WAB = (() => {
  const LEVELS = ["low", "medium", "high"];

  // One strength per level, shared by every surface and the page cover.
  const LEVEL_BLUR = { low: 4, medium: 8, high: 16 };
  const blurFor = (prefs) => LEVEL_BLUR[prefs.level] ?? LEVEL_BLUR.medium;

  // Surfaces are a two-level tree: each group has one or more leaves. A group
  // with no children is itself a leaf. Every leaf owns exactly one
  // `wab-off-<leaf>` class; groups are only control structure and never emit
  // CSS classes. Node ids are the storage and CSS contract, so they never move.
  const GROUPS = [
    {
      id: "messages",
      icon: "message-square",
      label: "Messages",
      desc: "Chat text, previews and replies",
      on: true,
      children: [
        {
          id: "messages_text",
          label: "Message text",
          desc: "Text, captions and polls",
          on: true,
        },
        {
          id: "previews",
          label: "Chat previews",
          desc: "The last message under each chat",
          on: true,
        },
        {
          id: "messages_out",
          label: "Your own messages",
          desc: "Messages you sent",
          on: true,
        },
        {
          id: "messages_senders",
          label: "Sender names",
          desc: "Names above group messages",
          on: true,
        },
        {
          id: "messages_cards",
          label: "Contact cards",
          desc: "Contacts shared in chats",
          on: true,
        },
        {
          id: "messages_reply",
          label: "Reply preview",
          desc: "The quote above the message box",
          on: true,
        },
        {
          id: "messages_status",
          label: "Status text",
          desc: "Text statuses and captions",
          on: true,
        },
      ],
    },
    {
      id: "media",
      icon: "image",
      label: "Photos & videos",
      desc: "Images, videos, GIFs and stickers",
      on: true,
      children: [
        {
          id: "media_photos",
          label: "Photos",
          desc: "Images and quoted photos",
          on: true,
        },
        {
          id: "media_videos",
          label: "Videos & GIFs",
          desc: "Previews and playback",
          on: true,
        },
        {
          id: "media_stickers",
          label: "Stickers",
          desc: "Sticker messages",
          on: true,
        },
        {
          id: "media_voice",
          label: "Voice & audio",
          desc: "Voice notes and audio files",
          on: true,
        },
        {
          id: "media_maps",
          label: "Locations",
          desc: "Shared map previews",
          on: true,
        },
        {
          id: "media_viewer",
          label: "Gallery & viewer",
          desc: "Info panel media and the full-screen viewer",
          on: true,
        },
        {
          id: "media_status",
          label: "Status photos & videos",
          desc: "Photos and videos in Status",
          on: true,
        },
      ],
    },
    {
      id: "links",
      icon: "link",
      label: "Links",
      desc: "Link cards and web addresses",
      on: true,
      children: [
        {
          id: "links_previews",
          label: "Link cards",
          desc: "Title, address and summary",
          on: true,
        },
        {
          id: "links_inline",
          label: "Links in messages",
          desc: "Web addresses inside messages",
          on: true,
        },
        {
          id: "links_gallery",
          label: "Links tab",
          desc: "Links tab in the info panel",
          on: true,
        },
      ],
    },
    {
      id: "docs",
      icon: "file-text",
      label: "Documents",
      desc: "File names and previews",
      on: true,
      children: [
        {
          id: "docs_chat",
          label: "In chats",
          desc: "Document cards in conversations",
          on: true,
        },
        {
          id: "docs_gallery",
          label: "Docs tab",
          desc: "Docs tab in the info panel",
          on: true,
        },
      ],
    },
    {
      id: "input",
      icon: "pencil-line",
      label: "Typing",
      desc: "What you write and search for",
      on: true,
      children: [
        {
          id: "input_chat",
          label: "Message box",
          desc: "What you're typing",
          on: true,
        },
        {
          id: "input_search",
          label: "Search",
          desc: "Text you search for",
          on: true,
        },
      ],
    },
    {
      id: "names",
      icon: "contact-round",
      label: "Names",
      desc: "Contacts and groups, not your own",
      on: false,
      children: [
        {
          id: "names_list",
          label: "Chat list & dialogs",
          desc: "Names in lists and forward menus",
          on: true,
        },
        {
          id: "names_header",
          label: "Chat header",
          desc: "The open chat's name",
          on: true,
        },
        {
          id: "names_info",
          label: "Info panel",
          desc: "Name, number and about",
          on: true,
        },
      ],
    },
    {
      id: "pics",
      icon: "circle-user-round",
      label: "Profile photos",
      desc: "Photos and letter avatars, not your own",
      on: false,
      children: [
        {
          id: "pics_list",
          label: "Chat list & dialogs",
          desc: "Photos in lists and menus",
          on: true,
        },
        {
          id: "pics_header",
          label: "Chat header",
          desc: "The open chat's photo",
          on: true,
        },
        {
          id: "pics_info",
          label: "Info panel",
          desc: "Profile photo and participants",
          on: true,
        },
      ],
    },
  ];
  const GROUP = Object.fromEntries(GROUPS.map((group) => [group.id, group]));
  const LEAVES = GROUPS.flatMap((group) =>
    (group.children?.length ? group.children : [group]).map((node) => ({
      ...node,
      group: group.id,
      sub: !!group.children?.length,
    })),
  );
  const LEAF = Object.fromEntries(LEAVES.map((leaf) => [leaf.id, leaf]));

  const DEFAULT_PANIC = "Alt+X";

  const object = (value) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const bounded = (value, min, max, fallback) => {
    const number = Number(value);
    return value !== null && value !== "" && Number.isFinite(number)
      ? Math.min(max, Math.max(min, Math.round(number)))
      : fallback;
  };
  const AUTO_HIDE_CHOICES = [0, 5, 10, 30, 60];
  const nearest = (choices, value) =>
    choices.reduce((a, b) =>
      Math.abs(b - value) < Math.abs(a - value) ? b : a,
    );
  const className = (id) => `wab-off-${id.replaceAll("_", "-")}`;

  // Configuration state, independent of the main power switch.
  function leafActive(prefs, id) {
    const leaf = LEAF[id];
    return (
      !!leaf &&
      !!prefs.toggles[leaf.group] &&
      (!leaf.sub || !!prefs.toggles[leaf.id])
    );
  }
  function groupSummary(prefs, id) {
    const group = GROUP[id];
    if (!group) return { active: false, on: 0, total: 0, caption: "Off" };
    const hasChildren = !!group.children?.length;
    const total = hasChildren ? group.children.length : 1;
    const on = hasChildren
      ? group.children.filter((child) => prefs.toggles[child.id]).length
      : prefs.toggles[id]
        ? 1
        : 0;
    const active = !!prefs.toggles[id] && on > 0;
    return {
      active,
      on,
      total,
      caption: active ? (on < total ? `${on} of ${total}` : "On") : "Off",
    };
  }
  function setGroup(prefs, id, on) {
    const group = GROUP[id];
    if (!group) return;
    // Turning a master on must never leave every child off.
    if (
      on &&
      group.children?.length &&
      !group.children.some((child) => prefs.toggles[child.id])
    )
      for (const child of group.children) prefs.toggles[child.id] = true;
    prefs.toggles[id] = on;
  }
  function setLeaf(prefs, id, on) {
    const leaf = LEAF[id];
    if (!leaf) return;
    prefs.toggles[id] = on;
    if (on) prefs.toggles[leaf.group] = true;
  }
  const revealDelay = (prefs) =>
    prefs.revealDelayMode === "instant"
      ? 0
      : prefs.revealDelayMode === "relaxed"
        ? 300
        : prefs.revealDelayMode === "custom"
          ? prefs.revealDelayMs
          : 150;

  async function sendMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.error) throw new Error(response.error);
    return response;
  }

  function hotkey(value) {
    if (typeof value !== "string") return null;
    const parts = value.replace(/\s/g, "").toUpperCase().split("+");
    const key = parts.pop();
    const aliases = {
      CONTROL: "Ctrl",
      CTRL: "Ctrl",
      ALT: "Alt",
      SHIFT: "Shift",
      META: "Meta",
      CMD: "Meta",
      COMMAND: "Meta",
    };
    const modifiers = parts.map((p) => aliases[p]);
    if (
      !/^[A-Z0-9]$/.test(key) ||
      modifiers.some((p) => !p) ||
      new Set(modifiers).size !== modifiers.length
    )
      return null;
    if (!modifiers.some((p) => ["Ctrl", "Alt", "Meta"].includes(p)))
      return null;
    return [
      ...["Ctrl", "Alt", "Shift", "Meta"].filter((p) => modifiers.includes(p)),
      key,
    ].join("+");
  }

  function eventHotkey(event) {
    const key = /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3)
      : /^Digit\d$/.test(event.code)
        ? event.code.slice(5)
        : event.key;
    return hotkey(
      [
        event.ctrlKey && "Ctrl",
        event.altKey && "Alt",
        event.shiftKey && "Shift",
        event.metaKey && "Meta",
        key,
      ]
        .filter(Boolean)
        .join("+"),
    );
  }

  const normalizePebbleTimers = (value) =>
    !Array.isArray(value)
      ? [5, 10, 15]
      : [
          ...new Set(
            value
              .filter(
                (seconds) =>
                  typeof seconds === "number" &&
                  Number.isFinite(seconds) &&
                  seconds >= 1 &&
                  seconds <= 3600,
              )
              .map(Math.round),
          ),
        ].slice(0, 3);
  function normalizePrefs(value) {
    const raw = object(value),
      toggles = object(raw.toggles);
    const panicHotkey = hotkey(raw.panicHotkey) || DEFAULT_PANIC;
    const toggleHotkey = hotkey(raw.toggleHotkey);
    const out = {
      v: 3,
      on: raw.on !== false,
      level: LEVELS.includes(raw.level) ? raw.level : "medium",
      toggles: {},
    };
    for (const group of GROUPS) {
      out.toggles[group.id] =
        typeof toggles[group.id] === "boolean"
          ? toggles[group.id]
          : group.on;
      for (const child of group.children || []) {
        out.toggles[child.id] =
          typeof toggles[child.id] === "boolean"
            ? toggles[child.id]
            : child.on;
      }
    }
    Object.assign(out, {
      pauseVideoOnBlur: raw.pauseVideoOnBlur !== false,
      autoResumeVideo: raw.autoResumeVideo !== false,
      revealDelayMode: ["instant", "normal", "relaxed", "custom"].includes(
        raw.revealDelayMode,
      )
        ? raw.revealDelayMode
        : "normal",
      revealDelayMs: bounded(raw.revealDelayMs, 0, 600, 150),
      autoHideSec: nearest(
        AUTO_HIDE_CHOICES,
        bounded(raw.autoHideSec, 0, 600, 0),
      ),
      idleTimeoutSec: bounded(raw.idleTimeoutSec, 0, 900, 30),
      coverOnLoad: raw.coverOnLoad === true,
      coverClickRelease: raw.coverClickRelease !== false,
      theme: ["system", "light", "dark"].includes(raw.theme)
        ? raw.theme
        : "system",
      panicHotkey,
      toggleHotkey: toggleHotkey !== panicHotkey ? toggleHotkey || "" : "",
      interactionMode: ["hover", "click", "hold"].includes(raw.interactionMode)
        ? raw.interactionMode
        : "hover",
      pebbleEnabled: raw.pebbleEnabled !== false,
      pebbleTimers: normalizePebbleTimers(raw.pebbleTimers),
    });
    return out;
  }

  async function loadPrefs() {
    const saved = await chrome.storage.sync.get("prefs");
    return normalizePrefs(saved.prefs);
  }

  return {
    LEVELS,
    GROUP,
    LEAVES,
    ORDER: GROUPS.map((group) => group.id),
    DEFAULT_PANIC,
    AUTO_HIDE_CHOICES,
    DEFAULTS: normalizePrefs({}),
    className,
    blurFor,
    leafActive,
    groupSummary,
    setGroup,
    setLeaf,
    revealDelay,
    sendMessage,
    eventHotkey,
    normalizePebbleTimers,
    normalizePrefs,
    loadPrefs,
  };
})();
