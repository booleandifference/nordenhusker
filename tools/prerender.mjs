// Pre-render the word cards into index.html so they exist for crawlers, and
// emit the schema.org JSON-LD that describes them.
//
// Why: both word grids are built at runtime by renderWords()/renderSwapWords()
// via innerHTML, so a crawler that doesn't execute JS sees two empty <div>s —
// i.e. none of the actual searchable content (the word pairs) is in the HTML.
// This script loads the real page in a real browser, lets the app's own render
// functions run, and writes the resulting markup back into index.html between
// the <!--prerender:*--> markers. At runtime the app still wipes the grids and
// re-renders as before, so this is progressive enhancement, not a second
// rendering path: there is exactly one card template, the one in index.html.
//
// Only the default direction (da-no) is pre-rendered — the direction switch is
// interactive anyway, and the canonical page is the Danish-facing one.
//
// The JSON-LD is built from the same rendered cards, for the same reason: the
// word pairs are described once, in index.html, and everything else is derived.
// Note there is no Google rich result for DefinedTerm — this is about machine-
// readable content, not stars in the SERP. See README.
//
// Re-run after changing WORDS, SWAP_WORDS, or the card markup:
//   npm run prerender
// It is idempotent: whatever sits between the markers is replaced, and the
// browser renders from the data, not from the previous output.

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const FILE = join(ROOT, "index.html");

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

const SITE = "https://nordenhusker.dk/";

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
    "@id": `${SITE}#term-${setId}-${t.id.replace(/^sw-/, "")}`,
    name: t.word,
    description,
    inDefinedTermSet: { "@id": `${SITE}#${setId}` },
  };
}

function buildJsonLd(falseFriends, swaps) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${SITE}#app`,
        name: "Nordenhusker",
        url: SITE,
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
        "@id": `${SITE}#ord-der-snyder`,
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
        "@id": `${SITE}#ord-der-byttes`,
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

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "networkidle" });
  // "attached", not "visible": only the first tab's panel is displayed, so the
  // other grid's cards are in the DOM but hidden.
  const attached = { state: "attached", timeout: 10_000 };
  await page.waitForSelector("#wordGrid article", attached);
  await page.waitForSelector("#swapGrid article", attached);
  if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);

  const dir = await page.getAttribute('[data-dir="da-no"]', "aria-pressed");
  if (dir !== "true") throw new Error(`expected the da-no direction to be active, got ${dir}`);

  const grids = {};
  for (const id of ["wordGrid", "swapGrid"]) {
    grids[id] = await page.$eval("#" + id, (el) => el.innerHTML);
    const n = await page.$$eval(`#${id} article`, (els) => els.length);
    // A "known" card would bake one browser's localStorage into the shipped
    // HTML; the run should start from a clean profile, so this must be zero.
    const known = await page.$$eval(`#${id} article.known`, (els) => els.length);
    if (known) throw new Error(`${id}: ${known} card(s) marked known — not a clean profile`);
    console.log(`${id}: ${n} cards`);
  }

  const jsonLd = buildJsonLd(
    await readTerms(page, "wordGrid"),
    await readTerms(page, "swapGrid"),
  );
  const terms = jsonLd["@graph"].reduce((n, node) => n + (node.hasDefinedTerm?.length ?? 0), 0);
  if (terms !== 50) throw new Error(`expected 50 defined terms, built ${terms}`);
  for (const node of jsonLd["@graph"]) {
    for (const t of node.hasDefinedTerm ?? []) {
      if (!t.name || !t.description.includes("«")) throw new Error(`incomplete term: ${t["@id"]}`);
    }
  }
  console.log(`json-ld: ${terms} defined terms`);

  // "<" is escaped so the payload can never close its own <script> element.
  const script =
    '\n<script type="application/ld+json">\n' +
    JSON.stringify(jsonLd, null, 2).replaceAll("<", "\\u003c") +
    "\n</" + "script>\n";

  let html = await readFile(FILE, "utf8");
  const before = html.length;
  for (const [id, markup] of Object.entries(grids)) html = inject(html, id, tidy(markup));
  html = inject(html, "jsonld", script);
  await writeFile(FILE, html);
  console.log(`index.html: ${before} -> ${html.length} bytes`);
} finally {
  await browser.close();
  server.close();
}
