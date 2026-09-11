# Working notes for Claude Code on this repo

Nordenhusker is a single-file (`index.html`) Danish↔Norwegian language app. See
`README.md` for what it does and how to run/deploy it.

## Maintain BACKLOG.md

`BACKLOG.md` is the running list of feature ideas and planned work for this
project. Keep it current as part of normal work here, not as a separate chore:

- **When Morten raises a new idea or feature request in a session** — whether
  or not it gets built right away — add it to `BACKLOG.md` under the right
  section (Content vs. Product/infra) with status `idea`, a short description,
  and where it came from if that's useful context (a date, "from LinkedIn
  feedback", etc.). Do this even if the session's main task is something else;
  don't let ideas mentioned in passing get lost.
- **When you start building a backlog item**, move its status to
  `in progress`. When it ships, move it to the "Done" section with a one-line
  note, and trim the "Done" section occasionally so it doesn't grow forever —
  the git log and README are the durable record of what shipped.
- **When an idea is scoped but not started**, update its status to `scoped`
  and fold in whatever scoping detail was worked out (approach, effort,
  blockers) so the next person picking it up doesn't redo that thinking.
- **When an idea is discussed and deliberately not pursued**, mark it
  `dropped` with a one-line reason rather than deleting it — avoids
  re-litigating the same idea later without knowing it was already considered.
- Keep entries short — a sentence or two of context, not a full spec. If an
  idea needs real research or a design decision before it's buildable, that
  belongs in the Claude project doc ("Dansk til Norsk — Norwegian-for-Danes
  language product"), not spelled out in full here; `BACKLOG.md` can just
  point at it.
- Don't remove other people's/sessions' entries when picking up work — add to
  the file, don't replace it wholesale (it's plain markdown, so treat edits
  like any other file: read, patch, write back).

## Other conventions

- No build step — `index.html` is edited directly. Run the JS-syntax check
  (extract the `<script>` block, `new Function()` it) after any script edit
  before committing.
- Regenerate audio (`tools/generate-audio.mjs`) after editing any spoken
  string — see README's Audio section.
- Deploy with `firebase deploy --only hosting` once a change is committed and
  verified locally.
