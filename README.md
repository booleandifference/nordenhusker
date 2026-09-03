# Nordenhusker

A Danish ↔ Norwegian "false friend" trainer — teaches the small, specific delta between the two languages (tricky look-alike words, key pronunciation differences, numbers/time quirks) rather than starting from zero like a general language app.

**Core idea:** Danish and Norwegian (Bokmål) are already close to mutually intelligible. What actually trips a fluent neighbor-language speaker up is a short, learnable list of false friends, a handful of pronunciation differences, and a couple of structural quirks (numbers, telling time) — not broad grammar.

## Status

Prototype stage. Single `index.html` (no build step, no backend) plus a folder of pre-generated audio. Progress ("words I know") is saved to `localStorage`.

- 30 curated DA/NO false-friend words, each with meanings, an example sentence, and a tip in both directions
- Bidirectional 🇩🇰→🇳🇴 / 🇳🇴→🇩🇰 switch
- 123 pre-generated Google WaveNet clips (`da-DK-Wavenet-A` / `nb-NO-Wavenet-A`), chosen over Chirp3-HD and Grok in a blind listening test
- Karaoke word highlighting driven by real word onsets from the TTS API, not estimates
- Web Speech API retained as a fallback whenever a clip is missing or won't play
- Pronunciation cards (6 per direction) and a numbers/time section
- Branded "Nordenhusker" — gold/red/blue palette, blackletter + mono type (see `brand guide/Main.pdf`)

## Roadmap

See the project notes (kept outside this repo, in the Claude project) for full detail. Short version:

- ~~Move onto real hosting (Firebase)~~ — done, see Deploying below
- Move progress off `localStorage` onto Firebase Auth + Firestore for accounts and cross-device sync
- ~~Swap browser TTS for a real TTS API~~ — done, Google Cloud TTS WaveNet
- Consider driving the 47 pronunciation words through SSML `<phoneme>` using the IPA already in `UDTALE_WORDS`
- Possibly add Swedish (SV↔DA, SV↔NO) as a third language pair — each is its own content research effort, not a quick add
- Register nordenhusker.dk (.no/.se as insurance)

## Structure

```
index.html          the whole app — markup, styles, and logic in one file
audio/wavenet/      123 pre-generated mp3s, one per spoken string
audio/manifest.json clip id -> file + per-word timings, fetched at startup
tools/              audio generator (not deployed)
brand guide/        reference brand deck (PDF, not deployed)
firebase.json       Firebase Hosting config
.firebaserc         pins the default project (nordenhusker-5ed3c)
```

## Audio

Every spoken string is rendered once, offline, and committed. Nothing calls a TTS
API at runtime, so there is no API key in the client, no per-play cost, and no
latency — and every clip can be listened to before it ships, which matters for an
app whose whole subject is pronunciation.

`tools/generate-audio.mjs` extracts the strings straight from `index.html` (example
sentences, pronunciation headwords, the numbers/time `data-say` values, test
phrases) so the clip list cannot drift from the app. It requests SSML `<mark>`
timepoints, which give exact word onsets for the karaoke highlight; marks are
zero-width, so the audio is identical to a plain-text request.

Regenerate after editing any spoken text — existing files are skipped, so only new
clips cost anything:

```
gcloud auth application-default login
node tools/generate-audio.mjs
```

Add `--engine=chirp3` or `--engine=grok` to render with a different engine for
comparison; those output folders are gitignored and excluded from deploys.

Note: `audio/manifest.json` is loaded with `fetch`, which browsers block over
`file://`. Opening `index.html` straight from disk still works — it just falls back
to Web Speech voices. Serve the folder over HTTP to hear the real clips locally.

## Deploying

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
