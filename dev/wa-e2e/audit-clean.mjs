import fs from "node:fs";
import path from "node:path";
const root = path.resolve("extension");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const icons = new Set([...read("ui/icons.js").matchAll(/^\s{2}"?([a-z0-9-]+)"?:/gm)].map((m) => m[1]));
const files = ["shared.js", "ui/controls.js", "popup/popup.js"];
const used = new Set();
for (const file of files) {
  const text = read(file);
  for (const m of text.matchAll(/(?:icon|iconName):\s*"([^"]+)"/g)) used.add(m[1]);
  for (const m of text.matchAll(/icon\("([^"]+)"/g)) used.add(m[1]);
}
// The popup tab table names icons indirectly.
for (const m of read("popup/popup.js").matchAll(/\[\s*"[^"]+",\s*"[^"]+",\s*"([a-z0-9-]+)"\s*\]/g))
  used.add(m[1]);

const missing = [...used].filter((name) => !icons.has(name));
console.log("ICONS used", used.size, "defined", icons.size, "missing", missing);
const base = read("css/base.css");
const featureVars = new Set();
for (const file of fs.readdirSync(path.join(root, "css/features"))) {
  const text = fs.readFileSync(path.join(root, "css/features", file), "utf8");
  for (const m of text.matchAll(/var\((--wab-[a-z-]+)/g)) featureVars.add(m[1]);
}
const defined = new Set([...base.matchAll(/(--wab-[a-z-]+)\s*:/g)].map((m) => m[1]));
const dynamic = new Set(["--wab-text-clip", "--wab-msg-halo", "--wab-reveal", "--wab-duration", "--wab-delay"]);
const undefined = [...featureVars].filter((v) => !defined.has(v) && !dynamic.has(v));
console.log("FEATURE VARS", [...featureVars].sort().join(", "));
console.log("UNDEFINED", undefined);
const leafCss = fs.readdirSync(path.join(root, "css/features")).map((f) => fs.readFileSync(path.join(root, "css/features", f), "utf8")).join("\n");
const leafClasses = [...leafCss.matchAll(/wab-off-([a-z-]+)/g)].map((m) => m[1]);
const uniqueLeaf = [...new Set(leafClasses)];
console.log("LEAF CLASSES in CSS", uniqueLeaf.length, uniqueLeaf.join(", "));