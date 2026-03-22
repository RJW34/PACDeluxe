# Ethics and Compliance Statement

## Pokemon Auto Chess Deluxe - Fair Play Commitment

This document states the ethical constraints and fair play guarantees of the PACDeluxe native client.

---

## Core Principles

### 1. No Hidden State Access

This client does not access, reveal, or exploit any hidden game state:

- No opponent information exposed
- No future events predicted
- No hidden server-side data read

### 2. Server Authority

All game logic remains **server-authoritative**:

- Game state is determined by the server
- RNG is server-controlled
- Matchmaking is unchanged
- Timing is server-synchronized

### 3. No Automated Decision-Making

No gameplay decisions are made by the client:

- No auto-play or auto-battle
- No AI-assisted gameplay
- No macro support for game actions
- No input automation

### 4. Information Display

Users see the same **game information** as browser users. The performance overlay displays system-level telemetry (FPS, CPU, GPU, memory, refresh rate, RTT, HDR status) that is not derived from game state and does not reveal any hidden gameplay information.

### 5. Non-Competitive QoL Features

PACDeluxe includes a small set of quality-of-life features (booster "Flip All", "Equip" shortcut, session recovery) that provide convenience but do not affect competitive outcomes. These features interact only with client-side UI elements and do not access server-authoritative state.

---

## Explicitly Forbidden Functionality

The following are **never implemented** in this client:

### Game State Manipulation
- Reading hidden game state
- Modifying game variables
- Accessing opponent data
- Revealing hidden information

### RNG/Timing Manipulation
- Predicting random outcomes
- Manipulating random seeds
- Altering timing calculations
- Exploiting race conditions

### Automation
- Automated decision-making
- AI-assisted gameplay
- Macro support for game actions
- Input automation

### Network Manipulation
- Intercepting game traffic
- Modifying network messages
- Replaying or forging packets
- Man-in-the-middle attacks

---

## Implemented Safeguards

### Source Code Scanning

Automated tests scan source files in `src/` and `src-tauri/src/` for forbidden patterns:

```javascript
// Forbidden patterns checked by tests/ethical-safeguards.test.js
- opponent.*private
- hidden.*state
- modify.*rng
- automate.*decision
- bypass.*server
- intercept.*network
```

**Scan scope:** `src/`, `src-tauri/src/`. Excluded directories: `scripts/`, `docs/`, `tests/`, `dist/`, `upstream-game/`, `node_modules/`, `target/`.

### Determinism Validation

The validation harness (`npm run validate`) performs:

1. Static source scanning for forbidden patterns (required)
2. Replay-based state comparison when replay artifacts are present (optional)

Replay comparison runs only when `validation/replays/` contains matching native and browser replay files. When present, state hashes are compared tick-by-tick and any divergence blocks deployment.

### Build-Time Patches

All modifications to upstream source code are:

- Applied at build time by `scripts/build-frontend.js`
- Idempotent (safe to re-apply)
- Documented in `TRANSPARENCY.md`
- Limited to: initial resize fix, booster Equip button, server URL hardcode
- None modify game logic, RNG, matchmaking, or server-authoritative behavior

### Code Review Requirements

All changes must:

1. Pass automated ethical safeguard tests
2. Document any DOM interactions
3. Justify any network-adjacent code
4. Receive maintainer approval

---

## Transparency

### Open Source

All source code is publicly available for inspection. Anyone can verify that no cheating functionality exists.

### Logging

The client logs all performance optimizations applied. Users can verify activity via browser/Tauri developer tools.

### Reproducibility

Anyone can build the client from source and compare it to official releases.

---

## Contact

If you discover any functionality that appears to violate these principles, please report it immediately:

1. Open a GitHub issue
2. Contact the upstream Pokemon Auto Chess team

---

## Acknowledgments

This client respects the work of:

- The Pokemon Auto Chess development team
- The open-source gaming community
- Players who expect fair competition

---

*Last Updated: 2026-03*

*This document is legally non-binding but represents our firm commitment to fair play.*
