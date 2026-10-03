# Reading generated metadata

Every generation writes JSON next to its images. Agents read these instead of guessing from pictures; people see the same information in the viewer's metadata tab.

```text
build/<id>/
  sheets/manifest.json   what was generated: frames, pivot, palette, clips, sheets, cells, files
  validation.json        every check, with the frames it names
  generation.json        how it was generated: stage hashes and timings, renderer, warnings
  resolved.json          the asset after defaults and presets: the exact settings used
build/batch-report.json  the last td2d batch run
```

## manifest.json

The manifest is td2d's own description of an asset's output, and the one file an engine integration needs besides the sheet images.

```sh
cd examples/characters
td2d generate characters/knight
td2d inspect characters/knight --cells --json      # the manifest's cells, with a summary
```

| Field | Use it for |
|---|---|
| `frame`, `pixelsPerUnit` | The size of every sprite, and the scale it was drawn at |
| `pivot` | Where the model stands: `x`, `y` in frame pixels and `normalized` from 0 to 1. Set your sprite's origin or anchor to it |
| `directions` | Each direction's name and yaw, and which were mirrored from another |
| `clips` | Each clip's frames, fps, duration, and whether it loops or moves across the frame |
| `palette` | The palette mode and every colour sprites may use |
| `sheets` | Each sheet image, its size and layout |
| `cells` | Every sprite: its key (`walk/s/000`), sheet, rectangle, trim offset and whether it was mirrored |
| `files` | What each export format wrote |
| `stages` | The hash of every stage, to tell two generations apart |
| `validation` | The status and counts; the details are in `validation.json` |

Read cells from the manifest, never by guessing positions: packed sheets put them anywhere.

![The knight's grid sheet with cell borders](images/sheets/knight-grid.png)

The [manifest reference](../reference/manifest.md) describes every field, and `td2d schema manifest` prints its schema.

## validation.json

```json
{ "status": "warn", "checks": [
  { "id": "jitter", "status": "warn", "message": "2 frame(s) jump more than 2 px from the previous frame.", "frames": ["walk/e/003", "walk/w/003"] }
] }
```

Each check has an `id`, a `status` of `pass`, `warn` or `fail`, a message and, when it is about particular sprites, their keys in `frames`. The [validation guide](validation.md) lists every check.

## generation.json

What makes a generation reproducible: the asset hash, the backend and renderer string, every stage with its hash, whether it came from the cache and how long it took, every output file with its SHA-256, and any warnings. `td2d inspect <id>` summarises it, and two generations with the same stage hashes have identical outputs.

## The batch report

`td2d batch` writes `build/batch-report.json`: the options used, overall status (`ok`, `warn`, `partial`, `failed` or `cancelled`), cache and item counts, and each asset's status, error, warnings and whether it was skipped. `td2d batch --resume build/batch-report.json` reruns only what did not succeed. The [batch report reference](../reference/batch-report.md) has the details.

## History

When a generation changes the outputs, td2d copies `sheets/`, `validation.json` and `generation.json` into `history/<id>/<time>-<hash>/`, and the result's `history` field names the new entry. It is null when the outputs did not change, since nothing new needed recording. `td2d history list|show|prune` and `td2d compare` read them, and the viewer's history and compare tabs show them.
