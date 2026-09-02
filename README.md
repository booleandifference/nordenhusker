# Nordenhusker

A Danish ↔ Norwegian "false friend" trainer — teaches the small, specific delta between the two languages (tricky look-alike words, key pronunciation differences, numbers/time quirks) rather than starting from zero like a general language app.

**Core idea:** Danish and Norwegian (Bokmål) are already close to mutually intelligible. What actually trips a fluent neighbor-language speaker up is a short, learnable list of false friends, a handful of pronunciation differences, and a couple of structural quirks (numbers, telling time) — not broad grammar.

## Status

Prototype stage. Single self-contained `index.html` (no build step, no backend) — open it directly in a browser. Progress ("words I know") is saved to `localStorage`.

- 30 curated DA/NO false-friend words, each with meanings, an example sentence, and a tip in both directions
- Bidirectional 🇩🇰→🇳🇴 / 🇳🇴→🇩🇰 switch
- Text-to-speech via the browser's Web Speech API, with a per-language voice picker
- Karaoke-style word highlighting that follows along with the spoken example sentence
- Pronunciation cards (6 per direction) and a numbers/time section
- Branded "Nordenhusker" — gold/red/blue palette, blackletter + mono type (see `brand guide/Main.pdf`)

## Roadmap

See the project notes (kept outside this repo, in the Claude project) for full detail. Short version:

- Move off `localStorage`/static file onto real hosting (Firebase) with accounts and cross-device progress
- Swap browser TTS for a real TTS API (Google Cloud TTS is the current front-runner)
- Possibly add Swedish (SV↔DA, SV↔NO) as a third language pair — each is its own content research effort, not a quick add
- Register nordenhusker.dk (.no/.se as insurance)

## Structure

```
index.html          the whole app — markup, styles, and logic in one file
brand guide/         reference brand deck (PDF)
```
