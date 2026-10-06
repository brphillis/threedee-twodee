# The manifest

`build/<id>/sheets/manifest.json` describes one generated asset: its frames, pivot, palette, clips, sheets and every cell. It is td2d's own format and the source the other exports are made from. Its JSON Schema is `td2d schema manifest`, committed as `schemas/manifest.schema.json`.

## Fields

| Field | Meaning |
|---|---|
| `schemaVersion` | Manifest format version, currently `1.0.0`. |
| `generator` | `{ "name": "td2d", "version" }` that wrote it. |
| `assetId`, `assetHash` | The asset, and a hash of its resolved definition. |
| `generatedAt` | When it was written. |
| `frame` | Untrimmed sprite size in pixels. |
| `pivot` | The ground point under the model's origin, in frame pixels (`x`, `y`) and as fractions of the frame (`normalized`). The same in every frame and direction. |
| `pixelsPerUnit` | Pixels per metre used. |
| `camera` | Preset, pitch, yaw offset and the ground margin in pixels. |
| `directions` | Direction names and yaws in sheet order; `mirrorOf` names the source of mirrored directions. |
| `palette` | Palette mode and name, the colours sprites may use, and `byClip` for per-clip palettes. |
| `clips` | Name, fps, frame count, loop, motion and duration of each clip. |
| `sheets` | Each sheet: `name`, `image`, `data` (its Aseprite JSON, or null), `normals` (its normal map, when `render.normals` is on), `width`, `height` and `layout`. |
| `cells` | Every sprite: `key` (`clip/direction/nnn`), `clip`, `direction`, `index`, `sheet` (a sheet name), the rectangle `x`, `y`, `w`, `h` on that sheet, `trimmed`, `offset` and `mirrored`. |
| `files` | Files written for each export format, relative to the manifest. |
| `stages` | Hash of each stage's output, for provenance. |
| `validation` | Status, warning and error counts, and the path of `validation.json`. |

## Drawing a cell

`x`, `y`, `w` and `h` are the cell's pixels on its sheet, without any extruded border. `offset` is where the cell's top-left pixel sits inside the untrimmed frame: `0, 0` unless the cell is trimmed. To draw a frame with its pivot at screen point P (scaled by s), draw the cell at P + (offset - pivot) x s.

Mirrored cells (`mirrored: true`) are already flipped; draw them like any other.

## Compatibility

- **Additive changes** (a new optional field, a new export format in `files`, a new value of an enum that consumers can ignore) bump the minor version: 1.1.0.
- **Renames, removals or changed meanings** bump the major version, with a migration note in this file.
- Consumers should accept any 1.x manifest and ignore fields they do not know.

## History

| Version | Changes |
|---|---|
| 1.0.0 | First stable format: several sheets, trimmed cells with `offset`, cell `key`, clip `motion`, `files`. |
