# PACDeluxe v2.0 Stabilization Audit and Implementation Plan

Last updated: 2026-04-13

Status note:

This document is the original audit and remediation plan snapshot from the stabilization pass. Current repo truth now lives in:

- `README.md`
- `docs/README.md`
- `docs/ADR-0001-local-build-architecture.md`
- `docs/PATCH_MANIFEST.md`
- `TRANSPARENCY.md`

## Update 2026-04-13

The P0 network-model concerns described below are now addressed by the
origin-scoped proxy rework:

- `src-tauri/src/commands.rs` no longer uses a path allowlist; absolute URLs
  are allowed only for `pokemon-auto-chess.com` (and subdomains) plus one
  read-only GitHub URL for the community-server manifest, while any relative
  path is routed to the production origin.
- The injected runtime in `src-tauri/src/main.rs` proxies every request that
  is not a local asset bundled in `dist/`, using the shared classifier in
  `scripts/proxy-manifest.js`. New upstream endpoints no longer require a
  PACDeluxe code change.
- The Firebase popup auth bridge now intercepts `window.open` in the main
  window and provides a mock `Window` object so Firebase's SDK can complete
  `signInWithPopup()` over Tauri events.

The historical audit text below is preserved as a record of what the
stabilization pass addressed. It is no longer authoritative.

## Purpose

This document audits the current repository state after the 1.6 -> 2.0 architecture pivot and defines a concrete stabilization plan.

The short version: v2.0 builds, launches, and passes its current tests, but the architecture is still split between:

- a local-built desktop client
- a live-site-dependent network model
- a runtime that still relies on injected JavaScript and Windows-only browser security changes
- documentation and validation that no longer describe the full system accurately

If we do not fix the architectural split first, every other bugfix will stay brittle.

---

## Executive Verdict

PACDeluxe v2.0 is not a failed build; it is an incomplete architecture migration.

The repo has clearly moved from the old live-site wrapper model to a local-build model:

- `src-tauri/tauri.conf.json` serves `../dist`
- `src-tauri/src/main.rs` loads `WebviewUrl::App("index.html".into())`
- `scripts/build-frontend.js` builds and patches upstream into `dist/`

But the app still depends on production-site behavior in ways that make the new architecture unstable:

- runtime `fetch()` rewriting for production API paths
- Windows-only `--disable-web-security`
- dev server redirects that do not match production runtime behavior
- build-time scraping of Firebase config from the live production bundle
- a giant inline `OVERLAY_SCRIPT` that owns much of the actual feature logic
- tests that pass without proving the local-build architecture really works end to end

The result is a repo that looks like v2.0 on paper, but still behaves like a partially adapted 1.6-era wrapper in several critical places.

---

## Current-State Audit

### P0 - Critical

#### 1. The origin/network model is unresolved

Evidence:

- `src-tauri/src/main.rs` rewrites relative API calls such as `/profile`, `/bots`, `/leaderboards`, `/tilemap/`, `/game-history/`, and `/chat-history/` to `https://pokemon-auto-chess.com`
- `src-tauri/src/main.rs` also sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` with `--disable-web-security`
- `scripts/dev-server.js` separately handles those same API paths by issuing `302` redirects to production
- Linux is still shipped in `.github/workflows/release.yml`, but the explicit browser-argument workaround is Windows-only

Why this is a problem:

- Production and development do not share one coherent network path
- The local-build app still depends on cross-origin production APIs instead of having a real desktop-safe boundary
- Linux support is likely fragile because the current workaround is centered on Windows WebView2 behavior
- `--disable-web-security` is a major architectural smell, not a long-term fix

Impact:

- security model is weakened
- platform parity is poor
- networking bugs will be hard to reason about
- Linux release confidence is currently not justified

#### 2. The build pipeline is non-hermetic and brittle

Evidence:

- `scripts/build-frontend.js` mutates files inside `upstream-game/` with literal string replacements
- The current patch set is larger than the docs claim:
  - Phaser resize fix
  - booster Equip button
  - hardcoded WebSocket server URL
  - auth success URL fix
  - anonymous login redirect fix
  - server detection fix
- `scripts/build-frontend.js` also scrapes Firebase config from the live production site if `upstream-game/.env` is missing

Why this is a problem:

- builds depend on upstream file contents staying textually stable
- builds depend on live-site availability and bundle format
- the repo cannot truthfully claim a reproducible or fully transparent build when key config is scraped from production at build time
- upstream changes will fail late and opaquely

Impact:

- offline or deterministic builds are not guaranteed
- upstream syncs are high-risk
- docs and validation claims drift immediately when patch count changes

#### 3. Runtime behavior is concentrated in a monolithic injected script while `src/` is effectively orphaned

Evidence:

- `src-tauri/src/main.rs` contains the main injected runtime layer (`OVERLAY_SCRIPT`)
- That script currently owns API rewrites, asset caching, overlay behavior, session recovery, booster UI, and updater UX
- The modular JavaScript layer in `src/` exports `initializePerformanceOptimizations`, `tauriBridge`, monitors, overlay code, and cache code
- repo search shows those `src/` modules are not meaningfully wired into the shipped runtime

Why this is a problem:

- the codebase has two frontend architectures at once
- maintainability is poor because real runtime behavior is hidden in a giant Rust string literal
- testing and refactoring become much harder than they need to be
- documentation implies a cleaner module boundary than the runtime actually has

Impact:

- feature work is expensive and error-prone
- architectural intent is unclear
- dead or half-adopted code increases confusion for every contributor

#### 4. Validation does not cover the real risk surface of v2.0

Evidence:

- `tests/ethical-safeguards.test.js` scans `src/` and `src-tauri/src/`, but explicitly skips `scripts/`, `upstream-game/`, `dist/`, `validation/`, and docs
- `scripts/validate-determinism.js` scans a narrow subset of files and still prints wrapper-era messaging
- replay comparison is skipped when no fixtures exist, and the repo currently has no replay artifacts in `validation/replays/`
- there is no end-to-end smoke coverage for startup, auth, lobby, websocket connection, or updater behavior

Why this is a problem:

- tests are green without exercising the most fragile parts of the 2.0 architecture
- the patching/build pipeline is barely validated
- documentation claims can stay false without failing CI
- Linux release viability is not tested in any meaningful way

Impact:

- regressions can ship while CI stays green
- contributors get false confidence from passing validation

### P1 - High

#### 5. Documentation still drifts from the actual implementation

Current examples:

- `README.md`, `docs/README.md`, `docs/ETHICS_AND_COMPLIANCE.md`, and `docs/CHATGPT_AGENT_BRIEFING.md` still describe the build-time patch set as three changes
- `scripts/build-frontend.js` currently applies six distinct upstream patches plus Firebase config bootstrapping
- multiple docs still underspecify the role of updater behavior, session recovery, origin rewriting, and browser security flags
- Linux is described as experimental but is still published without matching runtime validation

Why this matters:

- the mission statement is not the only thing that must be accurate; the operating model and risk surface must also be accurate
- stale docs make future maintenance worse because contributors optimize for the wrong architecture

#### 6. Release scope is larger than current confidence justifies

Evidence:

- `.github/workflows/release.yml` builds and publishes both Windows and Linux artifacts
- there are no Linux-specific smoke tests
- the current origin/network workaround is not clearly cross-platform

Impact:

- release automation can publish artifacts that are not sufficiently validated
- platform support claims drift beyond what the repo actually proves

### P2 - Medium

#### 7. Repo hygiene and operational clarity need cleanup

Examples:

- the worktree currently contains local tooling artifacts such as `.playwright-mcp/`
- the repo contains a public updater key file (`.tauri-private.key.pub`) and a local private-key ignore rule, but there is no obvious release-security note explaining the intended key flow
- previous handoff material is not present in the repo today, so operational continuity is weaker than expected

This is not the main architectural problem, but it contributes to confusion.

---

## Root Cause

The 1.6 -> 2.0 migration changed the asset-loading model without fully redesigning the surrounding system.

What changed successfully:

- the app now builds upstream into `dist/`
- the Tauri shell now serves local frontend assets
- the repo has better documentation than 1.6 did

What did not finish:

- a safe same-origin or proxy strategy for authenticated upstream HTTP APIs
- a maintainable frontend runtime architecture
- deterministic build inputs
- release-quality validation for the new runtime model
- documentation that matches the real implementation in detail

In other words: 2.0 solved "where assets come from" before it solved "how the app should safely talk to production services."

---

## Decision Gate

Before implementation begins, choose one of these two paths:

### Option A: Stabilize the v2.0 local-build architecture

Use this if the goal is to keep bundled local assets, tighter desktop control, and the current native-client direction.

This is the recommended path if PACDeluxe intends to remain a true desktop client.

### Option B: Revert to a thinner live-site wrapper model

Use this if the goal is minimum maintenance and the project does not want to own local build patching, auth edge cases, and cross-origin desktop complexity.

This is the recommended path only if the team decides the maintenance cost of local-build ownership is not worth it.

### Recommendation

Assuming the project wants PACDeluxe 2.x to exist as a real desktop client, proceed with Option A and treat the next phases as a stabilization program, not incremental feature work.

No new features should land until Phase 2 is complete.

---

## Implementation Plan

## Phase 0 - Architecture Freeze and ADR

Goal:

- stop the repo from drifting while we stabilize it

Tasks:

1. Write an ADR documenting whether PACDeluxe remains a local-build client or intentionally rolls back to a wrapper model.
2. Freeze net-new feature work until the network/origin model and build pipeline are corrected.
3. Define the supported platform matrix explicitly:
   - Windows supported
   - Linux supported only if validated
   - otherwise Linux marked unsupported for release

Files to update:

- `docs/`
- `README.md`
- `CLAUDE.md`

Acceptance criteria:

- there is one documented target architecture
- contributor guidance no longer mixes the old wrapper model with the new local-build model

## Phase 1 - Replace the split network model

Goal:

- make development and production use one explicit, supportable path for upstream APIs

Tasks:

1. Remove dependency on `--disable-web-security` from the steady-state architecture.
2. Replace ad hoc `fetch()` rewriting and dev-server `302` redirects with one shared strategy.
3. Introduce a real upstream access boundary for required HTTP endpoints.

Recommended implementation shape:

- a Tauri-side allowlisted proxy or equivalent bridge for required production HTTP requests
- one central endpoint allowlist used by both dev and prod
- no silent origin rewriting scattered across multiple places

Files likely affected:

- `src-tauri/src/main.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/tauri.conf.json`
- `scripts/dev-server.js`

Acceptance criteria:

- login and authenticated profile loading work without `--disable-web-security`
- `/profile`, `/bots`, `/leaderboards`, `/tilemap/`, `/game-history/`, and `/chat-history/` all work through the same documented path in dev and prod
- Windows and Linux either share this strategy or Linux release artifacts are disabled

## Phase 2 - Make the build pipeline explicit and reproducible

Goal:

- convert the current build from "works if production is available and upstream text markers still match" to a stable, reviewable process

Tasks:

1. Remove Firebase config scraping from the live production bundle.
2. Replace it with an explicit config contract:
   - checked-in template
   - documented env requirements
   - fail-fast error messages
3. Replace freeform patching with a patch manifest or patch modules that each declare:
   - target file
   - precondition marker
   - exact intended change
   - postcondition assertion
4. Add a patch verification command that fails if docs and actual patch inventory diverge.

Files likely affected:

- `scripts/build-frontend.js`
- `package.json`
- `.gitignore`
- `docs/README.md`
- `TRANSPARENCY.md`

Acceptance criteria:

- frontend build no longer depends on scraping `https://pokemon-auto-chess.com`
- patch failures tell the developer exactly which upstream contract changed
- one canonical patch inventory exists and all docs derive from it

## Phase 3 - Collapse the frontend into one real runtime architecture

Goal:

- stop maintaining both `OVERLAY_SCRIPT` and an unused modular `src/` layer

Tasks:

1. Decide whether `src/` becomes the real frontend integration layer.
2. If yes, bundle and load it intentionally from the runtime.
3. Move runtime behaviors out of the monolithic Rust string and into testable frontend modules.
4. Leave only minimal bootstrap/invocation code in `main.rs`.
5. If `src/` is not being adopted, delete or archive it so the repo stops pretending it is active architecture.

Files likely affected:

- `src/`
- `src-tauri/src/main.rs`
- frontend build scripts and asset-loading hooks

Acceptance criteria:

- runtime feature logic is no longer primarily encoded in a giant inline string
- contributors can trace runtime behavior through normal source files
- dead architecture is removed

## Phase 4 - Upgrade validation to match the 2.0 risk profile

Goal:

- make CI prove that the new architecture actually works

Tasks:

1. Expand safeguard scanning to cover the build tooling that now shapes shipped behavior.
2. Add tests for patch inventory and build reproducibility assumptions.
3. Add end-to-end smoke coverage for:
   - app boot
   - login screen or auth entry
   - lobby load
   - websocket connectivity
   - required production API calls
   - overlay toggle
4. Decide the future of determinism validation:
   - either provide replay fixtures and make comparison meaningful
   - or remove/soften claims that imply determinism proof where none exists
5. Add Linux validation before shipping Linux artifacts.

Files likely affected:

- `tests/ethical-safeguards.test.js`
- `scripts/validate-determinism.js`
- `.github/workflows/release.yml`
- future Playwright or Tauri smoke test files

Acceptance criteria:

- CI fails when build patches drift
- CI fails when the app cannot boot into a minimally working state
- validation output accurately describes what was and was not proven

## Phase 5 - Rectify all user-facing and contributor-facing docs

Goal:

- make the repo say exactly what it does

Tasks:

1. Update `README.md` to reflect the full patch inventory and real feature scope.
2. Update `TRANSPARENCY.md` so network activity, file access, updater behavior, and build-time behavior are all accurate.
3. Update `docs/ETHICS_AND_COMPLIANCE.md` so validation scope and guarantees are precise.
4. Update `CLAUDE.md` and `docs/CHATGPT_AGENT_BRIEFING.md` so contributor tooling is pointed at the actual runtime model.
5. Remove wording that implies "performance-only" if the app intentionally includes updater, session recovery, and booster UX features.

Acceptance criteria:

- no stale "three patches" claims remain
- docs describe the real network model
- docs clearly separate fair-play guarantees from broader product-scope claims

## Phase 6 - Release and operational cleanup

Goal:

- make releases safer and day-to-day maintenance easier

Tasks:

1. Add a single `npm run verify` or similar command that runs:
   - tests
   - validation
   - patch verification
   - smoke checks
2. Add a release checklist covering:
   - supported platforms
   - upstream sync status
   - patch inventory review
   - doc sync
   - updater metadata
3. Document key management expectations for updater signing.
4. Remove or document stray local-tooling directories and repo artifacts.

Acceptance criteria:

- release steps are explicit and repeatable
- unsupported artifacts are not published by accident

---

## Recommended Execution Order

1. Phase 0 - choose architecture and freeze drift
2. Phase 1 - replace the split network/origin model
3. Phase 2 - harden the build pipeline
4. Phase 3 - unify runtime architecture
5. Phase 4 - upgrade validation and CI
6. Phase 5 - rectify docs
7. Phase 6 - clean up release operations

---

## Immediate Work Queue

If starting implementation now, these are the first concrete tickets to open:

1. ADR: confirm PACDeluxe remains a local-build client and define the supported platform matrix.
2. Remove `--disable-web-security` dependency by introducing a single allowlisted upstream API access path.
3. Refactor `scripts/dev-server.js` so dev uses the same API strategy as prod.
4. Remove live Firebase scraping and replace it with explicit build config requirements.
5. Split `scripts/build-frontend.js` into patch modules plus a canonical patch inventory.
6. Decide whether `src/` becomes the real frontend runtime or gets removed.
7. Add a smoke test that proves boot, login entry, and lobby load on Windows.
8. Disable Linux release artifacts until Linux passes the same smoke checks.
9. Rewrite validation output so it no longer overstates determinism proof.
10. Update all docs to match the actual implementation after the above changes land.

---

## Audit Notes

This audit was performed against the repository worktree present on 2026-03-27.

Verification completed during audit:

- `npm test` passed
- `npm run validate` passed only partially because replay comparison was skipped
- `cargo check` passed in `src-tauri/`

That combination currently means:

- the repo is buildable
- the narrow ethical/source scans pass
- the current validation suite is not strong enough to prove the 2.0 architecture is healthy
