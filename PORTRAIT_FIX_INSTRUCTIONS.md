# Portrait Rendering Fix - Implementation Instructions

## Problem Summary

The Pokemon portraits in the bottom shop/bench row appear "muddy" or blurry on high-resolution displays (1440p, 4K) compared to the crisp battle sprites on the game board.

**Root Cause Discovered:**
- Battle sprites render on **Phaser canvas** with `pixelArt: true` and integer scaling (`.setScale(2)`)
- Portraits render as **DOM/HTML `<img>` elements** with CSS viewport-based scaling (`width: 7.5vw`)
- CSS percentage/viewport units cause **subpixel rendering** which creates the muddy appearance
- The portraits aren't using Phaser's pixel-perfect rendering pipeline at all

## Goal

Fix the portrait rendering in PACDeluxe by overriding the CSS to use **integer pixel scaling** instead of viewport-relative units.

## Technical Details

### Current Problem (from upstream PAC code)

Portraits are styled with viewport-relative sizing:
```css
width: 7.5vw;
background-size: contain;
```

At 1440p, `7.5vw` = 108px, which is NOT an integer multiple of 40 (the native portrait size).
This causes the browser to interpolate pixels, creating blur.

### The Fix

Force portraits to render at **integer multiples of 40px** (the native 40x40 portrait size):
- 80px = 2x scale
- 120px = 3x scale
- 160px = 4x scale

## Implementation Steps

### Step 1: Locate CSS Injection Point

Find where PACDeluxe can inject custom CSS into the game. This could be:
- A custom CSS file loaded by Tauri
- CSS injected via JavaScript after the game loads
- A `<style>` tag added to the game's HTML

Look for existing CSS customizations or Tauri's webview CSS injection capabilities.

### Step 2: Create the CSS Override

```css
/*
 * Portrait Rendering Fix
 * Forces integer pixel scaling to prevent subpixel blur
 * Native portrait size is 40x40, so we use multiples of 40
 */

/* Target portrait elements - adjust selectors based on actual DOM structure */
.game-pokemon-portrait,
.pokemon-portrait,
[class*="portrait"] img,
.game-pokemon-portrait img {
  image-rendering: pixelated !important;
  image-rendering: crisp-edges !important;
  -webkit-image-rendering: pixelated !important;
}

/*
 * Force specific sizes based on UI context
 * These selectors may need adjustment based on actual class names
 */

/* Shop/bench portraits (bottom row) */
.nes-container .game-pokemon-portrait,
.my-container .game-pokemon-portrait {
  width: 80px !important;
  height: 80px !important;
  min-width: 80px !important;
  min-height: 80px !important;
}

/* If portraits use background-image instead of img tags */
[style*="portraits"] {
  image-rendering: pixelated !important;
  background-size: 80px 80px !important;
}

/* Alternative: Use 120px for larger displays */
@media (min-width: 2560px) {
  .game-pokemon-portrait,
  .pokemon-portrait {
    width: 120px !important;
    height: 120px !important;
  }
}
```

### Step 3: Identify Exact Selectors

Inspect the running game to find the exact CSS selectors for:
1. The shop portraits (bottom row where you buy Pokemon)
2. The bench portraits (your team's bench)
3. Any other portrait elements that look muddy

Use browser DevTools (F12 in the Tauri webview) to inspect elements.

The upstream code references these components:
- `app/public/src/pages/component/game/game-pokemon-portrait.tsx`
- Look for class names like `game-pokemon-portrait`, `my-container`, etc.

### Step 4: Test Different Sizes

Try these sizes and see which looks best at 1440p:
- `80px` (2x) - might be too small
- `120px` (3x) - good middle ground
- `160px` (4x) - largest, crispest

The key is that the size must be a **multiple of 40**.

### Step 5: Verify the Fix

After applying CSS:
1. Launch PACDeluxe at 1440p
2. Compare portrait crispness to battle sprites on the board
3. Check that portraits no longer look "muddy" or blurry
4. Verify at different window sizes if responsive behavior matters

## Files to Investigate in PACDeluxe

- Check for existing CSS override mechanisms
- Look at Tauri configuration for webview CSS injection
- Search for any existing style customizations
- Check `src/` directory for CSS or style-related files

## Fallback: JavaScript Injection

If CSS-only injection isn't available, inject via JavaScript:

```javascript
// Inject after game loads
const style = document.createElement('style');
style.textContent = `
  .game-pokemon-portrait {
    image-rendering: pixelated !important;
    width: 80px !important;
    height: 80px !important;
  }
`;
document.head.appendChild(style);
```

## Success Criteria

- Portraits in the shop/bench row appear as crisp as battle sprites
- No subpixel blur or "muddy" appearance
- Pixel edges are clean and defined
- Fix works consistently at 1440p resolution

## Next Steps (If CSS Fix Isn't Enough)

If the CSS fix improves things but you want even better quality:
1. Return to the `PACAssetupscaling` project
2. Generate 160x160 (4x) nearest-neighbor upscaled portraits
3. Configure PACDeluxe to load the upscaled assets instead of originals

But try the CSS fix first - it may fully solve the problem without needing asset changes.

## Context References

- Upstream PAC repo: `pokemonautochessdeluxe/upstream-game/`
- Portrait loading code: `app/public/src/game/components/loading-manager.ts`
- Portrait component: `app/public/src/pages/component/game/game-pokemon-portrait.tsx`
- Phaser config (for comparison): `app/public/src/game/game-container.ts` line 277
