# PACDeluxe

A native desktop client for [Pokemon Auto Chess](https://pokemon-auto-chess.com) that bundles the upstream game with performance optimizations and quality-of-life features.

## Download

**[Download Latest Release](https://github.com/RJW34/PACDeluxe/releases/latest)**

## Platform Support

- **Windows** (primary) — MSI and NSIS installers
- **Linux** (experimental) — AppImage

## Installation

1. Download the installer for your platform from the link above
2. Run the installer
3. Launch PACDeluxe from your desktop or Start menu

## Features

- **Local Asset Serving** — Game assets are bundled and served locally for zero network latency on load
- **GPU-Optimized Rendering** — Chromium GPU rasterization and zero-copy flags enabled
- **System Performance Tuning** — Process priority elevation, 1ms timer resolution, power throttle bypass (Windows)
- **Performance Overlay** — Monitor FPS, CPU, GPU, memory, refresh rate, RTT, and HDR status
- **Fullscreen & Borderless** — Native fullscreen and borderless windowed modes
- **Booster QoL** — "Flip All" button on booster packs, "Equip" button for new avatar cards
- **Session Recovery** — Detects broken auth state and auto-recovers
- **Auto-Updater** — Checks GitHub releases and offers in-app updates
- **Pixel-Perfect Rendering** — Nearest-neighbor texture filtering for crisp sprite art

## How to Use

1. Launch PACDeluxe
2. Log in with your Google account (same as the browser version)
3. Play normally — all game logic runs on the official servers

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` | Toggle performance overlay |
| `F11` | Toggle fullscreen |
| `Shift+F11` | Toggle borderless windowed |

## FAQ

**Is this cheating?**
No. PACDeluxe does not access hidden game state, alter server-authoritative gameplay logic, or automate decisions. It adds performance optimizations and a small set of non-competitive quality-of-life features. All game logic runs on the official servers.

**Will I get banned?**
PACDeluxe does not violate any game rules. It is a different way to access the same game with the same servers.

**Do I need a separate account?**
No. Use your existing Google login.

**Can I still play with browser users?**
Yes. You connect to the same servers and play with everyone.

**What gets patched at build time?**
Three non-gameplay changes: an initial resize fix for Phaser, an "Equip" button for new booster cards, and a server URL hardcode for local serving. No game logic is modified.

## Issues

If something isn't working, [open an issue](https://github.com/RJW34/PACDeluxe/issues).

## Credits

- [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) by keldaanCommunity
- Pokemon content is (c) Nintendo/Creatures Inc./GAME FREAK Inc.

## License

BSD-3-Clause
