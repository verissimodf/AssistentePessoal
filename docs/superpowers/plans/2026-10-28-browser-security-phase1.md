# Playwright Browser Security Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship the Playwright P0 security controls while keeping browser execution disabled until the isolated worker passes its network smoke checks.

**Architecture:** Encrypt browser form payloads at rest using the existing local AES-256-GCM master key, migrate existing rows transactionally with a verified backup, and expose a verified-owner review/confirmation flow. Move Playwright to an opt-in container with no Docker network; communicate with the app and a pinned-egress proxy over private Unix sockets so browser traffic cannot directly reach application networks.

**Tech Stack:** Node 22, `node:sqlite`, Node crypto, Playwright Chromium, Docker Compose, React, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-assistente-local-capabilities-design.md` — sections A, “Transição de aprovações existentes”, “Fases de implementação” phase 1 and “Critérios de aceitação”.

## Global Constraints

- All application data, approval payloads, and browser artifacts remain in local storage.
- Browser remains opt-in and disabled until network smoke checks pass.
- Every new route declares access centrally in `server/index.js` and checks `principal.adminId` ownership.
- Browser write operations require a separate write scope and explicit human confirmation; `web` does not imply write access.
- Schema/data changes use a new versioned migration, a verified backup, one transaction per migration, and preserved-row checks.
- No secrets or form values enter logs, audit metadata, ordinary approval listings, or model output before review.
- Worker has no Docker socket, no business-network interface, and no direct external network; egress is only via pinned proxy over a Unix socket.
- Existing OAuth, calendar, document creation, new skills, and new MCP tools are outside this Phase 1 plan.

## Review Focus

- Existing pending browser approvals contain plaintext form values — migration must encrypt in place, preserve state/count, and roll back completely on failure.
- Missing, replaced, or malformed master key — startup/migration must fail closed without modifying approval rows.
- Forged, service-token, foreign-owner, stale-session, and repeated review/reveal calls — sensitive payload must remain inaccessible.
- A model or API caller omits write confirmation or alters destination after review — no browser request may execute.
- Browser redirect, subresource, hostname rebinding, IPv4/IPv6 private addresses, Docker aliases, and metadata endpoints — pinned proxy must reject at connect time.

---

## File Map

| File | Responsibility |
|---|---|
| `server/secret-crypto.js` (new) | Master-key loading and AES-GCM primitives independent of SQLite imports. |
| `server/settings.js` | Preserve existing `encrypt`/`decrypt` exports as compatibility re-exports. |
| `server/migrations.js` | Version 19 migration that encrypts existing browser `fill.text` payloads in place. |
| `server/browser-approval.js` (new) | Protect/unprotect browser action payloads, safe review projection, write classification. |
| `server/tools.js` | Store protected browser action payloads; require explicit second confirmation at resolution. |
| `server/auth.js` | Add `web:write` service-token scope and enforce that `web` cannot imply write. |
| `server/index.js` | Owner-scoped review/reveal routes and approval resolution guard. |
| `server/browser.js` | Revalidate DNS/URL at each browser route and require worker transport. |
| `scripts/browser-worker.mjs` | Unix-socket command server, local proxy configuration, concurrency bounds, lifecycle. |
| `scripts/browser-egress-proxy.mjs` (new) | Pinned DNS resolution and connect-time private-address rejection over Unix socket. |
| `Dockerfile.browser` (new) | Pinned, non-root Playwright worker image. |
| `docker-compose.yml` | Opt-in worker/proxy services; worker `network_mode: none`; shared private runtime volume. |
| `src/routes/index.tsx` | Review card/modal; reveal and explicit write confirmation flow. |
| `src/routes/configuracoes.tsx`, `server/settings.js` | Admin-only exact-host allowlist for browser destinations. |
| `src/lib/bridge.ts` | Typed API for review and reveal routes. |
| `tests/browser-tool.test.mjs`, `tests/approvals-actions.test.mjs` | Request guard, write confirmation and no-plaintext regression tests. |
| `tests/migrations.test.mjs` | Version 19 migration encryption, backup and rollback tests. |
| `tests/browser-egress-proxy.test.mjs` (new) | Proxy validation, DNS pinning and socket protocol tests. |
| `docs/NAVEGADOR.md`, `docs/ARQUITETURA.md`, `docs/RECUPERACAO.md` | Deployment, trust boundary, key recovery and rollback instructions. |

## Task 1: Separate key primitives and migrate existing browser payloads

**Interfaces:** `encrypt(text, { dataDir?, createKey? } = {}) -> string`; `decrypt(ciphertext, { dataDir? } = {}) -> string`; migrations may declare `apply(db, { dataDir, encryptFn })`; `migrate(db, dataDir, { encryptFn? })` supplies the injectable test function. Migration 19 transforms only browser `fill.params.text` into `fill.params.encryptedText` and preserves other JSON fields and approval states. Migration uses `createKey:false`; a missing/malformed existing key aborts before data changes. Normal first-run settings preserve the current key-generation behavior.

- [x] Add tests `v19 encrypts pending browser fill text in place` and `v19 rollback preserves plaintext action if encryption fails` in `tests/migrations.test.mjs`: plaintext sentinel disappears from the live row, decrypt restores exact text, status/count/correlation remain unchanged, verified backup has original row, migration is idempotent, and an injected error rolls back.
- [x] Run `rtk node --test tests/migrations.test.mjs`; confirm the new tests fail for the missing version 19 behavior.
- [x] Create `server/secret-crypto.js` with `encrypt(text, { dataDir, createKey = true } = {})` and `decrypt(ciphertext, { dataDir } = {})`, injectable data-directory key loading and AES-256-GCM; preserve current key-file mode `0600` and `JARVIS_MASTER_KEY` compatibility. `createKey:false` must throw when the key is absent or malformed.
- [x] Change `server/settings.js` to re-export the crypto helpers without changing callers.
- [x] Add migration 19 using `apply(db, { dataDir, encryptFn })`; update the migration runner to invoke `apply` inside the existing `BEGIN IMMEDIATE` transaction and pass `{ dataDir, encryptFn: opts.encryptFn ?? ((text) => encrypt(text, { dataDir, createKey: false })) }`. Production requires the configured existing key when data must be transformed; tests inject deterministic encryption.
- [x] Run `rtk node --test tests/migrations.test.mjs tests/oauth.test.mjs tests/settings-provenance.test.mjs tests/settings-comms-blank.test.mjs tests/secret-crypto.test.mjs`; 31/31 pass.
- [x] Commit Task 1 as `fix: encrypt browser approval payloads at rest`.

## Task 2: Protect new browser actions and define write authorization

**Interfaces:** `protectBrowserAction(action) -> storedAction`, `unprotectBrowserAction(action) -> executableAction`, `browserActionReview(action, { reveal }) -> safeReview`; review output contains only operation, host, selector, masked preview, and an opaque fingerprint unless reveal is explicitly authorized.

- [x] Add failing tests for stored `fill.text` being absent and ciphertext being present; decrypt occurs only at execution; action fingerprint and destination remain bound.
- [x] Add failing tests that `click` and `fill` require `web:write` for service tokens, legacy `web` remains read-only, unknown scopes are denied, and admin sessions retain existing read access.
- [x] Add failing settings/API tests that only a verified admin can change `integrations.browser.allowedHosts`; exact hostnames and empty-list behavior are validated.
- [x] Implement the browser action protection helper using the crypto module; only encrypt/decrypt the browser payload field, not unrelated actions. Preserve the fingerprint from the original request and verify it again after decrypting.
- [x] Add `web:write` to `SCOPES` but not `BOT_SCOPES`; add `browser_action` operation-aware authorization at call time and resolution time.
- [x] Add optional exact-host allowlist to global browser settings and the integrations panel. An empty list permits any public host; a nonempty list permits only listed hostnames, with no wildcard syntax.
- [x] Require the same fingerprint plus `confirmWrite === true` for `click`/`fill` approval resolution; a changed destination, stale review or replay does not execute. Review projection is completed in Task 3.
- [x] Run `rtk node --test tests/browser-tool.test.mjs tests/approvals-actions.test.mjs tests/auth.test.mjs`; 56/56 pass, including existing read-only `navigate` approval flow.
- [x] Commit Task 2 as `fix: gate browser writes with explicit scope and approval`.

**Task 2 ruling:** redirects to unlisted hosts are verified in Task 4 route interception (not Task 2 request validation); Task 2 tests exact-host validation on the initial requested URL. Hostnames are capped at 100 and exact-only to bound configuration input. Cost if incorrect: redirect acceptance is deferred until Task 4; browser remains disabled until Tasks 4–6. The allowlist cap only limits unusually large admin configuration.

## Task 3: Owner-scoped review/reveal UI and endpoints

**Interfaces:** `GET /api/approvals/:id/review` requires `session`, owner match, and a pending browser action; it returns masked safe metadata. `POST /api/approvals/:id/reveal` additionally requires `isVerifiedAdmin(principal)` and recent reauthentication, returns the plaintext only with `Cache-Control: no-store`, and never audits the value.

- [ ] Add failing HTTP tests for missing session, foreign owner, forged principal, service token, non-browser action, resolved approval, reveal without reauth, and successful owner reveal.
- [ ] Add `src/test/browser-approval.test.tsx` proving a browser write opens review, defaults to masked text, requires explicit confirmation, and sends the reviewed fingerprint plus `confirmWrite`.
- [ ] Implement owner-scoped review/reveal routes and route-level no-store response handling; do not add content to `/api/approvals` listing.
- [ ] Implement a review modal using existing UI primitives; show destination, operation, selector and data preview, require a checkbox/typed confirmation for write actions, and never put revealed values into chat history or telemetry.
- [ ] Run `rtk node --test tests/browser-tool.test.mjs` and `rtk npm test -- --run src/test/browser-approval.test.tsx`; verify reveal response has `Cache-Control: no-store`.
- [ ] Commit Task 3 as `feat: add secure browser approval review`.

## Task 4: Enforce destination checks in Playwright

- [ ] Add failing tests proving the local and managed-worker route hooks call the injected resolver for every HTTP(S) request, including subresources and redirect requests, and abort if any DNS answer is blocked or resolution fails.
- [ ] Implement async `assertPublicHost` in each route callback, use the approved `resolveHost` injection, validate protocol again, and abort on any exception/cancel.
- [ ] Add tests for IPv4, IPv6, localhost/Docker aliases, mixed public/private DNS answers, DNS failure, non-HTTP protocols, timeouts, ANSI/control characters, known credential patterns in plain text, and output truncation at `BROWSER_LIMITS.maxOutputChars`.
- [ ] Run `rtk node --test tests/browser-tool.test.mjs`; verify there is no outbound request in tests.
- [ ] Commit Task 4 as `fix: validate every browser destination`.
- [ ] Extend string redaction to remove known credential patterns and control sequences before truncation; preserve ordinary text and the existing maximum output size.

## Task 5: Add pinned egress broker and isolated worker transport

**Interfaces:** app and worker exchange JSON over `/run/jarvis-browser/worker.sock`; worker browser uses `127.0.0.1:<proxy-port>`; local bridge forwards raw HTTP proxy requests over `/run/jarvis-browser/egress.sock`; broker validates protocol/port/hostname, resolves all addresses once, rejects if any is non-public, and connects to the selected validated IP.

- [ ] Add tests for proxy request parsing, malformed/oversized headers, blocked IPs, mixed DNS answers, DNS rebinding simulation, CONNECT tunneling, and bounded connection cleanup.
- [ ] Implement the broker and worker-local TCP-to-UDS bridge; do not resolve destination again after validation and preserve TLS SNI/Host using the original hostname.
- [ ] Change app remote transport to support only the local Unix socket for the managed worker; keep any operator-defined external worker disabled unless a separate explicitly trusted transport is configured.
- [ ] Set Chromium's proxy explicitly and disable proxy bypass for all non-loopback destinations; continue blocking non-HTTP protocols through Playwright routes.
- [ ] Run `rtk node --test tests/browser-egress-proxy.test.mjs`; use loopback-controlled fixtures through an injected dialer, with no real website contacted.
- [ ] Commit Task 5 as `feat: add pinned browser egress proxy`.

## Task 6: Build and deploy the opt-in isolated browser services

- [ ] Add a pinned Playwright version to the dedicated image; install as root only during build, create a non-root runtime user, and run browser with sandbox enabled.
- [ ] Add compose services for worker and egress broker with no published ports, no Docker socket, read-only root filesystems, bounded `tmpfs`, CPU/memory/pids limits and dropped capabilities.
- [ ] Run browser worker with `network_mode: none`; share only the private Unix-socket volume with Assistente and broker. Broker alone gets a dedicated external egress network and has no business-network attachment. Do not join or restart the production Compose project; use a separate candidate project and volume.
- [ ] Ensure runtime socket directory ownership/mode is created by a one-shot initialization service and fail closed when either socket is missing or permissions are broad.
- [ ] Add tests/scripts that inspect the effective candidate container network attachments and verify worker direct DNS/TCP fails, proxy access to private/metadata targets fails, and a public controlled smoke URL succeeds. Run only in the isolated candidate project with disposable volume and no production data.
- [ ] Keep integration `enabled=false`; do not enable production until the smoke script records each expected result. Use a separate Compose project name and disposable volume; do not restart or recreate the live Assistente, Crawl4AI, or shared Docker network.
- [ ] Commit Task 6 as `feat: isolate the opt-in browser worker`.

## Task 7: Document phase 1 and validate the release candidate

- [ ] Update `docs/NAVEGADOR.md`, `docs/ARQUITETURA.md`, and `docs/RECUPERACAO.md` with socket topology, key migration, approval review, write scopes, startup/backup/rollback, and exact smoke commands.
- [ ] Add tests proving secrets are absent from audit rows, error messages, ordinary approval listing and chat output.
- [ ] Run `rtk npm --prefix server test`, `rtk npm test`, `rtk npm run lint`, and `rtk npm run build`; capture commands and exit codes.
- [ ] Build the candidate image under a new tag; run the isolated worker/proxy smoke checks; verify the active Assistente container remains healthy and browser remains off.
- [ ] Review `git diff --check`, generated files, lockfiles and documentation evidence; report any check that cannot pass without external credentials.
- [ ] Commit Task 7 as `docs: document browser security phase 1`.

## Rollback

- Before applying migration 19, the migration runner creates and verifies a full database backup. If encryption or validation fails, the transaction rolls back and server startup fails before routes become available.
- Roll back application image to the previous immutable tag; do not revert the database version. The newer app is forward-compatible with encrypted payloads; the previous app can still read the verified pre-migration backup if rollback of code is required.
- Keep browser disabled and stop the opt-in worker/proxy profile if network smoke checks fail. No user-facing browser operation is enabled as a fallback.
