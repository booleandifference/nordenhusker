#!/usr/bin/env node
// Renders the favicon set from the real Pirata One face, so the mark matches
// the wordmark exactly rather than approximating it.
//
// "NH" is illegible below ~32px — the two letters merge and the H's crossbar
// disappears — so 16px ships the single "N" instead. Browsers pick per size.
//
//   node tools/generate-favicons.mjs

import pkg from "playwright";
const { chromium } = pkg;
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BG = "#FFC531";   // --bg
const FG = "#12182A";   // --ink

const SET = [
  { file: "favicon-16.png",       size: 16,  text: "N",  ratio: 0.94 },
  { file: "favicon-32.png",       size: 32,  text: "NH", ratio: 0.78 },
  { file: "favicon-48.png",       size: 48,  text: "NH", ratio: 0.78 },
  { file: "apple-touch-icon.png", size: 180, text: "NH", ratio: 0.62, pad: true },
  // PWA install icons. Chrome won't offer to install without a 192 and a 512.
  // Both are declared "any maskable" in the manifest, so the mark is drawn
  // small enough to survive Android cropping it to a circle or a squircle.
  { file: "icon-192.png",         size: 192, text: "NH", ratio: 0.52, pad: true },
  { file: "icon-512.png",         size: 512, text: "NH", ratio: 0.52, pad: true },
];

const browser = await chromium.launch();
for (const s of SET) {
  const page = await browser.newPage({
    viewport: { width: s.size, height: s.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <link href="https://fonts.googleapis.com/css2?family=Pirata+One&display=swap" rel="stylesheet">
    <style>
      html,body{margin:0;width:${s.size}px;height:${s.size}px;overflow:hidden;}
      body{background:${BG};color:${FG};font-family:"Pirata One",Cardo,Georgia,serif;
           display:grid;place-items:center;line-height:1;
           font-size:${Math.round(s.size * s.ratio)}px;letter-spacing:-0.02em;}
    </style></head><body>${s.text}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ROOT, s.file) });
  await page.close();
  console.log(`  ${s.file.padEnd(22)} ${s.size}x${s.size}  "${s.text}"`);
}
await browser.close();
