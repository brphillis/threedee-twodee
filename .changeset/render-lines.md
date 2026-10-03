---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/render-harness": minor
---

`render.lines` draws lines in screen space after rendering: along every step in depth and every boundary between two lined materials, always on the nearer side, so an arm across the chest, one leg in front of the other or a brace lying on planks is lined and nothing is painted over the part in front. Steps are found from how the depth bends, so tilted flat surfaces are never lined. Lines are one `#rrggbb` colour or a darker `shade` of each part's own colour, `width` final pixels wide, with a `depth` for the smallest step lined; materials with `outline: false` get none and start none (the `outline` field always meant this; its description is corrected). The `mode` downscale keeps them crisp: a block at least half covered by line becomes a line pixel. `examples/pixel` shows no lines, dark lines and shaded lines, and the knight, the fighter and the crate scene use them.
