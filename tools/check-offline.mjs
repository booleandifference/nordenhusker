// Verify the service worker: that it installs, precaches every audio clip, and
// that the site still works with the network cut.
//
// Worth having as a script rather than a manual click-through — a broken
// service worker fails silently, and the failure mode people notice is "the
// app is stuck on an old version", long after the deploy.
//
//   node tools/check-offline.mjs

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".mp3": "audio/mpeg", ".png": "image/png", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path === "/") path = "/index.html";
    // mimic Firebase cleanUrls, so /til-norge resolves the way it will in production
    let file = join(ROOT, path);
    try { await readFile(file); } catch { file = join(ROOT, path + ".html"); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  s.listen(0, "127.0.0.1", () => ok(s));
});

const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
};

try {
  await page.goto(origin + "/", { waitUntil: "load" });

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, active: !!r.active };
  });
  check("service worker activates", reg.active, reg.scope);

  // the audio precache runs in the background after activation
  const expected = JSON.parse(await readFile(join(ROOT, "audio/manifest.json"), "utf8"))
    .clips.flatMap((c) => Object.values(c.takes ?? {}).map((t) => t.file)).length;

  const cached = await page.evaluate(async (want) => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const cache = await caches.open("media-v1");
      const n = (await cache.keys()).length;
      if (n >= want || Date.now() > deadline) return n;
      await new Promise((r) => setTimeout(r, 500));
    }
  }, expected);
  check(`all ${expected} audio files precached`, cached === expected, `cached ${cached}`);

  const shell = await page.evaluate(async () => {
    const key = (await caches.keys()).find((k) => k.startsWith("shell-"));
    return { key, urls: (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname) };
  });
  for (const p of ["/", "/til-norge", "/til-danmark", "/manifest.webmanifest"]) {
    check(`shell holds ${p}`, shell.urls.includes(p));
  }

  // --- cut the network ---
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  const offline = await page.evaluate(() => ({
    title: document.title,
    cards: document.querySelectorAll("#wordGrid article").length,
    tabs: document.querySelectorAll(".tab").length,
  }));
  check("page loads offline", offline.cards === 30 && offline.tabs === 5, `${offline.cards} cards, ${offline.tabs} tabs`);

  const clip = await page.evaluate(async () => {
    const m = await (await fetch("/audio/manifest.json")).json();
    const file = Object.values(m.clips[0].takes)[0].file;
    const r = await fetch("/" + file);
    return { file, ok: r.ok, bytes: (await r.blob()).size };
  });
  check("audio plays offline", clip.ok && clip.bytes > 1000, `${clip.file} ${clip.bytes}b`);

  await page.goto(origin + "/til-danmark", { waitUntil: "load" });
  const other = await page.evaluate(() => document.documentElement.lang);
  check("other landing page loads offline", other === "nb", `lang=${other}`);
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
