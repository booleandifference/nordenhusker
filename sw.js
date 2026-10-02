// Service worker: makes Nordenhusker installable and usable offline.
//
// The whole point of going offline here is the audio — this is a
// pronunciation tool, and a commute is exactly where you'd want it. So every
// clip is precached, not just the ones you happen to have played. The file
// list is read from audio/manifest.json rather than hardcoded, so regenerating
// the audio does not mean editing this file.
//
// VERSION is stamped by tools/prerender.mjs from the content of the three HTML
// pages. Bumping it drops the old caches on activate.

const VERSION = "a6bf0b326aaf";
const SHELL = `shell-${VERSION}`;
const MEDIA = "media-v1"; // clip files are immutable; keyed by name, never restamped

const PAGES = ["/", "/til-norge", "/til-danmark"];
const ASSETS = [
  "/audio/manifest.json",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// Install: the shell only, so the install finishes quickly.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll([...PAGES, ...ASSETS]))
      .then(() => self.skipWaiting()),
  );
});

// Activate: take over, drop superseded shells, then pull down the audio in the
// background. If that is interrupted, the fetch handler fills the gaps later.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
    await precacheAudio();
  })());
});

async function precacheAudio() {
  try {
    const manifest = await (await fetch("/audio/manifest.json", { cache: "reload" })).json();
    const files = new Set();
    for (const clip of manifest.clips ?? []) {
      for (const take of Object.values(clip.takes ?? {})) if (take.file) files.add("/" + take.file);
    }
    const cache = await caches.open(MEDIA);
    const missing = [];
    for (const file of files) if (!(await cache.match(file))) missing.push(file);

    // In batches: several hundred parallel requests would stall the network
    // and can have the browser shut the worker down mid-install.
    for (let i = 0; i < missing.length; i += 12) {
      await Promise.allSettled(missing.slice(i, i + 12).map((f) => cache.add(f)));
    }
  } catch {
    // Offline or a bad manifest: the clips just stay lazily cached instead.
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts etc. stay the browser's business

  // HTML is network-first: an installed copy must never pin someone to an old
  // version of the page while they are online.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(request)) ?? (await caches.match("/")) ?? Response.error();
      }
    })());
    return;
  }

  // Everything else is cache-first — clips and icons don't change under a name.
  event.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(url.pathname.startsWith("/audio/") ? MEDIA : SHELL);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      return Response.error();
    }
  })());
});
