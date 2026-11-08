# Paper turn fold presets

The miniapp page turn is an approximate, precomputed paper fold rather than a real-time 3D solver. `scripts/generate-paper-fold.mjs` computes a fixed flat quadrilateral, projects the four original sheet corners with the exact fold transform, and derives a slightly expanded shadow quadrilateral. Coordinates may be negative or extend beyond 100%; the viewport and nested fold-region masks make only the visible unit-square portion render.

The separation of the flat sheet, folded sheet and underlying page was informed by [StPageFlip's geometry interface](https://nodlik.github.io/StPageFlip/docs/classes/flipcalculation.html) and [rendering flow](https://github.com/Nodlik/StPageFlip/blob/master/src/Flip/Flip.ts). No library code or dependency is included. This implementation uses its own single-crease orthographic approximation; it does not simulate flexible-paper curvature or claim measured device frame rates.

The canonical table is version 2 with 41 progress steps and 13 tilt steps (533 frames). Each frame has exactly four vertices per polygon. Vertices are signed and quantized to 0.1% without clamping, so stable vertex correspondence is preserved and runtime interpolation stays bilinear. Runtime `src/gestures/paper-fold.ts` clamps touch input, looks up four adjacent frames, interpolates their fixed arrays, and transposes coordinates for vertical turns. It performs no clipping, trigonometry, or 3D math; completion and recoil replay interpolated table positions, and reduced motion skips the flap.

`src/gestures/paper-fold-frames.json` is 71,590 bytes (69.9 KiB), or 20,706 bytes gzip-compressed. This is a visual approximation of a broad folded sheet, not a measured performance result; no FPS claim is made here.

Regenerate deterministically with:

```sh
pnpm --dir apps/bubu-log-miniapp generate:paper-fold
```

The folded backside prints the active baby avatar used by the menu. A persistent hidden image preloads that URL before it is used; while loading, when absent, or after an error, the existing bundled brand icon is shown. URL-scoped load/error state keeps late callbacks from applying to a different requested avatar. The image is mapped from its full-sheet rectangle onto the precomputed backside corners with a 2D affine matrix, using separate horizontal/vertical corner order to avoid mirrored portraits. Only the folded image is transformed; the calendar and adjacent page remain stationary. No additional geometry table or runtime 3D calculation is introduced.

Horizontal and vertical gestures share one axis-local motion convention: cross displacement keeps the same sign after transposition, and the viewport aspect ratio adjusts the normalized table tilt. A top pull unfolds the previous sheet downward from its top edge; a bottom pull peels the current sheet upward from its bottom edge. Both retain stationary calendar text and the same completion/recoil rules. The backside prints a repeated grid of 50vw-square avatar tiles, clipped to the original sheet rectangle before projection, instead of one enlarged central portrait. Each native Image node reuses the preloaded source and fallback; the whole grid shares a single affine transform.
