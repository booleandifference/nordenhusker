#!/usr/bin/env node
// Pre-generates TTS audio for Nordenhusker.
// Text is extracted from index.html so the clip list can never drift from the app.
//
//   node tools/generate-audio.mjs --sample     5 hard sentences x every engine (compare)
//   node tools/generate-audio.mjs              all clips, chosen engine only
//
// Google auth comes from ADC (gcloud auth application-default login).
// Grok is optional and best-effort: it officially supports neither da nor nb.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "audio");
const PROJECT = "nordenhusker-5ed3c";

// 5 sentences carrying the sounds that actually separate the languages:
// Danish soft-d + stod, Norwegian /c/, and the vowel-heavy ones.
const SAMPLE = ["rar-no", "rar-da", "grine-da", "bolle-no", "udtale-no-kjokken"];

// ---------- extract clips from index.html ----------
const slug = (w) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/ø/g, "o").replace(/æ/g, "ae").replace(/å/g, "aa").toLowerCase();

function clips() {
  const src = readFileSync(join(ROOT, "index.html"), "utf8");
  const out = [];
  const field = (blob, name) => {
    const m = blob.match(new RegExp(`\\b${name}:"((?:[^"\\\\]|\\\\.)*)"`));
    if (!m) return null;
    // SWAP_WORDS writes Danish/Norwegian characters as \uXXXX escapes. Browsers
    // decode those, but sending them raw to the TTS API would have it read the
    // escape text aloud. JSON.parse handles \uXXXX, \" and \\ in one go.
    try { return JSON.parse(`"${m[1]}"`); }
    catch { return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"); }
  };
  for (const line of src.split("\n")) {
    if (!/^\s*\{id:"/.test(line)) continue;
    const id = field(line, "id");
    const no = field(line, "ex");
    const da = field(line, "exda");
    if (id && no) out.push({ id: `${id}-no`, text: no, lang: "nb-NO" });
    if (id && da) out.push({ id: `${id}-da`, text: da, lang: "da-DK" });
  }
  const block = src.slice(src.indexOf("var UDTALE_WORDS"), src.indexOf("var UI"));
  const [noBlk, daBlk] = block.split("da: {");
  const words = (b) => [...b.matchAll(/"([^"]+)":"\[/g)].map((m) => m[1]);
  for (const w of words(noBlk)) out.push({ id: `udtale-no-${slug(w)}`, text: w, lang: "nb-NO" });
  for (const w of words(daBlk)) out.push({ id: `udtale-da-${slug(w)}`, text: w, lang: "da-DK" });
  for (const [i, m] of [...src.matchAll(/testPhrase:\s*"((?:[^"\\]|\\.)*)"/g)].entries())
    out.push({ id: `test-${i === 0 ? "no" : "da"}`, text: m[1], lang: i === 0 ? "nb-NO" : "da-DK" });
  // numbers / time panel — spoken via data-say attributes in the markup
  for (const m of src.matchAll(/data-say="([^"]+)"\s+data-lang="(da|no)"/g)) {
    const [, text, l] = m;
    out.push({
      id: `say-${l}-${slug(text).replace(/\s+/g, "-")}`,
      text,
      lang: l === "no" ? "nb-NO" : "da-DK",
    });
  }
  return out;
}

// ---------- google ----------
let TOKEN = null;
const token = () =>
  (TOKEN ??= execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
    encoding: "utf8",
  }).trim());

const xmlEscape = (t) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Marks are zero-width: the audio is byte-identical to a plain-text request,
// but the response carries exact word onsets, which drives the karaoke highlight.
async function google(text, lang, voice) {
  const words = text.match(/\S+/g) ?? [text];
  const ssml =
    "<speak>" + words.map((w, i) => `<mark name="w${i}"/>${xmlEscape(w)}`).join(" ") + "</speak>";
  const r = await fetch("https://texttospeech.googleapis.com/v1beta1/text:synthesize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "x-goog-user-project": PROJECT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: lang, name: voice },
      // Slightly slowed: this is a pronunciation trainer, not a podcast.
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.92 },
      enableTimePointing: ["SSML_MARK"],
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  const timings = (j.timepoints ?? [])
    .sort((a, b) => Number(a.markName.slice(1)) - Number(b.markName.slice(1)))
    .map((t) => Number((t.timeSeconds ?? 0).toFixed(3)));
  return { audio: Buffer.from(j.audioContent, "base64"), timings };
}

async function grok(text, lang) {
  const key = readFileSync(join(ROOT, ".env"), "utf8").match(/XAI_API_KEY\s*[=:]\s*(\S+)/)?.[1];
  if (!key) throw new Error("XAI_API_KEY not in .env");
  const r = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice_id: "eve", language: lang.split("-")[0], format: "mp3" }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 32).toString("utf8").trimStart().startsWith("{"))
    throw new Error(`JSON not audio: ${buf.toString("utf8").slice(0, 160)}`);
  return { audio: buf, timings: [] };
}

// ---------- run ----------
// WaveNet chosen by blind listening test. Voices are discovered at run time
// rather than hardcoded, so the pair is always a real female/male match.
const LANGS = ["da-DK", "nb-NO"];
let VOICES = null;
async function voices() {
  if (VOICES) return VOICES;
  VOICES = { female: {}, male: {} };
  for (const lang of LANGS) {
    const r = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?languageCode=${lang}`,
      { headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": PROJECT } }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message ?? `voices HTTP ${r.status}`);
    const wave = (j.voices ?? []).filter((v) => v.name.includes("Wavenet"));
    for (const g of ["FEMALE", "MALE"]) {
      const pick = wave.find((v) => v.ssmlGender === g);
      if (!pick) throw new Error(`no ${g} WaveNet voice for ${lang}`);
      VOICES[g.toLowerCase()][lang] = pick.name;
    }
  }
  return VOICES;
}


const GENDERS = ["female", "male"];

const all = clips();
const V = await voices();
console.log("voices:");
for (const g of GENDERS) for (const l of LANGS) console.log(`  ${g.padEnd(7)} ${l}  ${V[g][l]}`);
console.log(`\n${all.length} clips x ${GENDERS.length} voices\n`);

const manifest = { voices: V, clips: [] };
let ok = 0, fail = 0;
for (const c of all) {
  const entry = { id: c.id, lang: c.lang, text: c.text, takes: {} };
  for (const g of GENDERS) {
    mkdirSync(join(OUT, g), { recursive: true });
    const rel = `audio/${g}/${c.id}.mp3`;
    try {
      const { audio, timings } = await google(c.text, c.lang, V[g][c.lang]);
      writeFileSync(join(ROOT, rel), audio);
      entry.takes[g] = { file: rel, timings };
      ok++;
    } catch (err) {
      console.log(`  FAIL ${g}/${c.id}: ${err.message}`);
      fail++;
    }
  }
  if (Object.keys(entry.takes).length) manifest.clips.push(entry);
  const t = entry.takes.female?.timings?.length ?? 0;
  console.log(`  ok   ${c.id.padEnd(26)} ${t}tp  "${c.text.slice(0, 34)}"`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${ok} clips written, ${fail} failed, ${manifest.clips.length} manifest entries`);
