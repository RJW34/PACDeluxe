# Pokemon Auto Chess Deluxe

A native desktop client for [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) focused exclusively on performance optimization.

## Overview

Pokemon Auto Chess Deluxe is a native wrapper for the Pokemon Auto Chess browser game that provides:

- **Smoother frame pacing** through native rendering optimizations
- **Lower input latency** via high-priority event handling
- **Reduced memory usage** through efficient caching
- **Better CPU utilization** with native helper processes
- **Consistent performance** by eliminating browser overhead

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
│  │  │         Pokemon Auto Chess (Unchanged)         │   │   │
│  │  │  ┌─────────────────────────────────────────┐  │   │   │
│  │  │  │              Phaser 3 Game               │  │   │   │
│  │  │  └─────────────────────────────────────────┘  │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │         Performance Optimization Layer         │   │   │
│  │  │  • Render Optimizer  • Frame Pacer            │   │   │
│  │  │  • Input Optimizer   • Asset Cache            │   │   │
│  │  │  • Profiling Overlay                          │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Native Performance Helper               │   │
│  │  • Image decoding    • Asset preloading             │   │
│  │  • System monitoring • Power management             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js 20+
- Rust 1.70+
- Platform-specific build tools:
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: build-essential, libwebkit2gtk-4.1-dev

### Build Steps

```bash
# Clone the repository
git clone https://github.com/your-repo/pokemon-auto-chess-deluxe
cd pokemon-auto-chess-deluxe

# Install dependencies
npm install

# Sync upstream game
npm run sync-upstream

# Development mode
npm run dev

# Production build
npm run build
```

## Usage

### Development

```bash
# Build frontend and start Tauri dev mode
npm run dev

# Build frontend only
npm run build:frontend

# Run Tauri in development mode (requires built frontend)
npm run tauri:dev
```

**Note:** Hot Module Replacement (HMR) is not supported due to how the game is embedded. Changes require a full frontend rebuild.

### Production

```bash
# Build production release
npm run build

# Validate before release
npm run validate

# Run tests
npm test
```

### Keyboard Shortcuts

- `Ctrl+Shift+P`: Toggle performance overlay
- Standard game shortcuts remain unchanged

## Configuration

Configuration is stored in:
- Windows: `%APPDATA%/pokemon-auto-chess-deluxe/config.json`
- macOS: `~/Library/Application Support/pokemon-auto-chess-deluxe/config.json`
- Linux: `~/.config/pokemon-auto-chess-deluxe/config.json`

### Options

```json
{
  "performance": {
    "power_mode": "high_performance",
    "disable_background_throttle": true,
    "preload_assets": true,
    "cache_size_mb": 512
  },
  "display": {
    "width": 1920,
    "height": 1080,
    "fullscreen": false,
    "borderless": false
  },
  "debug": {
    "show_perf_overlay": false
  }
}
```

**Note:** VSync and target FPS are controlled by the browser's rendering pipeline and Phaser engine. The `power_mode` option accepts: `balanced`, `high_performance`, or `power_saver`.

## Performance Optimizations

### Rendering
- Phaser WebGL hardware acceleration
- GPU compositing via native window layer
- DWM transition animation bypass (Windows)
- Compositor bypass hints (Linux)

### Input
- High-priority event handling
- Input-to-render latency tracking
- MessageChannel for faster callbacks

### Assets
- IndexedDB-backed asset cache with LRU eviction
- Service worker caching for offline access
- Background asset preloading during load screens

### System
- Above-normal process priority (Windows/Linux)
- High-resolution 1ms timer (Windows)
- App Nap prevention (macOS)
- QoS class optimization (macOS)
- Disabled background throttling
- Power mode management (Balanced/High Performance/Power Saver)

## Validation

Before any release, run the validation harness:

```bash
npm run validate
```

This checks:
1. Ethical compliance (no cheating code)
2. Determinism validation (identical game outcomes)
3. Source code scanning for forbidden patterns

## License

BSD-3-Clause (matching upstream)

## Contributing

Contributions must:
1. Pass all ethical safeguard tests
2. Not modify gameplay logic
3. Focus only on performance
4. Include appropriate tests

## Integration with Upstream

This client embeds the [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) game without modifications:

1. **Sync upstream**: `npm run sync-upstream` clones/updates the game repository to `upstream-game/`
2. **Build frontend**: `npm run build:frontend` builds the upstream client and copies to `dist/`
3. **Tauri wrapper**: The Tauri shell loads the built frontend with performance optimizations

### Performance Layer

The performance optimization layer is injected as a separate module that:
- Hooks into Phaser's render loop for metrics (does not modify rendering)
- Provides asset caching via IndexedDB
- Exposes native system APIs through Tauri IPC

### Important Notes

- All game logic runs unmodified from upstream
- Server connections go directly to official servers
- No gameplay data is intercepted or modified
- Updates require re-running `npm run sync-upstream`

## Disclaimer

This is an unofficial client. Pokemon Auto Chess is developed by the [keldaanCommunity](https://github.com/keldaanCommunity/pokemonAutoChess).

All Pokemon-related content is © Nintendo/Creatures Inc./GAME FREAK Inc.
