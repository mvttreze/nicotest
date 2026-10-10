// Copies the repo-root web app into nico-mobile/www for Capacitor builds.
// Single source of truth stays at the root (same files Render publishes).
// Run: npm run sync:web   (or: npm run sync  to copy + `cap sync`)
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const WWW = path.resolve(__dirname, "..", "www");

// Keep in sync with render.yaml's static publish list + sw.js APP_SHELL.
const FILES = [
  "index.html",
  "manifest.json",
  "sw.js",
  "script.js",
  "nico-ui.js",
  "style.css",
  "nico-redesign.css",
  "icon.svg",
  "icon-32.png",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon-dark-512.png",
];
const DIRS = ["icons"];

fs.mkdirSync(WWW, { recursive: true });

let missing = [];
for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) {
    missing.push(file);
    continue;
  }
  fs.copyFileSync(src, path.join(WWW, file));
  console.log(`copied ${file}`);
}
for (const dir of DIRS) {
  const src = path.join(ROOT, dir);
  if (!fs.existsSync(src)) {
    missing.push(`${dir}/`);
    continue;
  }
  fs.cpSync(src, path.join(WWW, dir), { recursive: true });
  console.log(`copied ${dir}/`);
}

if (missing.length) {
  console.warn(`WARNING: missing sources (skipped): ${missing.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`done -> ${WWW}`);
}
