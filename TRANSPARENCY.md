# PACDeluxe Transparency Report

## What PACDeluxe Is

PACDeluxe is a local-build desktop client for Pokemon Auto Chess.

It:

- builds the upstream web client into `dist/`
- loads that local frontend in a Tauri desktop shell
- adds native system-performance features
- injects a PACDeluxe runtime layer for overlay and non-competitive QoL behavior
- proxies upstream HTTP requests to the production origin through a native origin-scoped proxy

It does not modify competitive gameplay logic.

## Current Platform Matrix

- Windows: released and supported
- Linux: local experimentation only, public release paused

## Runtime Behavior

### Native system behavior

PACDeluxe may:

- raise process priority
- request finer timer resolution
- disable power throttling for the process
- tune window behavior
- monitor CPU, memory, GPU, and HDR state where supported

### Injected frontend behavior

PACDeluxe currently injects runtime logic from `src-tauri/src/main.rs` for:

- scrollbar and viewport fixes
- canvas context-menu suppression
- in-memory asset caching
- performance overlay
- fullscreen and borderless controls
- session recovery behavior
- booster `Flip All`
- updater banner UX

### Upstream HTTP proxy

PACDeluxe uses a native origin-scoped HTTP proxy for the local-build runtime instead of relying on `--disable-web-security`.

Scope (enforced by `src-tauri/src/commands.rs`):

- relative URLs → routed to `https://pokemon-auto-chess.com`
- absolute HTTPS URLs → accepted only for `pokemon-auto-chess.com` (or subdomains)
- exactly one read-only GitHub URL is allowed for the community-servers manifest
- any other destination is rejected

The proxy does not inspect or rewrite request or response bodies and is not used for non-HTTP game traffic (WebSocket game sessions still connect directly).

## Network Activity

PACDeluxe may contact:

- `wss://pokemon-auto-chess.com` for game sessions
- Firebase and Google endpoints for authentication
- `https://github.com/RJW34/PACDeluxe/releases/latest/download/latest.json` for updater checks
- official PAC HTTP endpoints through the native origin-scoped proxy
- cached asset URLs during asset prewarm

PACDeluxe does not operate its own telemetry or gameplay-data collection service.

## Local File Access

PACDeluxe may write or read:

- Tauri app data
- WebView storage and localStorage
- `dist/` build output during local builds
- `upstream-game/.env` during frontend build preparation

On startup it may remove known stale local PACDeluxe artifacts from prior installations.

## Build-Time Patches

Canonical patch inventory:

- `docs/PATCH_MANIFEST.md`

PACDeluxe does not rely on undocumented upstream patches.

## Explicit Non-Goals

PACDeluxe does not:

- reveal hidden game state
- modify server-authoritative outcomes
- automate gameplay decisions
- inject memory-reading or packet-forging behavior
- scrape Firebase client config from the live production site during builds

## Source of Truth

- Main runtime: `src-tauri/src/main.rs`
- Native commands and proxy: `src-tauri/src/commands.rs`
- System tuning: `src-tauri/src/performance.rs`
- Build pipeline: `scripts/build-frontend.js`
- Patch manifest: `docs/PATCH_MANIFEST.md`

Last updated: 2026-04-13
