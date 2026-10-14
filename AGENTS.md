<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Jarvis structure
- `server/` is a standalone Node 22 service (node:sqlite, no native deps); the panel in `src/` only talks to it over HTTP via `src/lib/bridge.ts`, with a localStorage demo fallback — keeps everything local and the preview usable.
- Host command safety lives only in `server/hostpolicy.js` and must stay unit-tested in `tests/`.
- No Lovable Cloud: user requires all data to stay on their machine.
