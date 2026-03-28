# CLAUDE.md

This file gives Claude Code the current repo truth for PACDeluxe.

## Project Summary

PACDeluxe is a local-build desktop client for Pokemon Auto Chess.

- frontend assets are built into `dist/`
- Tauri loads `dist/index.html`
- native behavior lives in `src-tauri/src/`
- build-time upstream patching lives in `scripts/build-frontend.js`
- the canonical upstream patch inventory lives in `docs/PATCH_MANIFEST.md`

## Supported Platforms

- Windows: supported and released
- Linux: local experimentation only; public release paused

## Architecture Notes

The repo intentionally does **not** maintain a second standalone frontend runtime anymore.

Current runtime source of truth:

- `src-tauri/src/main.rs`

Current native/backend source of truth:

- `src-tauri/src/commands.rs`
- `src-tauri/src/performance.rs`

Current build source of truth:

- `scripts/build-manifest.js`
- `scripts/build-frontend.js`
- `scripts/verify-build-manifest.js`

## Guardrails

- Do not add competitive gameplay changes.
- Do not add hidden-state access.
- Do not reintroduce `--disable-web-security`.
- Do not scrape Firebase config from the live production site.
- Do not add undocumented upstream patches.
- Keep docs pointing at `docs/PATCH_MANIFEST.md` rather than duplicating patch counts.

## Build Commands

```bash
npm install
npm run sync-upstream
cd upstream-game && npm install && cd ..
npm run build:frontend
npm run tauri:dev
```

## Verification Commands

```bash
npm test
npm run validate
npm run verify:manifest
npm run verify
```

## Key Docs

- `docs/ADR-0001-local-build-architecture.md`
- `docs/PATCH_MANIFEST.md`
- `TRANSPARENCY.md`
- `docs/ETHICS_AND_COMPLIANCE.md`
- `docs/RELEASE_CHECKLIST.md`
