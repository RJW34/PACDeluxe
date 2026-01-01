# Upstream Repository Analysis

## pokemonAutoChess Technical Analysis

**Repository:** https://github.com/keldaanCommunity/pokemonAutoChess
**Version Analyzed:** 6.7.0

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Game Engine | Phaser 3.90.0 (WebGL/Canvas) |
| UI Framework | React 19 + Redux Toolkit |
| Networking | Colyseus 0.16 (WebSocket) |
| Build System | esbuild |
| Backend | Node.js + Express + MongoDB |
| Auth | Firebase |
| Language | TypeScript 5.7 |

---

## Entry Points

- **Frontend Entry:** `app/public/src/index.tsx`
- **Game Scene:** `app/public/src/game/scenes/game-scene.ts`
- **Game Container:** `app/public/src/game/game-container.ts`
- **esbuild Config:** `esbuild.js`

---

## Rendering Pipeline

### Phaser Configuration (game-container.ts:272-293)
```typescript
const config = {
  type: renderer,  // Phaser.AUTO (WebGL or Canvas fallback)
  width: 1950,
  height: 1000,
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT },
  plugins: [MoveToPlugin, OutlinePlugin]
}
```

### Key Rendering Components
1. **GameScene** - Main game scene with tilemap, board, battle views
2. **BattleManager** - Pokemon battle animations
3. **BoardManager** - Team placement and drag/drop
4. **WeatherManager** - Particle effects (rain, snow, sandstorm)
5. **AnimationManager** - Sprite animation orchestration
6. **MinigameManager** - Town phase interactive elements

### Asset Loading
- Tilemaps loaded via `preloadMaps()` with fetch + Phaser loader
- Pokemon sprites from `/assets/pokemons/`
- Abilities VFX from `/assets/` sprite atlases
- Service worker (`sw.js`) for caching

---

## State Management

### Colyseus Schema Synchronization
- Game state synced via `@colyseus/schema`
- Heavy use of `.listen()` callbacks for property changes
- Per-pokemon entity listeners for: position, orientation, action, HP, stats, status effects
- Simulation state listeners for battle progression

### Redux Store
- Client-side UI state
- Player information caching
- Game phase tracking

---

## Identified Performance Bottlenecks

### 1. Schema Callback Overhead
**Location:** `game-container.ts:125-266`

Each Pokemon entity registers 20+ individual property listeners plus status field listeners. During battles with 10+ Pokemon, this creates significant callback overhead.

### 2. DOM/Canvas Hybrid Rendering
**Location:** `index.tsx`, `game-scene.ts`

React DOM and Phaser canvas coexist, causing:
- Layout thrashing during React re-renders
- Competing animation frame requests
- GC pressure from React reconciliation

### 3. Tilemap Animation
**Location:** `game-scene.ts:380-388`

Animated tiles use `phaser-animated-tiles` plugin which can cause frame drops on complex maps.

### 4. Weather Particles
**Location:** `weather-manager.ts`

Particle emitters for weather effects consume significant GPU resources without pooling optimization.

### 5. Browser Background Throttling
When tab is backgrounded, browser throttles:
- requestAnimationFrame to 1fps
- WebSocket polling
- Timer precision

### 6. Garbage Collection
No explicit object pooling for:
- Damage/heal text displays
- Ability animations
- Temporary sprites

---

## Safe Optimization Targets

### Rendering (No Logic Changes)
- Force WebGL renderer (skip Canvas fallback)
- Enable GPU compositing layers
- Lock canvas resolution
- Pool sprite objects
- Batch render calls
- Disable vsync during catch-up

### Asset Loading
- Preload all assets before match start
- Use compressed textures (basis/ktx2)
- Memory-map large atlases
- Background decode in native helper

### Frame Pacing
- Control RAF cadence explicitly
- Skip render during heavy state updates
- Prioritize input processing
- Use high-resolution timers

### Network
- Buffer state updates
- Batch UI updates per frame
- Reduce listener registration overhead

---

## Files Requiring No Modification

These files contain gameplay logic and MUST remain unchanged:
- `app/core/simulation.ts`
- `app/core/pokemon-entity.ts`
- `app/core/abilities/`
- `app/core/effects/`
- `app/core/matchmaking.ts`
- All `app/models/` schema definitions
- All `app/rooms/` server logic

---

## Build Pipeline

### Development
```bash
npm run dev-client   # esbuild watch mode
npm run dev-server   # ts-node-dev server
npm run dev          # parallel both
```

### Production
```bash
npm run build-client  # esbuild production bundle
npm run build-server  # tsc compilation
npm run build         # both
```

### Output
- Client: `app/public/dist/client/index-[hash].js`
- Server: `app/public/dist/server/`

---

## Integration Strategy

### Phase 1: Embed Unchanged
Load the unmodified frontend in Tauri WebView with:
- Disabled background throttling
- Forced GPU acceleration
- Custom service worker for asset caching

### Phase 2: Performance Overlay
Add non-intrusive performance monitoring:
- Frame time graph
- Memory usage
- Network latency
- All rendering happens in separate overlay

### Phase 3: Native Asset Pipeline
Offload to Rust helper:
- Image decoding
- Audio decoding
- Compression
- No game state access

### Phase 4: Rendering Optimization
Configure Phaser for maximum performance:
- WebGL-only mode
- Batch rendering
- Object pooling
- Texture compression

---

## Determinism Requirements

All optimizations must preserve:
1. Identical RNG sequences (server-controlled)
2. Same frame timing for gameplay
3. Identical network message order
4. Same collision detection results
5. Equivalent visual output
