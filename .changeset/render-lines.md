---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/render-harness": minor
---

`render.lines` draws a line around every part, inside the silhouette as well as around it, wherever a part stands in front of something further back: an arm across the chest, one leg in front of the other. Lines are one `#rrggbb` colour or a darker `shade` of each part's own colour, `width` final pixels wide, with a `depth` that sets how far in front a part must be to be lined; materials with `outline: false` get none. The `mode` downscale keeps them crisp: a block at least half covered by line becomes a line pixel. `examples/pixel` shows both colourings, and the knight and the fighter use them; the fighter, with two toon bands per material and stray-pixel recolouring, reads as drawn rather than rendered.
