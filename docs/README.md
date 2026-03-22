# Pokemon Auto Chess Deluxe

A native desktop client for [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) with performance optimizations and quality-of-life features.

## Overview

PACDeluxe bundles the upstream Pokemon Auto Chess game into a native desktop app that provides:

- **Local asset serving** — Game assets bundled locally for zero network latency on load
- **GPU-optimized rendering** — Chromium GPU rasterization and zero-copy flags
- **Lower system overhead** — Process priority elevation, timer resolution, power throttle bypass
- **Better CPU utilization** — WebView2 child process priority management
- **Consistent performance** — Background throttling disabled at the Chromium level

## Non-Cheating Guarantee

**This client does NOT provide any competitive advantage.**

The following are explicitly forbidden and are not implemented:

- Reading or modifying hidden game state
- Accessing opponent information
- Altering RNG or timing logic
- Automating gameplay decisions
- Modifying network traffic
- Bypassing server validation

All gameplay logic remains server-authoritative and unchanged.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri Desktop Shell                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  WebView (Frontend)                   │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │   Pokemon Auto Chess (build-time patches)      │   │   │
│  │  │  ┌─────────────────────────────────────────┐  │   │   │
│  │  │  │              Phaser 3 Game               │  │   │   │
│  │  │  └─────────────────────────────────────────┘  │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │       Injected Runtime Layer (OVERLAY_SCRIPT)  │   │   │
│  │  │  • Performance Overlay  • Asset Cache          │   │   │
│  │  │  • Session Recovery     • Booster Flip All     │   │   │
│  │  │  • Auto-Updater         • Window Controls      │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Native Performance Backend              │   │
│  │  • Process priority     • Timer resolution          │   │
│  │  • System monitoring    • Power management          │   │
│  │  • GPU monitoring       • HDR detection             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js 20+
- Rust 1.70+
- Platform-specific build tools:
  - Windows: Visual Studio Build Tools
  - Linux: build-essential, libwebkit2gtk-4.1-dev

### Build Steps

```bash
# Clone the repository
git clone https://github.com/RJW34/PACDeluxe
cd PACDeluxe

# Install dependencies
npm install

# Sync upstream game
npm run sync-upstream
cd upstream-game && npm install && cd ..

# Build frontend (applies patches, bundles to dist/)
npm run build:frontend

# Development mode
npm run tauri:dev

# Production build
npm run tauri:build
```

## Usage

### Development

```bash
# Build frontend with patches
npm run build:frontend

# Start Tauri in development mode
npm run tauri:dev

# Or use the dev server
npm run dev:server
```

### Production

```bash
# Build production release
npm run build

# Run source scanning + optional replay validation
npm run validate

# Run ethical safeguard tests
npm test
```

### Keyboard Shortcuts

- `Ctrl+Shift+P`: Toggle performance overlay
- `F11`: Toggle fullscreen mode
- `Shift+F11`: Toggle borderless windowed mode
- Standard game shortcuts remain unchanged

## Performance Optimizations

### Rendering (Chromium flags)
- GPU rasterization enabled
- Zero-copy rasterization (reduces memory copies)
- Background timer throttling disabled
- Renderer backgrounding disabled

### Assets
- Local asset serving (zero network latency)
- In-memory fetch cache (128MB, version-aware)
- Session-based asset prewarming
- Nearest-neighbor texture filtering for pixel art

### System (Rust backend)
- Above-normal process priority
- High-resolution timer (1ms)
- Power throttling disabled
- DWM transition optimizations
- WebView2 child process priority elevation

## Build-Time Patches

The build process applies three idempotent patches to the upstream source:

1. **Phaser resize** — Forces initial resize call in `game-container.ts`
2. **Booster Equip** — Adds avatar equip button in `booster.tsx`
3. **Server URL** — Hardcodes WebSocket URL in `network.ts` for local serving

No game logic, RNG, matchmaking, or competitive behavior is modified.

## Validation

Before any release, run the validation harness:

```bash
npm run validate
```

This performs:
1. Static source scanning for forbidden patterns (required)
2. Replay-based determinism comparison when replay artifacts are present (optional)

## License

BSD-3-Clause (matching upstream)

## Contributing

Contributions must:
1. Pass all ethical safeguard tests
2. Not modify competitive gameplay logic
3. Include appropriate tests
4. Use idempotent build-time patches for any upstream changes

## Disclaimer

This is an unofficial client. Pokemon Auto Chess is developed by the [keldaanCommunity](https://github.com/keldaanCommunity/pokemonAutoChess).

All Pokemon-related content is (c) Nintendo/Creatures Inc./GAME FREAK Inc.
