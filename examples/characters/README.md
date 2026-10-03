# Character example

`characters/knight` is a rigged, animated character on the built-in `humanoid-basic` rig (VRM
bone names). Every part rides one bone with its `bone` field; the left limbs are mirrored with
`"mirror": "x"`, which also moves their bones to the right side.

| Clip | Made by | Frames |
|---|---|---|
| `idle` | the `idle-breathe` generator | 10 |
| `walk` | the `walk-cycle` generator, with `bob` set so a foot stays on the ground | 8 |
| `attack` | four pose keys with easing, played once | 6 |

The project sets `typeDefaults.character` (frame, rig and eight directions), so the asset only
adds what is specific to the knight.

```sh
td2d generate characters/knight
td2d preview characters/knight --clip walk --scale 4
td2d model inspect characters/knight --clip walk --keys --json   # the generated keys
td2d rig show characters/knight                                  # bones and attached parts
```

`expected/` holds the committed outputs; the test suite regenerates them byte for byte.
`docs/guide/rigging-and-animation.md` explains rigs, clips and generators.
