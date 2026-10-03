# Configuration and schemas

A td2d project is a directory with a `td2d.project.json`. Every setting an asset uses comes from one of five layers, and every file td2d reads has a JSON Schema.

## The project file

```json
{
  "$schema": ".td2d/schemas/project.schema.json",
  "schemaVersion": "1.0.0",
  "name": "my-game",
  "defaults": { "pixelsPerUnit": 16, "camera": "dimetric", "pixel": "retro-16" },
  "typeDefaults": { "character": { "frame": { "width": 32, "height": 48 }, "directions": "d8" } },
  "paths": { "presets": ["presets", "shared/presets"] },
  "cache": { "maxSize": "2GB" }
}
```

| Key | Meaning |
|---|---|
| `name` | Shown in the viewer and reports |
| `defaults` | Settings for every asset |
| `typeDefaults.<type>` | Settings for assets of one type: `prop`, `character`, `tile` or `effect` |
| `paths` | Where assets, build output, history, the cache, presets, palettes and components live. Each is relative to the project root |
| `cache.maxSize` | Largest the cache may grow before the least recently used entries are pruned |

## Layers

Later layers win:

1. Built-in defaults: 32 x 32 frames, 16 pixels per metre, the `dimetric` camera with an automatic ground margin, `studio-toon` lighting, four directions.
2. Built-in defaults for the asset's type. Characters get 32 x 48 frames and eight directions; tiles get 64 x 32.
3. The project's `defaults`.
4. The project's `typeDefaults.<type>`.
5. The asset.

Objects merge key by key and arrays replace. So `{ "camera": { "groundMargin": 4 } }` keeps the rest of the camera, while a `lights` array replaces the preset's lights. `td2d asset show <id>` prints an asset with every layer applied: that resolved form is exactly what generation uses.

## Presets

`camera`, `lighting`, `pixel`, `sheet`, `export` and `rig` take a preset name, or an object with an optional `preset` and overrides:

```json
{ "camera": { "preset": "isometric", "groundMargin": 4 }, "pixel": "pico-8" }
```

| Kind | Built-in presets |
|---|---|
| camera | `dimetric`, `isometric`, `three-quarter`, `top-down-45`, `side`, `top` |
| lighting | `studio-toon`, `studio-rim`, `world-sun`, `flat` |
| pixel | `default`, `outlined`, `retro-16`, `pico-8` |
| sheet | `grid`, `strips`, `packed` |
| export | `default`, `everything` |
| rig | `humanoid-basic`, `quadruped-basic`, `none` |

Add your own as `presets/<kind>/<name>.json`; `td2d schema <kind>-preset` shows the format and `td2d describe` lists everything available. A project preset with a built-in's name replaces it, with `W_PRESET_SHADOWS_BUILTIN`.

## Schemas

```sh
td2d schema --list                  # every document type
td2d schema asset > asset.schema.json
td2d schema --write .td2d/schemas   # refresh the copies editors use
```

`td2d init` writes every schema to `.td2d/schemas/`, and each file it creates points at its schema with `$schema`, so editors validate and complete as you type. The same schemas are committed in this repository under `schemas/`; the [schema reference](../reference/schemas.md) describes each one. Unknown keys are errors, so a typo is reported at its exact path instead of being ignored.

## Example: one setting, three layers

The starter crate uses the built-in `dimetric` camera. Setting `"typeDefaults": { "prop": { "camera": "side" } }` in the project file turns every prop to a side view, and `"camera": "dimetric"` in one asset turns that asset back. Check each step with:

```sh
td2d asset show props/crate --json | jq .data.asset.camera
td2d preview props/crate --layout ring
```

![The crate from four directions](images/getting-started/crate-ring.png)
