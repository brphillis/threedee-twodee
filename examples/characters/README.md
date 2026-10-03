# Character example

`characters/knight` is a rigged, animated character on the built-in `humanoid-basic` rig (VRM
bone names): a crowned knight with a plumed great helm, layered pauldrons and plate armour trimmed
in gold, a royal blue surcoat bearing a gold cross pattee, a folded red cape with a gold hem, a
longsword and a curved heraldic shield. The body is the `knight` component in
`components/knight.json`. Every part rides one bone with its `bone` field; the left limbs are
mirrored with `"mirror": "x"`, which also moves their bones to the right side.

The detail comes from the part types working together:

- CSG cuts the helm's eye slit and the surcoat's riding slits. Cut faces take the cutter's
  material, so the slits come out dark and gold-edged.
- The shield's rim, field and cross are each an extruded outline intersected with a large
  cylinder, which curves the face; the cylinder that hollows the back is leather.
- The cape is eight hull panels whose hems zig-zag, so the light picks out its folds, with a
  darker lining just inside and a gold hem below.

The project adds four bones to the humanoid rig: `cape-1`, `cape-2` and `cape-3` in a chain down
the back, each on the seam above one row of cape panels, and `plume` on the helm. Every clip
layers `sway` generators over its main motion to move them, so the cape bends row by row as a
wave travels down it.

| Clip | Made by | Layers | Frames |
|---|---|---|---|
| `idle` | the `idle-breathe` generator | the cape stirs in the wind, swaying back and to the side; the plume flutters | 10 |
| `walk` | the `walk-cycle` generator, with `bob` set so a foot stays on the ground | the cape streams back and ripples twice a cycle, once per step | 8 |
| `attack` | four pose keys with easing, played once | the cape flares with the cut | 6 |

The project sets `typeDefaults.character` (a 96 x 96 frame, the rig, eight directions, a key
light with a cool rim light from behind, the project palette and a dark outline snapped into it),
so the asset only adds what is specific to the knight. `render.lines` draws a line around
every part in a dark shade of its own colour, so pauldrons, shield and limbs separate as in a
drawing, and the seams between the cape's panels read as fold lines. Its `depth` is only 8 mm,
because the knight is built from thin layers: gold trim, cape panels and lining. A deeper reach
would line those all over and darken them. `palettes/heraldry.json` holds
hue-shifted ramps of four to six colours for steel, gold, blue, crimson and leather. The material
colours and toon bands are chosen so that each band snaps to the next step of its ramp, which
gives every surface real shading instead of one flat colour.

```sh
td2d generate characters/knight
td2d preview characters/knight --clip walk --scale 4
td2d model inspect characters/knight --clip walk --keys --json   # the generated keys, layers included
td2d rig show characters/knight                                  # bones and attached parts
```

`expected/` holds the committed outputs; the test suite regenerates them byte for byte.
`docs/guide/rigging-and-animation.md` explains rigs, clips and generators.
