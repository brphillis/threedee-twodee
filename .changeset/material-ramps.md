---
"@td2d/schema": minor
"@td2d/core": minor
"@td2d/cli": minor
"@td2d/viewer": minor
"@td2d/render-harness": minor
---

Materials take a `ramp`: two to eight colours, darkest first, each a `#rrggbb` or a palette reference, and toon shading paints each light band with one of them instead of a shade of `color`, so shadows and highlights can change hue the way hand-painted pixel art does and a sprite can be built from palette colours directly. `hueShift` makes a ramp from `color` by turning each darker band's hue towards blue-violet (or towards yellow when negative), the shadow band by the whole amount. A material with a ramp needs no `color`; the middle of the ramp stands in for lines and the viewer. `td2d asset show` lists the resolved ramp, the viewer shows it as swatches, and `examples/pixel` has a `ramp/hue-shift` and a `ramp/palette` asset.
