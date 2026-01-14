# Portrait Rendering Fix - Crisp Pixel Art

## Problem

Pokemon portraits in the shop/bench appear "muddy" and blurred compared to battle sprites, which look crisp. This is especially noticeable on 1440p and 4K displays.

## Root Cause

The issue is **NOT** the source assets (40x40 PMD sprites are intentional). The problem is the **rendering pipeline**:

| Element | Rendering Method | Result |
|---------|------------------|--------|
| Battle sprites | Phaser canvas with `pixelArt: true` | **Crisp** - integer scaling, nearest-neighbor |
| Portraits | DOM `<img>` elements with CSS `width: 7.5vw` | **Blurry** - viewport units cause subpixel rendering |

When `7.5vw` resolves to something like `108.75px` on a 1450px viewport, the browser interpolates the 40px source image across fractional pixels, causing blur.

## The Fix

**Goal:** Make portraits render with integer pixel sizes and nearest-neighbor interpolation.

### Step 1: Find Portrait CSS

Search the upstream codebase for portrait/avatar styling:

```bash
# Look for viewport-based sizing on portraits
grep -r "vw\|vh" upstream-game/app/public/src/ --include="*.css" --include="*.scss"
grep -r "portrait\|avatar" upstream-game/app/public/src/ --include="*.css" --include="*.scss"
```

Key files likely involved:
- Shop component styles
- Player bench/board styles
- Any component rendering the small Pokemon portraits

### Step 2: Apply CSS Fix

Replace viewport-relative sizing with integer pixel multiples of 40:

```css
/* BEFORE (causes blur) */
.pokemon-portrait {
  width: 7.5vw;
  height: 7.5vw;
}

/* AFTER (crisp pixels) */
.pokemon-portrait {
  width: 80px;   /* or 120px, 160px - must be multiple of 40 */
  height: 80px;
  image-rendering: pixelated;
  image-rendering: crisp-edges; /* Firefox fallback */
}
```

### Step 3: Responsive Scaling (if needed)

If portraits need to scale with window size, use CSS that snaps to integer multiples:

```css
.pokemon-portrait {
  /* Base size: 2x scale (80px) */
  width: 80px;
  height: 80px;
  image-rendering: pixelated;
}

/* Larger displays: 3x scale (120px) */
@media (min-width: 1920px) {
  .pokemon-portrait {
    width: 120px;
    height: 120px;
  }
}

/* 4K displays: 4x scale (160px) */
@media (min-width: 2560px) {
  .pokemon-portrait {
    width: 160px;
    height: 160px;
  }
}
```

### Step 4: Alternative - JavaScript Snap

If CSS media queries aren't sufficient, calculate the nearest integer multiple dynamically:

```javascript
function getPortraitSize(viewportWidth) {
  const baseSize = 40;
  // Target roughly 7.5vw but snap to integer multiple of 40
  const targetSize = viewportWidth * 0.075;
  const scale = Math.max(2, Math.round(targetSize / baseSize));
  return baseSize * scale;
}

// Apply on resize
function updatePortraitSizes() {
  const size = getPortraitSize(window.innerWidth);
  document.documentElement.style.setProperty('--portrait-size', `${size}px`);
}

window.addEventListener('resize', updatePortraitSizes);
updatePortraitSizes();
```

Then in CSS:
```css
.pokemon-portrait {
  width: var(--portrait-size, 80px);
  height: var(--portrait-size, 80px);
  image-rendering: pixelated;
}
```

## Implementation Location

This fix should be applied via **CSS injection** in PACDeluxe's build process, NOT by modifying upstream-game source files. This keeps the upstream pristine and makes the fix a PACDeluxe enhancement.

**Recommended approach:** Add to `scripts/build-frontend.js` to inject a CSS override file after the upstream build completes.

Example injection in build script:
```javascript
// After upstream build completes
const portraitFixCSS = `
/* PACDeluxe Portrait Fix - Crisp Pixel Art */
[class*="portrait"], [class*="avatar"] {
  image-rendering: pixelated !important;
  image-rendering: crisp-edges !important;
}
`;

// Append to main CSS or inject as separate stylesheet
```

## Verification

After implementing:
1. Launch PACDeluxe at different window sizes (1080p, 1440p, 4K)
2. Compare portrait crispness to battle sprites - they should match
3. Verify portraits don't blur when resizing window
4. Check that shop, bench, and player info portraits all look crisp
5. Ensure no layout breaks from fixed pixel sizes

## Reference Screenshots

Screenshots showing the problem are located at:
- `C:\Users\mtoli\Documents\Code\PACAssetupscaling\Screenshot 2026-01-07 220043.png`
- `C:\Users\mtoli\Documents\Code\PACAssetupscaling\useraddition.png`

## Why Not Upscale the Assets?

We explored AI upscaling (Real-ESRGAN) but it doesn't work well for pixel art:
- AI upscalers are designed to **add detail and smooth edges**
- Pixel art needs **sharp edges and integer scaling**
- The 40x40 PMD sprites are intentionally that resolution
- The real fix is displaying them correctly, not modifying them

## Technical Background

The upstream Pokemon Auto Chess uses:
- **Phaser 3** for battle rendering (canvas-based, `pixelArt: true` config)
- **React DOM** for UI elements including portraits (HTML img elements)

Phaser automatically handles pixel-perfect scaling. DOM images need explicit CSS to achieve the same result.
