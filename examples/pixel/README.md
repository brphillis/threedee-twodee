# Pixel settings example

One toadstool scene, generated once per pixel setting so the results can be compared side by
side: a fly agaric on a mossy mound with two smaller ones beside it. The caps have a bell shape
with a lip, cream gills showing under the rim and white warts set into them on a golden-angle
spiral; the stems have a hanging skirt and a bulbous base; grass tufts and pebbles dot the moss.
The caps and stems use lambert shading, which renders smooth gradients and so shows what the
palette, dither and posterize settings do; the warts, gills and moss are toon. Every asset uses
the same 64 x 64 frame and 44 pixels a metre, so the variants line up exactly.

| Asset group | What changes |
|---|---|
| `downscale/*` | `mode` (the default) against `box` |
| `palette/*` | no palette, Endesga 32, automatic 16 and 4 colours, and the project palette `palettes/toadstool-7.json` |
| `posterize/4` | four levels per colour channel |
| `dither/*` | the PICO-8 palette with no dither, and with Bayer dithers of different sizes and strengths |
| `outline/*` | outside rings with 8 and 4 connectivity, an inside outline, and an outline snapped to the palette |
| `preset/*` | the built-in `retro-16` and `pico-8` presets |

```sh
td2d generate            # every asset
td2d process palette/auto-16 --json   # after editing pixel settings: reuses the renders
td2d preview dither/bayer-4-35 --scale 6
```

`expected/` holds the committed outputs; the test suite regenerates the project and compares
them byte for byte. The guide `docs/guide/pixel-art.md` explains every setting.
