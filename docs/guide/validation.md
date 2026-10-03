# Validation

td2d checks your work at three points: definitions before anything is built, the model before it is rendered, and the sprites after. Problems in definitions stop the run; problems in sprites are written to `validation.json` and, when a check fails, make the command exit 5 with the outputs still written so you can look at them.

## Definitions and models

```sh
td2d validate                     # every definition: schemas, references, presets, palettes
td2d validate props/crate --stage model --json   # also build the geometry, without rendering
```

Definition errors carry the file and the path of each problem, such as `model.parts[1].size`. The model stage adds geometry warnings: `W_MODEL_OUT_OF_FRAME`, `W_MODEL_BELOW_GROUND`, `W_OPEN_MESH`, `W_TRIANGLE_BUDGET` and `W_DEGENERATE_TRIANGLES`.

## Sprite checks

`td2d generate` runs these on every sprite and sheet:

| Check | Fails or warns when |
|---|---|
| `sprite-size` | A sprite is not the frame size (fail) |
| `binary-alpha` | A pixel is partly transparent (fail) |
| `not-blank` | A sprite is under 0.5 % opaque (fail) |
| `inside-frame` | A sprite touches the frame edge, so it is probably cut off (warn) |
| `grounded` | A sprite floats above the ground line at the pivot (warn) |
| `coverage` | A sprite is outside `acceptance.minAlphaCoverage` to `maxAlphaCoverage` (fail) |
| `max-colors` | A sprite uses more than `acceptance.maxColors` colours (fail) |
| `palette` | With a fixed palette, a sprite uses a colour outside it (fail) |
| `jitter` | A frame's centre jumps more than 2 px from the previous frame (warn), or more than `acceptance.maxJitter` (fail). Clips with `"motion": true` are skipped |
| `bounds-drift` | A frame's size strays more than `acceptance.maxBoundsDrift` from its clip's median (fail) |
| `isolated-pixels` | A sprite has single pixels with no opaque neighbour (warn), or more than `acceptance.maxOrphans` (fail) |
| `cleanup` | Information: how many stray pixels the cleanup pass removed or recoloured |
| `sheet-size` | A sheet is not the size its layout should give (fail) |
| `cells-in-bounds` | A cell reaches outside its sheet (fail) |
| `frame-count` | A planned frame is missing from the sheets or appears twice (fail) |

## Acceptance blocks

An asset can tighten the checks with its own `acceptance` block:

```json
{
  "acceptance": {
    "maxColors": 16,
    "minAlphaCoverage": 0.15,
    "maxJitter": 1,
    "maxBoundsDrift": 2,
    "maxOrphans": 0,
    "requiredClips": ["idle", "walk"]
  }
}
```

`requiredClips` is checked with the definition, before anything renders. The rest are checked on the sprites. An agent iterating on an asset loops until these pass.

## Example: a sprite that does not fit

A crate at 26 pixels per metre in a 32 x 32 frame touches every edge:

![A crate cut off by its frame](images/validation/clipped.png)

```sh
td2d generate props/crate --json   # validation.status "warn": inside-frame names the frame
```

The fix is in the check's hint: lower `pixelsPerUnit`, set it to `"auto"`, or enlarge the frame.

## Warnings and --strict

Warnings never change the exit code on their own. `--strict` makes validation warnings fail the run with exit 5, which suits CI: `td2d batch --strict` or `td2d generate --strict`. Every warning and error code is in the [error reference](../reference/errors.md), and `td2d explain <code>` prints its entry.
