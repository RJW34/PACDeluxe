# PACDeluxe Docs

PACDeluxe is a local-build desktop client for Pokemon Auto Chess.

## Current Architecture

PACDeluxe currently consists of:

- a Tauri v2 desktop shell
- a locally built upstream frontend served from `dist/`
- a Rust native backend for system tuning, window control, updater behavior, and the allowlisted upstream HTTP proxy
- an injected runtime layer in `src-tauri/src/main.rs`
- a build pipeline in `scripts/build-frontend.js`

## Source of Truth

- Architecture decision: `docs/ADR-0001-local-build-architecture.md`
- Patch inventory: `docs/PATCH_MANIFEST.md`
- Transparency and runtime behavior: `TRANSPARENCY.md`
- Fair-play constraints: `docs/ETHICS_AND_COMPLIANCE.md`
- Release process: `docs/RELEASE_CHECKLIST.md`

## Supported Platform Matrix

- Windows: supported and released
- Linux: local experimentation only, public release paused

## Build Flow

```bash
npm install
npm run sync-upstream
cd upstream-game && npm install && cd ..
npm run build:frontend
npm run tauri:dev
```

The frontend build:

1. resolves Firebase client config from explicit inputs
2. applies the canonical non-gameplay patch set
3. builds upstream assets into `dist/`
4. generates the local `index.html` used by Tauri

## Runtime Flow

1. Tauri loads `dist/index.html`
2. native system optimizations are applied
3. the injected PACDeluxe runtime is loaded from `src-tauri/src/main.rs`
4. required upstream HTTP calls go through a native allowlisted proxy command
5. gameplay still connects to the official Colyseus server

## Validation

Use:

```bash
npm run verify
```

This includes:

- `npm test`
- `npm run validate`
- `npm run verify:manifest`
- `cargo check --manifest-path src-tauri/Cargo.toml --message-format short`

## Notes For Contributors

- Do not add undocumented upstream patches.
- Do not reintroduce `--disable-web-security`.
- Do not add build-time scraping of production configuration.
- Keep docs pointing at `docs/PATCH_MANIFEST.md` instead of duplicating patch counts in multiple places.
