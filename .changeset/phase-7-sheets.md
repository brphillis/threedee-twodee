---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/viewer": patch
---

Phase 7 sprite sheets and export formats: `grid`, `strips` and `packed` (maxrects) layouts with row or column flow, per-clip or per-direction sheets, trimming with recorded offsets, padding, extrusion, power-of-two sizes and splitting into numbered sheets. New exporters `pixi`, `phaser-atlas` (multi-atlas with animation configs), `godot-spriteframes` (Godot 4 `.tres`) and `gif-preview`, and an Aseprite `array` variant; Aseprite frames are now named by index (`{frame}`), which Phaser's `createFromAseprite` needs. Manifest 1.0.0 lists every sheet, trimmed cells with `offset`, and the files of each format. New checks `cells-in-bounds` and `frame-count`; new commands `td2d sheet`, `td2d export --format`, `td2d inspect --cells` and `td2d preview --sheet`. The unused `W_SPECULATIVE_SETTING` warning is removed.
