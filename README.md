# PACDeluxe

PACDeluxe is a native desktop client for [Pokemon Auto Chess](https://pokemon-auto-chess.com) that bundles the upstream game, serves assets locally, and adds native performance features plus a small set of non-competitive quality-of-life features.

## Download

**[Download Latest Release](https://github.com/RJW34/PACDeluxe/releases/latest)**

## Platform Support

- **Windows** - released and supported
- **Linux** - local experimentation only; release artifacts are paused until parity validation exists

## What PACDeluxe Does

- Bundles the upstream web client into a Tauri desktop shell
- Serves game assets locally from `dist/`
- Uses native system-performance tuning on supported platforms
- Shows an in-app performance overlay
- Adds non-competitive QoL such as booster `Flip All`, avatar `Equip`, session recovery, and updater UX
- Uses a native allowlisted proxy for required upstream HTTP endpoints instead of relying on browser-security bypasses

All competitive gameplay remains server-authoritative.

## Build-Time Patches

PACDeluxe applies a documented set of non-gameplay upstream patches during `npm run build:frontend`.

Canonical patch inventory:

- `docs/PATCH_MANIFEST.md`

## Development

```bash
npm install
npm run sync-upstream
cd upstream-game && npm install && cd ..
npm run build:frontend
npm run tauri:dev
```

## Build Requirements

PACDeluxe requires explicit Firebase client configuration for local builds.

Use one of:

1. `config/firebase-client.env`
2. shell environment variables
3. an existing `upstream-game/.env`

Template:

- `config/firebase-client.env.example`

PACDeluxe does not scrape Firebase config from the live production site at build time.

## Verification

Run the full repo verification pass before release work:

```bash
npm run verify
```

This runs:

- ethical safeguard tests
- validation harness
- patch-manifest verification
- `cargo check`

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Toggle performance overlay |
| `F11` | Toggle fullscreen |
| `Shift+F11` | Toggle borderless windowed |

## FAQ

**Is this cheating?**  
No. PACDeluxe does not reveal hidden state, alter server-authoritative game logic, or automate gameplay.

**What gets modified?**  
Only documented non-gameplay runtime behavior and the patch inventory listed in `docs/PATCH_MANIFEST.md`.

**Why is Linux not released right now?**  
The repo still contains Linux-specific code paths, but public Linux release artifacts are paused until the local-build network/runtime path has equivalent validation.

## More Docs

- `TRANSPARENCY.md`
- `docs/README.md`
- `docs/ETHICS_AND_COMPLIANCE.md`
- `docs/ADR-0001-local-build-architecture.md`
- `docs/RELEASE_CHECKLIST.md`

## Credits

- [Pokemon Auto Chess](https://github.com/keldaanCommunity/pokemonAutoChess) by keldaanCommunity
- Pokemon content is (c) Nintendo/Creatures Inc./GAME FREAK Inc.

## License

BSD-3-Clause
