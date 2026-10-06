# Pixel settings example

One crate scene, generated once per pixel setting so the results can be compared side by side:
two honey-oak crates, a small one stacked square on a big one, with a coil of thick rope in front
and a tied burlap sack beside them.

- **Crates.** Square posts run up every corner and rails round the top and bottom of each side.
  Vertical planks sit recessed behind the frame with dark seams between them, a diagonal brace
  crosses each side, and the lid is a raised frame round recessed slats. Grain runs along every
  board, and dark nail heads fix the rails to the posts.
- **Rope.** Each turn of the coil is a dark core wrapped in angled beads, which read as twisted
  strands; the turns pile into a mound and the loose end trails forward.
- **Sack.** A broad burlap sack with a gathered, open mouth over a dark interior, tied at the neck
  with an orange cord whose ends hang down its front. Flecks of lighter and darker weave speckle
  the cloth, and folds pressed into it become creases under the shading.
- **Light.** A warm key light from the upper left, a cool fill from the right and a cool ambient
  light: tops are brightest, the lit side warm and the shadowed side cool but still readable.
- **Lines and outline.** The project turns `render.lines` on for every asset, in a dark shade of
  each part's own colour, so the crates, rope and sack are each lined where they stand in front
  of another, and draws a dark brown outline round the whole scene, snapped to the palette when
  there is one. `cleanup.orphans: "recolour"` gives stray single pixels their neighbours' colour.
  `lines/none` turns the lines off for comparison.
- **Shading.** Every material is toon-shaded, so each face is a few flat tones; the palette,
  dither and posterize settings then show how they treat tones that fall between palette colours.
  `ramp/*` paints the bands with chosen colours instead of shades of one: a `hueShift` that turns
  the shadows cool, and ramps picked straight from the project palette.
  The fine detail (grain, nails, rope strands, flecks, cord) is `"outline": false`, so the lines
  follow the structure and not every strand.

The scene is the `crates` component in `components/crates.json`. Every asset uses the same
160 x 160 frame and 90 pixels a metre, so the variants line up exactly.

| Asset group | What changes |
|---|---|
| `downscale/*` | `mode` (the default) against `box` |
| `palette/*` | no palette, Endesga 32, automatic 16 and 4 colours, and the project palette `palettes/crate-8.json` |
| `posterize/4` | four levels per colour channel |
| `dither/*` | the PICO-8 palette with no dither, and with Bayer dithers of different sizes and strengths |
| `outline/*` | outside rings with 8 and 4 connectivity, an inside outline, and an outline snapped to the palette |
| `lines/*` | no render lines, lines in one dark colour, and lines in a shade of each part's colour |
| `preset/*` | the built-in `retro-16` and `pico-8` presets |
| `ramp/*` | `hueShift` ramps made from each material's colour, and ramps of palette colours with the palette fixed |

```sh
td2d generate            # every asset
td2d process palette/auto-16 --json   # after editing pixel settings: reuses the renders
td2d preview dither/bayer-4-35 --scale 6
```

`expected/` holds the committed outputs; the test suite regenerates the project and compares
them byte for byte. The guide `docs/guide/pixel-art.md` explains every setting.
