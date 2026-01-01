# Ethics and Compliance Statement

## Pokemon Auto Chess Deluxe - Fair Play Commitment

This document formally states the ethical constraints and fair play guarantees of the Pokemon Auto Chess Deluxe native client.

---

## Core Principles

### 1. No Competitive Advantage

This client provides **zero competitive advantage** over players using the standard browser version. All optimizations affect only:

- Visual smoothness
- Input responsiveness
- System resource usage
- Application stability

### 2. Server Authority

All game logic remains **server-authoritative**:

- Game state is determined by the server
- RNG is server-controlled
- Matchmaking is unchanged
- Timing is server-synchronized

### 3. Information Parity

Users of this client see **exactly the same information** as browser users:

- No hidden state revealed
- No opponent information exposed
- No future events predicted
- No additional data displayed

---

## Explicitly Forbidden Functionality

The following are **never implemented** in this client:

### Game State Manipulation
- ❌ Reading hidden game state
- ❌ Modifying game variables
- ❌ Accessing opponent data
- ❌ Revealing hidden information

### RNG/Timing Manipulation
- ❌ Predicting random outcomes
- ❌ Manipulating random seeds
- ❌ Altering timing calculations
- ❌ Exploiting race conditions

### Automation
- ❌ Automated decision-making
- ❌ AI-assisted gameplay
- ❌ Macro support for game actions
- ❌ Input automation

### Network Manipulation
- ❌ Intercepting game traffic
- ❌ Modifying network messages
- ❌ Replaying or forging packets
- ❌ Man-in-the-middle attacks

---

## Implemented Safeguards

### Source Code Scanning

Automated tests scan all source code for:

```javascript
// Forbidden patterns checked by tests/ethical-safeguards.test.js
- opponent.*private
- hidden.*state
- modify.*rng
- automate.*decision
- bypass.*server
- intercept.*network
```

### Determinism Validation

Before any release:

1. Game replays are recorded in both native and browser clients
2. State hashes are compared tick-by-tick
3. RNG call sequences are verified
4. Final outcomes must match exactly

**Any divergence blocks deployment.**

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

The client logs all performance optimizations applied. Users can verify that only rendering and system optimizations are active.

### Reproducibility

Anyone can build the client from source and compare it to official releases.

---

## Contact

If you discover any functionality that appears to violate these principles, please report it immediately:

1. Open a GitHub issue
2. Email the maintainers
3. Contact the upstream Pokemon Auto Chess team

---

## Acknowledgments

This client respects the work of:

- The Pokemon Auto Chess development team
- The open-source gaming community
- Players who expect fair competition

---

*Last Updated: 2024*

*This document is legally non-binding but represents our firm commitment to fair play.*
