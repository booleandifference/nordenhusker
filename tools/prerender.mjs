// Generate everything about index.html that a crawler needs but the runtime
// builds: the pre-rendered word cards, the schema.org JSON-LD, and the two
// audience-specific landing pages.
//
// Why cards are pre-rendered: both grids are built at runtime by
// renderWords()/renderSwapWords() via innerHTML, so a crawler that doesn't
// execute JS saw two empty <div>s — none of the actual searchable content (the
// word pairs) was in the HTML. The da-no cards are written back into
// index.html between the <!--prerender:*--> markers; at runtime the app still
// wipes the grids and re-renders, so this is progressive enhancement, not a
// second rendering path. There is exactly one card template, the one in
// index.html.
//
// Why there are variant pages: one URL means one <title>, one meta
// description and one language, but the site serves two audiences searching
// for different things — Danes moving to Norway and Norwegians moving to
// Denmark. /til-norge and /til-danmark are the same app, each pre-set to its
// direction and described in its own language, with hreflang tying the set
// together. They are produced by loading the real page, switching direction,
// and serializing the result, so they cannot drift from index.html.
//
// The JSON-LD is built from the same rendered cards, for the same reason: the
// word pairs are described once, in index.html, and everything else is derived.
// Note there is no Google rich result for DefinedTerm — this is about machine-
// readable content, not stars in the SERP. See README.
//
// Re-run after changing WORDS, SWAP_WORDS, the card markup, or anything in the
// head or the direction-dependent UI strings:
//   npm run prerender
// It is idempotent: the generated files are rewritten from the data each time.

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const FILE = join(ROOT, "index.html");
const SITE = "https://nordenhusker.dk";

// The two landing pages. Copy is a brand-voice call — edit it here, not in the
// generated files, which are overwritten on every run.
const VARIANTS = [
  {
    file: "til-norge.html",
    path: "/til-norge",
    direction: "da-no",
    lang: "da",
    inLanguage: ["da"],
    findingVoice: "Finder stemme…",
    findingVoices: "Finder stemmer…",
    bannerNone:
      "⚠ Ingen stemme fundet. Prøv Chrome eller Edge — de har normalt indbyggede skandinaviske stemmer.",
    title: "Flytter du til Norge? Sådan lærer du norsk — Nordenhusker",
    description:
      "Du kan allerede 90 % af norsk. Nordenhusker øver kun forskellen: ordene der snyder, " +
      "udtalen og tallene — med lyd på begge sprog. Gratis, ingen login.",
  },
  {
    file: "til-danmark.html",
    path: "/til-danmark",
    direction: "no-da",
    lang: "nb",
    inLanguage: ["nb"],
    findingVoice: "Finner stemme…",
    findingVoices: "Finner stemmer…",
    bannerNone:
      "⚠ Ingen stemme funnet. Prøv Chrome eller Edge — de har normalt skandinaviske stemmer innebygget.",
    title: "Flytter du til Danmark? Slik lærer du dansk — Nordenhusker",
    description:
      "Du kan allerede 90 % av dansk. Nordenhusker øver bare forskjellen: ordene som lurer, " +
      "uttalen og tallene — med lyd på begge språk. Gratis, ingen innlogging.",
  },
];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

// Serve the repo root: the app fetches audio/manifest.json at startup, which
// browsers block over file://.
function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(ROOT, path === "/" ? "index.html" : path);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

function inject(html, id, markup) {
  const open = `<!--prerender:${id}-->`;
  const close = "<!--/prerender-->";
  const from = html.indexOf(open);
  if (from === -1) throw new Error(`missing ${open} in index.html`);
  const to = html.indexOf(close, from);
  if (to === -1) throw new Error(`missing ${close} after ${open}`);
  return html.slice(0, from + open.length) + markup + html.slice(to);
}

// One card per line, so the diff stays readable.
function tidy(markup) {
  return "\n" + markup.replaceAll("</article><article", "</article>\n<article").trim() + "\n";
}

// Read the pairs back out of the cards the app just rendered, so the structured
// data cannot describe something the page doesn't show.
function readTerms(page, gridId) {
  return page.$$eval(`#${gridId} article`, (cards) =>
    cards.map((card) => {
      const meanings = card.querySelectorAll(".meaning-text");
      return {
        id: card.dataset.id,
        word: card.querySelector(".word").textContent.trim(),
        da: meanings[0]?.textContent.trim(),
        no: meanings[1]?.textContent.trim(),
      };
    }),
  );
}

function definedTerm(setId, t, description) {
  return {
    "@type": "DefinedTerm",
    // the "sw-" prefix namespaces localStorage progress, not the term itself
    "@id": `${SITE}/#term-${setId}-${t.id.replace(/^sw-/, "")}`,
    name: t.word,
    description,
    inDefinedTermSet: { "@id": `${SITE}/#${setId}` },
  };
}

function buildJsonLd(falseFriends, swaps) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${SITE}/#app`,
        name: "Nordenhusker",
        url: `${SITE}/`,
        description:
          "Flytter du mellem Danmark og Norge? Nordenhusker øver præcis forskellen: " +
          "ordene der snyder, udtalen og tal — med lyd på begge sprog. Gratis, ingen login.",
        applicationCategory: "EducationalApplication",
        inLanguage: ["da", "nb"],
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "DKK" },
        teaches:
          "Forskellene mellem dansk og norsk bokmål: falske venner, ord der byttes ud, " +
          "udtale, tal og klokkeslæt.",
        audience: {
          "@type": "Audience",
          audienceType:
            "Danskere der flytter til Norge, og nordmænd der flytter til Danmark",
        },
      },
      {
        "@type": "DefinedTermSet",
        "@id": `${SITE}/#ord-der-snyder`,
        name: "Ord der snyder — falske venner mellem dansk og norsk",
        description:
          "Ord der staves ens på dansk og norsk, men betyder noget forskelligt.",
        inLanguage: ["da", "nb"],
        hasDefinedTerm: falseFriends.map((t) =>
          definedTerm("ord-der-snyder", t, `Betyder «${t.da}» på dansk, men «${t.no}» på norsk.`),
        ),
      },
      {
        "@type": "DefinedTermSet",
        "@id": `${SITE}/#ord-der-byttes`,
        name: "Ord der byttes — samme betydning, forskelligt ord",
        description:
          "Højfrekvente ord der betyder det samme på dansk og norsk, men hvor sprogene bruger hvert sit ord.",
        inLanguage: ["da", "nb"],
        hasDefinedTerm: swaps.map((t) => ({
          ...definedTerm("ord-der-byttes", t, `Norsk «${t.no}» svarer til dansk «${t.da}».`),
          name: t.no,
          alternateName: t.da,
        })),
      },
    ],
  };
}

function checkTerms(jsonLd) {
  const terms = jsonLd["@graph"].reduce((n, node) => n + (node.hasDefinedTerm?.length ?? 0), 0);
  if (terms !== 50) throw new Error(`expected 50 defined terms, built ${terms}`);
  for (const node of jsonLd["@graph"]) {
    for (const t of node.hasDefinedTerm ?? []) {
      if (!t.name || !t.description.includes("«")) throw new Error(`incomplete term: ${t["@id"]}`);
    }
  }
  return terms;
}

// "<" is escaped so the payload can never close its own <script> element.
const ldScript = (jsonLd) =>
  '\n<script type="application/ld+json">\n' +
  JSON.stringify(jsonLd, null, 2).replaceAll("<", "\\u003c") +
  "\n</" + "script>\n";

// Point the head at this variant, and undo the few things the runtime did to
// widgets that have nothing to do with direction — otherwise the build
// machine's speech voices get baked into the shipped HTML.
function retarget(cfg) {
  const url = cfg.url;
  const attr = (sel, name, value) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    el.setAttribute(name, value);
  };

  document.documentElement.lang = cfg.lang;
  document.title = cfg.title;
  attr('meta[name="description"]', "content", cfg.description);
  attr('link[rel="canonical"]', "href", url);
  attr('meta[property="og:url"]', "content", url);
  attr('meta[property="og:title"]', "content", cfg.title);
  attr('meta[property="og:description"]', "content", cfg.description);
  attr('meta[name="twitter:title"]', "content", cfg.title);
  attr('meta[name="twitter:description"]', "content", cfg.description);

  const ld = document.querySelector('script[type="application/ld+json"]');
  const data = JSON.parse(ld.textContent);
  const app = data["@graph"].find((n) => n["@type"] === "WebApplication");
  app["@id"] = `${url}#app`;
  app.url = url;
  app.description = cfg.description;
  app.inLanguage = cfg.inLanguage;
  ld.textContent = JSON.stringify(data, null, 2).replaceAll("<", "\\u003c");

  document.querySelectorAll(".pathnav a").forEach((a) => {
    a.removeAttribute("aria-current");
    if (a.getAttribute("href") === cfg.path) a.setAttribute("aria-current", "page");
  });

  // back to index.html's source state
  const voiceSelect = document.getElementById("voiceSelect");
  voiceSelect.innerHTML = "<option>" + cfg.findingVoices + "</option>";
  voiceSelect.disabled = true;
  document.getElementById("voiceSelectBox").hidden = true;
  document.getElementById("genderBox").hidden = true;
  document.getElementById("voiceDot").className = "dot";
  document.getElementById("voiceLabel").textContent = cfg.findingVoice;
  document.getElementById("voiceStatus").hidden = false;
  const banner = document.getElementById("voiceBanner");
  banner.className = "banner";
  banner.textContent = cfg.bannerNone;
  document.querySelectorAll(".genderBtn").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.gender === "female" ? "true" : "false");
  });
  document.getElementById("progressCount").textContent = "0";
  document.getElementById("progressFill").removeAttribute("style");

  // Serialize in the same turn as the reset: the voice code retries on a timer,
  // and anything that runs in between would be baked into the output. Blink
  // keeps serializing style="" for an element whose inline style JS emptied,
  // even after removeAttribute, so drop those here.
  const html = document.documentElement.outerHTML.replaceAll(' style=""', "");
  return "<!doctype html>\n" + html + "\n";
}

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

async function load(context) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  // "attached", not "visible": only the first tab's panel is displayed, so the
  // other grid's cards are in the DOM but hidden.
  const attached = { state: "attached", timeout: 10_000 };
  await page.waitForSelector("#wordGrid article", attached);
  await page.waitForSelector("#swapGrid article", attached);
  await page.waitForSelector("#sectionGrid article", attached);
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
  return page;
}

try {
  // --- index.html: cards + structured data into the markers ---
  let page = await load(await browser.newContext());

  const dir = await page.getAttribute('[data-dir="da-no"]', "aria-pressed");
  if (dir !== "true") throw new Error(`expected the da-no direction to be active, got ${dir}`);

  const grids = {};
  for (const id of ["wordGrid", "swapGrid", "sectionGrid"]) {
    grids[id] = await page.$eval("#" + id, (el) => el.innerHTML);
    // A "known" card would bake one browser's localStorage into the shipped
    // HTML; the run should start from a clean profile, so this must be zero.
    const known = await page.$$eval(`#${id} article.known`, (els) => els.length);
    if (known) throw new Error(`${id}: ${known} card(s) marked known — not a clean profile`);
    console.log(`${id}: ${await page.$$eval(`#${id} article`, (e) => e.length)} cards`);
  }

  const jsonLd = buildJsonLd(await readTerms(page, "wordGrid"), await readTerms(page, "swapGrid"));
  console.log(`json-ld: ${checkTerms(jsonLd)} defined terms`);

  let html = await readFile(FILE, "utf8");
  for (const [id, markup] of Object.entries(grids)) html = inject(html, id, tidy(markup));
  html = inject(html, "jsonld", ldScript(jsonLd));
  await writeFile(FILE, html);
  console.log(`index.html: ${html.length} chars`);

  // --- the two landing pages, from the index.html just written ---
  for (const cfg of VARIANTS) {
    // A fresh context each time: no localStorage carried over from the last
    // variant's direction switch.
    page = await load(await browser.newContext());
    if (cfg.direction !== "da-no") {
      await page.click(`[data-dir="${cfg.direction}"]`);
      await page.waitForFunction(
        (d) => document.querySelector(`[data-dir="${d}"]`).getAttribute("aria-pressed") === "true",
        cfg.direction,
      );
    }

    const out = await page.evaluate(retarget, { ...cfg, url: `${SITE}${cfg.path}` });
    // The select must hold exactly the placeholder — i.e. no real voices from
    // this machine's speech engine baked into the shipped HTML. Scoped to the
    // element, since the inline script's source mentions <option> too.
    const select = out.match(/<select id="voiceSelect"[^>]*>(.*?)<\/select>/s)?.[1];
    if (select !== `<option>${cfg.findingVoices}</option>`) {
      throw new Error(`${cfg.file}: voice select not reset (${select})`);
    }
    const label = out.match(/id="voiceLabel">([^<]*)/)?.[1];
    if (label !== cfg.findingVoice) {
      throw new Error(`${cfg.file}: this machine's voices leaked into the page ("${label}")`);
    }
    const banner = out.match(/id="voiceBanner">([^<]*)/)?.[1];
    if (banner !== cfg.bannerNone) throw new Error(`${cfg.file}: stale voice banner ("${banner}")`);
    if (out.includes('id="voiceStatus" hidden')) throw new Error(`${cfg.file}: voice row left hidden`);
    const cards = (out.match(/<article class="card/g) ?? []).length;
    if (cards !== 50) throw new Error(`${cfg.file}: expected 50 cards, got ${cards}`);
    if (!out.includes(`<html lang="${cfg.lang}"`)) throw new Error(`${cfg.file}: lang not set`);

    await writeFile(join(ROOT, cfg.file), out);
    console.log(`${cfg.file}: ${cards} cards, lang=${cfg.lang}, ${out.length} chars`);
  }
  // --- stamp the service worker's cache version from what we just wrote ---
  const pages = [FILE, ...VARIANTS.map((v) => join(ROOT, v.file))];
  const hash = createHash("sha256");
  for (const f of pages) hash.update(await readFile(f));
  const version = hash.digest("hex").slice(0, 12);

  const swPath = join(ROOT, "sw.js");
  const sw = await readFile(swPath, "utf8");
  const stamped = sw.replace(/const VERSION = "[^"]*";/, `const VERSION = "${version}";`);
  if (stamped === sw && !sw.includes(`"${version}"`)) {
    throw new Error("sw.js: no VERSION line to stamp");
  }
  if (stamped !== sw) await writeFile(swPath, stamped);
  console.log(`sw.js: shell cache version ${version}`);

  // --- stamp the sitemap's lastmod from the same pages ---
  // lastmod was hand-maintained and went stale silently: Search Console was
  // still being told 2026-09-27 after three days of changes. Each <url> now
  // carries the hash of the page as last published, so a date moves only when
  // that page's content actually moved — a no-op prerender leaves the dates
  // alone instead of claiming everything changed today.
  const sitemapPath = join(ROOT, "sitemap.xml");
  const today = new Date().toISOString().slice(0, 10);
  const published = new Map(
    await Promise.all(
      [{ file: FILE, loc: `${SITE}/` }, ...VARIANTS.map((v) => ({ file: join(ROOT, v.file), loc: SITE + v.path }))].map(
        async ({ file, loc }) => [loc, createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 12)],
      ),
    ),
  );

  const sitemap = await readFile(sitemapPath, "utf8");
  const seen = new Set();
  const moved = [];
  const next = sitemap.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = block.match(/<loc>([^<]*)<\/loc>/)?.[1];
    const want = published.get(loc);
    if (!want) throw new Error(`sitemap.xml: <loc> ${loc} is not a page this script generates`);
    seen.add(loc);
    if (block.includes(`<!--content:${want}-->`)) return block;
    moved.push(loc);
    return block.replace(
      /<lastmod>[^<]*<\/lastmod>(<!--content:[0-9a-f]*-->)?/,
      `<lastmod>${today}</lastmod><!--content:${want}-->`,
    );
  });
  for (const loc of published.keys()) {
    if (!seen.has(loc)) throw new Error(`sitemap.xml: no <url> for ${loc}`);
  }
  if (moved.length) await writeFile(sitemapPath, next);
  console.log(`sitemap.xml: ${moved.length ? `lastmod ${today} on ${moved.length} page(s)` : "lastmod unchanged"}`);
} finally {
  await browser.close();
  server.close();
}
