// Developer-only browser harness. No dependencies or real WhatsApp account.
// Run: node dev/browser-check.cjs [extension-directory] [checks-file].
// Default: the current extension with browser-checks.js.
// Scripts and styles are served directly from this extension; Chrome APIs are mocked.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "../extension");
const checksFile = path.basename(process.argv[3] || "browser-checks.js");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);
const contentScripts = manifest.content_scripts[0].js
  .map((file) => `<script src="/${file}"></script>`)
  .join("");
function makeEvent() {
  const listeners = new Set();
  return {
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    fire: (...args) => {
      for (const fn of [...listeners]) fn(...args);
    },
  };
}
const hub = `const makeEvent=${makeEvent}; window.hub={sync:{},local:{},changed:makeEvent(),runtime:[],badge:'',errors:[]}; window.addEventListener('error',e=>hub.errors.push(e.message)); window.addEventListener('unhandledrejection',e=>hub.errors.push(String(e.reason)));`;
function installChromeMock(manifest, role, makeEvent) {
  const hub = parent.hub;
  const event = makeEvent;
  const area = (name) => ({
    get: (keys, callback) => {
      const data = hub[name];
      const value =
        keys == null
          ? structuredClone(data)
          : Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys])
                .filter((k) => k in data)
                .map((k) => [k, structuredClone(data[k])]),
            );
      if (callback) queueMicrotask(() => callback(value));
      return Promise.resolve(value);
    },
    set: async (values) => {
      const changes = {};
      for (const [k, v] of Object.entries(values)) {
        if (JSON.stringify(hub[name][k]) === JSON.stringify(v)) continue;
        changes[k] = {
          oldValue: structuredClone(hub[name][k]),
          newValue: structuredClone(v),
        };
        hub[name][k] = structuredClone(v);
      }
      if (Object.keys(changes).length)
        queueMicrotask(() => hub.changed.fire(changes, name));
    },
    remove: async (keys) => {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (!(k in hub[name])) continue;
        changes[k] = { oldValue: hub[name][k] };
        delete hub[name][k];
      }
      if (Object.keys(changes).length)
        queueMicrotask(() => hub.changed.fire(changes, name));
    },
    onChanged: {
      addListener: (fn) => {
        const wrapped = (changes, area) => {
          if (area === name) fn(changes);
        };
        fn._wrapped = wrapped;
        hub.changed.addListener(wrapped);
      },
      removeListener: (fn) => hub.changed.removeListener(fn._wrapped),
    },
  });
  const send = async (message, which) => {
    for (let n = 0; n < 100; n++) {
      const target = hub.runtime.find((x) => x.role === which);
      if (target)
        return new Promise((resolve, reject) => {
          try {
            const async = target.fn(
              message,
              role === "content" ? { tab: { id: 1 } } : {},
              resolve,
            );
            if (async !== true && message.type !== "WAB_STATUS")
              reject(new Error("No responder"));
          } catch (e) {
            reject(e);
          }
        });
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Worker not ready");
  };
  window.chrome = {
    storage: {
      sync: area("sync"),
      local: area("local"),
      onChanged: hub.changed,
    },
    runtime: {
      id: "fixture-extension",
      getManifest: () => manifest,
      getURL: (p) => location.origin + "/" + p + "?role=rules",
      onMessage: {
        addListener: (fn) => hub.runtime.push({ role, fn }),
        removeListener: (fn) => {
          hub.runtime = hub.runtime.filter((x) => x.fn !== fn);
        },
      },
      sendMessage: (msg) => send(msg, "worker"),
      onInstalled: event(),
      onStartup: event(),
    },
    action: {
      setBadgeText: async ({ text }) => (hub.badge = text),
      setBadgeBackgroundColor: async () => {},
    },
    tabs: {
      query: async () => [
        { id: 1, active: true, url: "https://web.whatsapp.com/" },
      ],
      sendMessage: (id, msg) => send(msg, "content"),
      create: async ({ url }) => {
        parent.document.querySelector("#rules").src = url;
        return { id: 2 };
      },
    },
    scripting: {
      removeCSS: async () => {
        parent.document
          .querySelector("#content")
          .contentDocument.querySelector("#test-panic")
          ?.remove();
      },
      insertCSS: async () => {
        const doc = parent.document.querySelector("#content").contentDocument;
        if (doc.querySelector("#test-panic")) return;
        const link = doc.createElement("link");
        link.id = "test-panic";
        link.rel = "stylesheet";
        link.href = "/css/panic.css";
        await new Promise((resolve, reject) => {
          link.onload = resolve;
          link.onerror = reject;
          doc.head.append(link);
        });
      },
    },
  };
  window.importScripts = () => {};
  window.addEventListener("error", (e) =>
    hub.errors.push(role + ": " + e.message),
  );
  window.addEventListener("unhandledrejection", (e) =>
    hub.errors.push(role + ": " + e.reason),
  );
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (text) => {
        hub.clipboard = text;
      },
    },
    configurable: true,
  });
}
const mock = (role) =>
  `(${installChromeMock})(${JSON.stringify(manifest)},${JSON.stringify(role)},${makeEvent});`;
const pixel =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#00a884"/></svg>',
  );
const content = `<!doctype html><meta charset="utf-8"><title>Privacy test content</title>${manifest.content_scripts[0].css.map((p) => '<link rel="stylesheet" href="/' + p + '">').join("")}<style>body{font:14px/19px Arial;background:#111b21;color:#e9edef;margin:14px}header{padding:12px}img{width:40px;height:40px}#pane-side{display:flex;gap:12px}.card{background:#005c4b;padding:16px;margin:12px 0;border-radius:8px}[data-testid="msg-container"]{margin:15px 0;padding:12px;background:#005c4b;border-radius:8px}a{color:#53bdeb}#grid{display:flex;gap:12px}.thumb{width:90px;height:70px;background:#00a884}[data-testid="link-preview-container"]{padding:12px;border:1px solid #396b62;border-radius:6px}footer{padding:10px;border:1px solid #666}input{width:180px}video{width:150px;height:80px;background:#22a884}</style>
<div id="side"><input id="search" role="textbox" placeholder="Search or start a new chat"></div>
<div id="pane-side"><div role="row"><div data-testid="message-yourself-row"><div data-testid="cell-frame-container"><img id="selfPic" alt="avatar" src="${pixel}"><div data-testid="cell-frame-title"><span id="selfName" title="Me (You)">Me (You)</span></div><div data-testid="cell-frame-secondary"><span id="selfPreview">Private self preview</span><div role="gridcell" id="selfBadge">3</div></div></div></div></div><div role="row"><div data-testid="cell-frame-container"><img id="otherPic" alt="avatar" src="${pixel}"><div data-testid="cell-frame-title"><span title="Contact" id="otherName">Contact</span></div><div data-testid="cell-frame-secondary"><span id="preview">Private preview</span><div role="gridcell" id="badge">3 <span id="bell">Bell</span></div></div></div></div></div>
<div id="main"><header><img alt="avatar" id="headerPic" src="${pixel}"><span dir="auto" title="Contact" id="headerName">Contact</span></header>
<div data-testid="msg-container" id="message1"><span data-testid="selectable-text" id="text1">Private message one <a data-testid="selectable-text" href="https://example.com" id="url">https://example.com/private</a></span><span id="reaction">Reaction</span><span id="timestamp">12:00</span></div>
<div data-testid="msg-container" id="message2"><div data-testid="link-preview-container" id="linkCard"><span data-testid="link-preview-title" id="linkTitle">Private link title</span><span data-testid="url-element">example.com</span><span data-testid="link-description">Private description</span></div><div data-testid="quoted-message-preview" id="quote"><span data-testid="selectable-text" id="quoteText">Quoted private text</span></div><span data-testid="selectable-text">Second message</span></div>
<div data-testid="msg-container"><div data-testid="document-thumb" id="doc">Private document.pdf</div><span data-testid="sticker-container" id="stickerContainer"><div role="button"><img id="sticker" alt="Sticker" src="${pixel}"><canvas id="animatedSticker" width="80" height="80" style="display:none"></canvas></div></span><div data-testid="image-thumb"><img id="chatPhoto" alt="photo" src="${pixel}"></div><video id="video" muted loop></video></div>
<footer><div contenteditable="true" data-testid="conversation-compose-box-input" id="composer">Private draft</div></footer></div>
<div data-testid="drawer-right"><div><span data-testid="contact-info-subtitle selectable-text" id="selfDrawerName">Me</span><span data-testid="you-label">(You)</span></div><div data-testid="chat-subtitle" id="settingsDescription">Off</div><svg id="selfDrawerPic" width="30" height="30"><image href="${pixel}" width="30" height="30"/></svg><div id="grid"><div data-testid="media-canvas" id="tile1"><div data-testid="media-canvas-img" class="thumb">Photo one</div></div><div data-testid="media-canvas" id="tile2"><div data-testid="media-canvas-img" class="thumb">Photo two</div></div><div data-testid="media-canvas" id="gifTile"><div data-testid="media-canvas-img media-canvas-video-thumb" class="thumb" id="gifThumb"><img id="nestedThumbImage" src="${pixel}"></div></div><div data-testid="media-canvas" id="audioTile"><div data-testid="media-canvas-img media-canvas-audio-thumb" class="thumb" id="audioThumb"></div></div></div></div>
<div role="dialog"><div role="listitem" id="reactor"><div data-testid="cell-frame-title" id="reactorName">Reactor</div><img alt="avatar" src="${pixel}"></div></div><div id="custom">Custom private content</div>
<script src="/mock.js?role=content"></script>${contentScripts}`;
const lifecyclePage = /* HTML */ `<!doctype html><meta charset="utf-8" /><title>
    Extension startup lifecycle checks
  </title>
  <style>
    body {
      font: 15px Arial;
      margin: 24px;
      background: #edf2f4;
      color: #152932;
    }
    h1 {
      font-size: 22px;
    }
    pre {
      background: white;
      padding: 18px;
      font: 14px/1.6 monospace;
    }
    iframe {
      width: 400px;
      height: 100px;
      border: 1px solid #bdc9cf;
    }
  </style>
  <h1>Extension startup lifecycle checks</h1>
  <p>
    Actual content script; controlled extension API invalidation in isolated
    test frames.
  </p>
  <button id="run">Run lifecycle checks</button>
  <pre id="output">Ready</pre>
  <div id="frames"></div>
  <script>
    document.getElementById("run").onclick = async () => {
      const results = [];
      for (const testCase of [
        "already-invalid",
        "registration",
        "sync-throw",
        "both-reads",
        "local-throw",
        "after-await",
        "message-rejection",
        "ordinary-error",
        "normal",
      ]) {
        const frame = document.createElement("iframe");
        frame.src = "/lifecycle-frame?case=" + testCase;
        await new Promise((resolve) => {
          frame.onload = resolve;
          document.getElementById("frames").append(frame);
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const state = frame.contentWindow.lifecycleState,
          root = frame.contentDocument.documentElement;
        const invalid = ![
          "ordinary-error",
          "normal",
          "already-invalid",
        ].includes(testCase);
        const expected = invalid
          ? root.classList.contains("wab-off") && state.listeners === 0
          : testCase === "already-invalid"
            ? state.calls.length === 0 && state.listeners === 0
            : testCase === "ordinary-error"
              ? state.warnings.length === 1 &&
                state.warnings[0].includes("Storage read failed")
              : state.calls.join(",") === "sync.get,local.get,sendMessage" &&
                state.listeners === 2;
        results.push({
          testCase,
          pass: state.errors.length === 0 && expected,
          ...structuredClone(state),
          classes: root.className,
        });
        document.getElementById("output").textContent = results
          .map(
            (r) =>
              (r.pass ? "PASS " : "FAIL ") +
              r.testCase +
              "; errors=" +
              r.errors.length +
              "; remaining listeners=" +
              r.listeners,
          )
          .join("\\n");
        frame.remove();
      }
      window.results = results;
      const passed = results.filter((r) => r.pass).length;
      document.title =
        passed + "/" + results.length + " lifecycle checks passed";
      document.getElementById("output").textContent =
        document.title +
        "\\n\\n" +
        document.getElementById("output").textContent;
    };
  </script>`;
const lifecycleMock =
  "(() => {\n  const testCase=new URLSearchParams(location.search).get('case');\n  let valid=testCase!=='already-invalid';\n  const state=window.lifecycleState={testCase,errors:[],warnings:[],calls:[],listeners:0};\n  window.addEventListener('error',e=>state.errors.push(e.message));\n  window.addEventListener('unhandledrejection',e=>state.errors.push('Unhandled promise: '+e.reason?.message));\n  console.warn=(...args)=>state.warnings.push(args.join(' '));\n  const invalidate=()=>{valid=false;return new Error('Extension context invalidated.')};\n  const event=()=>{const listeners=new Set();return{\n    addListener(fn){if(testCase==='registration'){throw invalidate()}listeners.add(fn);state.listeners++},\n    removeListener(fn){if(listeners.delete(fn))state.listeners--}\n  }};\n  const runtime={get id(){return valid?'lifecycle-fixture':undefined},onMessage:event(),sendMessage(){\n    state.calls.push('sendMessage');\n    if(testCase==='message-rejection')return Promise.reject(invalidate());\n    return Promise.resolve({panic:false});\n  }};\n  const sync={onChanged:event(),get(){\n    state.calls.push('sync.get');\n    if(testCase==='sync-throw')throw invalidate();\n    if(testCase==='both-reads')return Promise.reject(new Error('Extension context invalidated.'));\n    if(testCase==='ordinary-error')return Promise.reject(new Error('Storage read failed'));\n    if(testCase==='after-await')return Promise.resolve().then(()=>{valid=false;return{prefs:{v:3,idleTimeoutSec:0}}});\n    return Promise.resolve({prefs:{v:3,idleTimeoutSec:0}});\n  }};\n  const local={onChanged:event(),get(){\n    state.calls.push('local.get');\n    if(['sync-throw','both-reads','local-throw'].includes(testCase))throw invalidate();\n    return Promise.resolve({});\n  }};\n  window.chrome={runtime,storage:{sync,local}};\n})();";
const pendingPage = /* HTML */ `<!doctype html><meta charset="utf-8" /><title>
    Pending playback check
  </title>
  <link rel="stylesheet" href="/css/base.css" /><link
    rel="stylesheet"
    href="/css/features/media.css"
  />
  <style>
    body {
      font: 16px Arial;
      background: #edf2f4;
      padding: 24px;
    }
    pre {
      padding: 18px;
      background: white;
    }
  </style>
  <h1>Delayed video startup check</h1>
  <p>A real media stream supplies its first frame after the play request.</p>
  <button id="run">Run delayed startup check</button>
  <pre id="result">Ready</pre>
  <div data-testid="media-viewer-modal">
    <div data-testid="media-video">
      <video id="v" muted width="180" height="90"></video>
      <div role="group"><div></div></div>
      <button id="toggle">
        <svg><title>ic-play-arrow-filled</title></svg>
      </button>
    </div>
  </div>
  <script src="/lifecycle-mock.js"></script>
  ${contentScripts}
  <script>
    document.getElementById("run").onclick = async () => {
      const v = document.getElementById("v"),
        icon = document.querySelector("#toggle title"),
        canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 90;
      const state = (window.result = {
        fulfilled: false,
        error: null,
        controllerPauses: 0,
      });
      v.muted = true;
      v.srcObject = canvas.captureStream(0);
      const pause = () => {
        state.controllerPauses++;
        v.pause();
      };
      document.getElementById("toggle").onclick = pause;
      document.querySelector('[role="group"]').firstElementChild.onclick =
        pause;
      if (new URLSearchParams(location.search).get("toolbar") !== "visible")
        document.getElementById("toggle").remove();
      v.addEventListener(
        "playing",
        () => (icon.textContent = "ic-pause-filled"),
      );
      const pending = v.play().then(
        () => (state.fulfilled = true),
        (error) => (state.error = error.name),
      );
      setTimeout(() => {
        canvas.getContext("2d").fillRect(0, 0, 180, 90);
        v.srcObject.getVideoTracks()[0].requestFrame();
      }, 180);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await pending;
      state.paused = v.paused;
      state.errors = lifecycleState.errors;
      state.pass =
        state.fulfilled &&
        state.error === null &&
        state.paused &&
        state.controllerPauses === 1 &&
        state.errors.length === 0;
      document.getElementById("result").textContent =
        (state.pass ? "PASS" : "FAIL") + "\\n" + JSON.stringify(state, null, 2);
      document.title =
        (state.pass ? "PASS" : "FAIL") + " delayed video startup";
      v.srcObject.getTracks().forEach((t) => t.stop());
    };
  </script>`;
const page = `<!doctype html><meta charset="utf-8"><title>Pebble browser verification</title><style>body{font:15px Arial;margin:16px;background:#edf2f4;color:#152932}h1{font-size:20px}iframe{vertical-align:top;border:1px solid #bcc9cf;border-radius:8px;background:white}#content{width:850px;height:930px}#popup{width:400px;height:600px}#rules{width:400px;height:600px}#result{height:170px;overflow:auto;white-space:pre-wrap;font:13px monospace;background:white;padding:12px}button{padding:8px 14px}</style><script src="/hub.js"></script><h1>Pebble browser verification</h1><p>Actual extension scripts and styles with sample content and test storage. The live WhatsApp account is separate.</p><button id="run">Run browser checks</button> <a href="/lifecycle">Startup lifecycle checks</a> · <a href="/pending-play">Delayed playback (hidden toolbar)</a> · <a href="/pending-play?toolbar=visible">Delayed playback (visible toolbar)</a><pre id="result">Ready</pre><iframe src="/worker" hidden></iframe><div><iframe id="content" name="content" src="/content-fixture"></iframe> <iframe id="popup" name="popup" src="/popup/popup.html?role=popup"></iframe></div><iframe id="rules" name="rules" src="/popup/popup.html?role=rules"></iframe><script src="/dev/${checksFile}"></script>`;
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body,
      type = "text/html";
    if (url.pathname === "/") body = page;
    else if (url.pathname === "/pending-play") body = pendingPage;
    else if (url.pathname === "/lifecycle") body = lifecyclePage;
    else if (url.pathname === "/lifecycle-mock.js") {
      body = lifecycleMock;
      type = "text/javascript";
    } else if (url.pathname === "/lifecycle-frame")
      body =
        '<link rel="stylesheet" href="/css/base.css"><div id="main"><div data-testid="msg-container"><span data-testid="selectable-text">Sample</span></div></div><script src="/lifecycle-mock.js"></script>' +
        contentScripts;
    else if (url.pathname === "/hub.js") {
      body = hub;
      type = "text/javascript";
    } else if (url.pathname === "/mock.js") {
      body = mock(url.searchParams.get("role") || "content");
      type = "text/javascript";
    } else if (url.pathname === "/dev/" + checksFile) {
      body = fs.readFileSync(path.join(__dirname, checksFile));
      type = "text/javascript";
    } else if (url.pathname === "/content-fixture") body = content;
    else if (url.pathname === "/worker")
      body =
        '<script src="/mock.js?role=worker"></script><script src="/shared.js"></script><script src="/sw.js"></script>';
    else {
      const file = path.resolve(root, "." + decodeURIComponent(url.pathname));
      if (
        !file.startsWith(path.resolve(root) + path.sep) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile()
      ) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      body = fs.readFileSync(file);
      type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : file.endsWith(".woff2")
              ? "font/woff2"
              : file.endsWith(".png")
                ? "image/png"
                : "text/html";
      if (file.endsWith(".html"))
        body = body
          .toString()
          .replace(
            "<head>",
            '<head><script src="/mock.js?role=' +
              (url.searchParams.get("role") || "popup") +
              '"></script>',
          );
    }
    res.writeHead(200, {
      "Content-Type": type + "; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(body);
  })
  .listen(8765, "127.0.0.1", () =>
    console.log("Pebble browser verification: http://127.0.0.1:8765"),
  );
