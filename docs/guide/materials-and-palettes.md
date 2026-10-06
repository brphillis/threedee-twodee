# Materials and palettes

Each part names a material. A material says what colour the part is and how light falls on it; a palette says which colours the finished sprites may use.

## Materials

```json
{
  "materials": {
    "paint": { "color": "#4f7fd0", "shading": "toon", "bands": 3 },
    "trim": { "color": { "palette": "pico-8", "index": 9 }, "shading": "flat" },
    "glow": { "color": "#4f7fd0", "emissive": "#3a1a00" }
  }
}
```

| Field | Meaning |
|---|---|
| `color` | `#rrggbb`, or `{ "palette": <name>, "index": <n> }` to take a colour from a palette |
| `shading` | `toon` (banded, the default), `lambert` (smooth) or `flat` (unlit) |
| `bands` | Light bands for toon shading, 2 to 8. Default 3 |
| `ramp` | Two to eight colours, darkest first, to paint the toon bands with. See [Ramps](#ramps) |
| `hueShift` | Degrees to turn the hue of the darker bands, which makes a ramp from `color`. See [Ramps](#ramps) |
| `emissive` | A colour added regardless of light |
| `outline` | Whether `render.lines` may line this material. Default true. Turn it off for fine detail and dark gaps |
| `opacity` | Below 1 gives `W_OPACITY_THRESHOLDED`: sprites have binary alpha, so prefer dithering |

The same sphere with toon shading in 3 and 2 bands, lambert, flat, and toon with an emissive colour:

![Shading models](images/materials/shading.png)

Toon shading suits pixel art: each band becomes a flat area of one colour, so sprites keep few colours and read clearly at small sizes. Lambert gives smooth gradients, which the palette pass then quantises. Flat ignores lights entirely, for emblems and effects.

## Ramps

Toon shading paints each band with a darker or lighter version of `color`. Hand pixel art does not: an artist picks every shade, and shadows usually turn cooler and highlights warmer. A `ramp` gives a material its shades directly, darkest first, one per band:

```json
{
  "materials": {
    "skin": { "ramp": ["#5d275d", "#b13e53", "#ef7d57", "#ffcd75"] },
    "cloth": { "ramp": [{ "palette": "crate-8", "index": 1 }, { "palette": "crate-8", "index": 3 }] }
  }
}
```

The same sphere shaded from its colour in four bands, with `hueShift: 45`, and with the four-colour ramp above:

![Ramps](images/materials/ramps.png)

- The ramp's length is the number of bands, so `bands` is not needed. The darkest colour is the band lit by the ambient light alone, which is what a face turned away from the key light or in shadow gets; the lightest is the band in full light. A fill or rim light can lift a face one band.
- A material with a ramp needs no `color`. Where one colour stands for the material, in `render.lines` shades and in the viewer's model view, the middle of the ramp is used.
- Ramps need `toon` shading. A part's own `color` replaces the ramp for that part.
- Taking the ramp's colours from a palette, with `pixel.palette` set to the same palette, keeps every sprite inside it with nothing left for the palette pass to approximate. `examples/pixel` does this in `ramp/palette`.

`hueShift` makes a ramp from `color` without listing colours: each darker band keeps the brightness toon shading would give it and turns its hue towards blue-violet, the shadow band by the whole shift and the bands between by their share, so shadows go cool while the colour in full light stays as written. A negative shift turns towards yellow instead, for warm shadows. `td2d asset show <id>` prints the ramp it made. `examples/pixel` shows it on the crate scene in `ramp/hue-shift`.

```json
{ "materials": { "wood": { "color": "#b8743a", "bands": 3, "hueShift": 35 } } }
```

Put shared materials in the project's `defaults.materials`; an asset's own materials merge over them. A part can override its material's colour with `color` for one part only. `td2d validate` warns with `W_UNUSED_MATERIAL` about materials no part uses.

## Palettes

`pixel.palette` restricts every sprite to a palette:

```json
{ "pixel": { "palette": "fixed:endesga-32", "dither": "bayer-4", "ditherStrength": 0.35 } }
```

| Value | Meaning |
|---|---|
| `none` | No palette: keep the rendered colours (the default) |
| `fixed:<name>` | A built-in palette (`endesga-32`, `pico-8`, `db32`, `resurrect-64`, `aap-64`) or one in `palettes/` |
| `auto:<n>` | Build an `n`-colour palette (2 to 256) from the asset's own frames |

| `none` | `fixed:endesga-32` | `auto:16` | `auto:4` | `fixed:crate-8` |
|---|---|---|---|---|
| ![](images/pixel/palette-none.png) | ![](images/pixel/palette-endesga-32.png) | ![](images/pixel/palette-auto-16.png) | ![](images/pixel/palette-auto-4.png) | ![](images/pixel/palette-custom.png) |

Colours are matched in the Oklab colour space, which follows how different colours look rather than how far apart their RGB numbers are. With a fixed palette the `palette` check fails if any sprite uses a colour outside it, and `pixel.outline.snapToPalette` keeps outlines inside it too.

A project palette is a JSON file in `palettes/`:

```json
{
  "schemaVersion": "1.0.0",
  "name": "crate-8",
  "description": "A hand-picked eight-colour palette for the crates.",
  "colors": ["#3a2214", "#6e4422", "#a06232", "#d08c48", "#e8b070", "#9a7650", "#c49a68", "#c8924e"]
}
```

`examples/pixel` uses this one (`palette/custom`); `td2d schema palette` shows the format. The [pixel art guide](pixel-art.md) covers dithering, posterising, outlines and cleanup, which work together with the palette.

## Checking colours

```sh
td2d inspect props/crate --frame idle/s/000 --json   # colours of one sprite
td2d viewer                                           # metadata tab: every colour used, with counts
```

`acceptance.maxColors` in an asset makes validation fail when any sprite uses more colours than allowed.
