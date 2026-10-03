---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
---

Phase 5 pixel-art processing: fixed palettes (`pico-8`, `endesga-32`, `db32`, `aap-64`, `resurrect-64` and project palettes) and automatic `auto:<n>` palettes per asset or per clip, mapped in Oklab; ordered Bayer dithering; posterize; outside and inside outlines that can snap to the palette; stray-pixel cleanup; a configurable pass order; and indexed PNG sheets. The default downscale is now `mode`, which keeps only rendered colours, and half-covered pixels follow the GPU top-left rule so moving shapes keep their size. New sprite checks: `palette`, `jitter`, `bounds-drift` and `isolated-pixels`, with `acceptance.maxJitter`, `maxBoundsDrift` and `maxOrphans` and clip `motion`. New `td2d process` command, a centroid in `inspect --frame`, `retro-16` and `pico-8` presets, and the `W_PALETTE_PER_CLIP` warning.
