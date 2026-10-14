## Jarvis structure
- `server/` is a standalone Node 22 service (node:sqlite, no native deps); the panel in `src/` only talks to it over HTTP via `src/lib/bridge.ts`, with a localStorage demo fallback — keeps everything local and the preview usable.
- Host command safety lives only in `server/hostpolicy.js` and must stay unit-tested in `tests/`.
- No Lovable Cloud: user requires all data to stay on their machine.
