# PACDeluxe Briefing

Use this as a compact repo briefing for writing docs, PRDs, or implementation notes.

## Project

PACDeluxe is a local-build desktop client for Pokemon Auto Chess.

The app:

- bundles upstream frontend assets into `dist/`
- loads them in a Tauri window
- applies native performance/system tuning
- injects runtime UI/performance logic from `src-tauri/src/main.rs`
- uses a native allowlisted proxy for required upstream HTTP requests

## Critical Constraint

PACDeluxe must not:

- reveal hidden state
- alter RNG or timing rules
- automate gameplay
- modify server-authoritative competitive behavior

## Current Platform Matrix

- Windows: supported and released
- Linux: local experimentation only, release paused

## Key Files

| File | Role |
|---|---|
| `src-tauri/src/main.rs` | Tauri entry point and injected PACDeluxe runtime |
| `src-tauri/src/commands.rs` | Tauri commands, updater flow, allowlisted HTTP proxy |
| `src-tauri/src/performance.rs` | System tuning and telemetry |
| `scripts/build-manifest.js` | Canonical patch and config inventory |
| `scripts/proxy-manifest.js` | Canonical upstream HTTP proxy allowlist |
| `scripts/build-frontend.js` | Upstream patching and frontend bundling |
| `scripts/verify-build-manifest.js` | Patch/doc drift detection |
| `docs/PATCH_MANIFEST.md` | Canonical upstream patch inventory |

## Build Notes

- Local builds require explicit Firebase client config.
- Template: `config/firebase-client.env.example`
- PACDeluxe does not scrape production bundles for build config.

## Validation Notes

- Use `npm run verify`
- Replay validation is only complete when fixtures exist in `validation/replays/`

## Documentation Notes

- Refer to `docs/PATCH_MANIFEST.md` instead of hardcoding patch counts in multiple docs.
- Be explicit that PACDeluxe includes both performance features and non-competitive QoL/runtime features.
