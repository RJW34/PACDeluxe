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
# Start development server with hot reload
npm run dev

# Build frontend only
npm run build:frontend

# Run Tauri in development mode
npm run tauri:dev
```

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
- `F11`: Toggle fullscreen mode
- `Shift+F11`: Toggle borderless windowed mode
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
    "vsync": true,
    "target_fps": 60,
    "gpu_acceleration": true,
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

## Performance Optimizations

### Rendering
- WebGL-only mode (no Canvas fallback)
- GPU compositing layers
- Object pooling for sprites
- Batch rendering calls

### Input
- High-priority event handling
- Input-to-render latency tracking
- MessageChannel for faster callbacks

### Assets
- Aggressive service worker caching
- Native image decoding
- Memory-mapped asset loading
- Background preloading

### System
- Above-normal process priority
- High-resolution timer
- Disabled background throttling
- Power mode management

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

## Disclaimer

This is an unofficial client. Pokemon Auto Chess is developed by the [keldaanCommunity](https://github.com/keldaanCommunity/pokemonAutoChess).

All Pokemon-related content is © Nintendo/Creatures Inc./GAME FREAK Inc.
