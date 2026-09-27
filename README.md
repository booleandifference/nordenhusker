# Nordenhusker

A Danish ↔ Norwegian "false friend" trainer — teaches the small, specific delta between the two languages (tricky look-alike words, key pronunciation differences, numbers/time quirks) rather than starting from zero like a general language app.

**Core idea:** Danish and Norwegian (Bokmål) are already close to mutually intelligible. What actually trips a fluent neighbor-language speaker up is a short, learnable list of false friends, a handful of pronunciation differences, and a couple of structural quirks (numbers, telling time) — not broad grammar.

## Status

Prototype stage. Single `index.html` (no build step, no backend) plus a folder of pre-generated audio. Progress ("words I know") is saved to `localStorage`.

- 20 curated DA/NO function-word pairs ("Ord der byttes" / "Ord som byttes") — words that mean
  the same but are simply different, high-frequency words (hinanden/hverandre,
  måske/kanskje, etc.), plus 30 curated DA/NO false-friend words ("Ord der snyder" / "Ord som lurer"), each with meanings, an example sentence, and a tip in both directions
- Bidirectional 🇩🇰→🇳🇴 / 🇳🇴→🇩🇰 switch
- 326 pre-generated Google WaveNet clips — 163 strings x a female and a male voice per language, chosen over Chirp3-HD and Grok in a blind listening test
- Kvinde / Mand voice switch, remembered in `localStorage`
- Karaoke word highlighting driven by real word onsets from the TTS API, not estimates
- Web Speech API retained as a fallback whenever a clip is missing or won't play
- Pronunciation cards (6 per direction) and a numbers/time section
- Branded "Nordenhusker" — gold/red/blue palette, blackletter + mono type (see `brand guide/Main.pdf`)

## Roadmap

See the project notes (kept outside this repo, in the Claude project) for full detail. In the repo, `BACKLOG.md` is the running list of planned features and `PROMOTION-IDEAS.md` the non-code side (competitions, funding calls, outreach targets). Short version:

- ~~Move onto real hosting (Firebase)~~ — done, see Deploying below
- Move progress off `localStorage` onto Firebase Auth + Firestore for accounts and cross-device sync
- ~~Swap browser TTS for a real TTS API~~ — done, Google Cloud TTS WaveNet
- Consider driving the 47 pronunciation words through SSML `<phoneme>` using the IPA already in `UDTALE_WORDS`
- Possibly add Swedish (SV↔DA, SV↔NO) as a third language pair — each is its own content research effort, not a quick add
- Register nordenhusker.dk (.no/.se as insurance)

## Structure

```
index.html          the whole app — markup, styles, and logic in one file
audio/female/       123 mp3s, da-DK-Wavenet-F / nb-NO-Wavenet-F
audio/male/         123 mp3s, da-DK-Wavenet-G / nb-NO-Wavenet-G
audio/manifest.json clip id -> per-voice file + word timings, fetched at startup
til-norge.html      generated — Danish-facing landing page (do not edit)
til-danmark.html    generated — Norwegian-facing landing page (do not edit)
tools/              audio generator + page generator (not deployed)
brand guide/        reference brand deck (PDF, not deployed)
firebase.json       Firebase Hosting config
.firebaserc         pins the default project (nordenhusker-5ed3c)
```

## Two landing paths

One URL means one `<title>`, one meta description and one language, but the
site serves two audiences searching for different things: Danes moving to
Norway, and Norwegians moving to Denmark. So there are three pages, all the
same app:

| path | audience | direction | language |
| --- | --- | --- | --- |
| `/` | either, and brand queries | last used, else da→no | da |
| `/til-norge` | Danes learning Norwegian | da→no | da |
| `/til-danmark` | Norwegians learning Danish | no→da | nb |

`til-norge.html` and `til-danmark.html` are **generated** by
`tools/prerender.mjs` — never edit them. The script loads the real page,
switches direction, and serializes the result, so the variants cannot drift
from `index.html`; their titles and descriptions come from the `VARIANTS`
array at the top of that script. The three pages carry a reciprocal `hreflang`
set (`da` / `nb` / `x-default`), each canonicals to itself, and all three are
in `sitemap.xml`.

At runtime `index.html` reads the path and pre-sets the direction, ahead of
any saved preference — arriving on `/til-danmark` is a more explicit statement
of intent than whatever the last visit toggled. The switch still works from
either page.

`cleanUrls` in `firebase.json` is what serves `til-norge.html` at `/til-norge`.
It also 301s `/index.html` to `/`, which removes the duplicate Google had
indexed alongside the real home page.

## Pre-rendered word cards and structured data

The word cards are built at runtime by `renderWords()`/`renderSwapWords()`, so
for a crawler that doesn't execute JS the two grids were empty `<div>`s — none
of the actual searchable content (the word pairs) was in the HTML. The cards for
the default direction (da→no) are therefore pre-rendered into `index.html`
between `<!--prerender:wordGrid-->` / `<!--prerender:swapGrid-->` markers.

`tools/prerender.mjs` loads the real page in Playwright, lets the app's own
render functions run, and writes the resulting markup back into the file, so
there is still exactly one card template — the one in `index.html`. At runtime
the app wipes the grids and re-renders as before, which is what makes the
direction switch and the progress toggles work; the static copy is progressive
enhancement for crawlers and for no-JS visitors.

The same script also emits the schema.org JSON-LD in `<head>`: a
`WebApplication` node for the app plus two `DefinedTermSet`s (30 false friends,
20 swapped words) with a `DefinedTerm` per pair. It is built by reading the
pairs back out of the cards that were just rendered, so the structured data
cannot describe something the page doesn't show.

Worth being clear about what that buys: Google has no rich result for
`DefinedTerm`, so this will not produce snippets in the search results. It
makes the content machine-readable — for Google's understanding of what the
page is, and for the AI answer engines that increasingly read schema — and it
costs ~2 KB gzipped.

Re-run after changing `WORDS`, `SWAP_WORDS`, or the card markup — it is
idempotent, so running it when nothing changed rewrites the same bytes:

```
npm run prerender
```

## Audio

Every spoken string is rendered once, offline, and committed. Nothing calls a TTS
API at runtime, so there is no API key in the client, no per-play cost, and no
latency — and every clip can be listened to before it ships, which matters for an
app whose whole subject is pronunciation.

`tools/generate-audio.mjs` extracts the strings straight from `index.html` (example
sentences, pronunciation headwords, the numbers/time `data-say` values, test
phrases) so the clip list cannot drift from the app. It discovers the voice pair
from the API by `ssmlGender` rather than hardcoding names, and stores timings per
voice, since word onsets differ between them. It requests SSML `<mark>`
timepoints, which give exact word onsets for the karaoke highlight; marks are
zero-width, so the audio is identical to a plain-text request.

Regenerate after editing any spoken text — existing files are skipped, so only new
clips cost anything:

```
gcloud auth application-default login
node tools/generate-audio.mjs
```

Note: `audio/manifest.json` is loaded with `fetch`, which browsers block over
`file://`. Opening `index.html` straight from disk still works — it just falls back
to Web Speech voices. Serve the folder over HTTP to hear the real clips locally.

## Deploying

Run `npm run prerender` before deploying if anything in `index.html` changed,
so the two generated landing pages match it.

Hosted on Firebase Hosting, project `nordenhusker-5ed3c`. The repo root is the
public directory, so `index.html` stays openable straight from disk; `README.md`,
`brand guide/`, and dotfiles are excluded via the `ignore` list in `firebase.json`.
HTML is served `no-cache` so a deploy is live immediately.

```
firebase deploy --only hosting
```

Preview a change before it goes live:

```
firebase hosting:channel:deploy preview
```
