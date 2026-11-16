// Resolve Playwright from this machine. By default it resolves from the
// repository's own dependencies. Set PEBBLE_PLAYWRIGHT_ROOT to a directory
// containing Playwright's package.json to point somewhere else.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.PEBBLE_PLAYWRIGHT_ROOT;
const require = createRequire(
  root ? pathToFileURL(path.join(root, "package.json")) : import.meta.url,
);

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  throw new Error(
    "Playwright is required. Install it (npm install playwright) or set PEBBLE_PLAYWRIGHT_ROOT to a directory containing Playwright's package.json.",
  );
}

export { chromium };
