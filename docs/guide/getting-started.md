# Getting started

This guide walks from an empty directory to a validated sprite sheet.

## Install

td2d needs Node.js 24 or newer. From a clone of this repository:

```sh
pnpm install
pnpm build
alias td2d="node $PWD/packages/cli/dist/main.js"
```

## Create a project

```sh
td2d init my-sprites
cd my-sprites
td2d doctor --fix
```

`init` copies the `starter` template and never overwrites files. It creates:

| Path | Purpose |
|---|---|
| `td2d.project.json` | Project name and defaults applied to every asset |
| `assets/props/crate/asset.json` | An example asset |
| `.td2d/schemas/` | JSON Schemas that editors use through each file's `$schema` |
| `.gitignore` | Ignores generated output |

`doctor --fix` installs the headless Chromium build td2d renders with. On Linux it may also need system libraries: `npx playwright install-deps chromium`.

## Look at an asset

```sh
td2d asset list
td2d asset show props/crate
```

`asset show` prints the asset after every default and preset is applied. That resolved form is exactly what generation will use, so it is the best way to check what a setting does.

## Create and edit an asset

```sh
td2d asset create props/barrel --template cylinder
```

Templates: `box`, `cylinder`, `sphere` and `character-blockout`. Open `assets/props/barrel/asset.json`, change the parts or materials, then validate:

```sh
td2d validate props/barrel
```

A mistake is reported with its file and path:

```text
error [E_ASSET_INVALID] assets/props/barrel/asset.json failed validation.
  assets/props/barrel/asset.json model.parts[0].radius: Too small: expected number to be >0
hint Run `td2d schema asset` to see the schema.
```

## Generate the sheet

```sh
td2d generate props/crate
td2d preview props/crate
td2d viewer --open
```

![The starter crate from four directions](images/getting-started/crate-preview.png)

Models are built from parts; [Building models](models.md) covers every part type, CSG, components, imports and the TypeScript SDK.

`generate` writes `build/props/crate/sheets/crate.png` (32 x 128: one 32 x 32 cell for each of the four directions), `crate.json` in Aseprite's format, and `manifest.json`. `preview` writes an enlarged copy with cell borders. `viewer` serves a web page for browsing every generated asset. Run `generate` again after editing the asset; only the stages your change affects rerun. [Generating sprites](generating.md) covers stages, caching, validation and outputs.

## Defaults and presets

Settings are layered in this order, later layers winning:

1. Built-in defaults (32 x 32 frames, 16 pixels per metre, `dimetric` camera with an automatic ground margin, `studio-toon` lighting, four directions).
2. Built-in defaults for the asset type. Characters use 32 x 48 frames and eight directions; tiles use 64 x 32 frames.
3. `defaults` in `td2d.project.json`.
4. `typeDefaults.<type>` in `td2d.project.json`.
5. The asset itself.

`camera`, `lighting`, `pixel`, `sheet` and `export` accept a preset name, or an object with an optional `preset` plus overrides:

```json
{ "camera": { "preset": "isometric", "groundMargin": 4 } }
```

Objects merge and arrays replace, so a `lights` array replaces the preset's lights. `td2d describe` lists every preset. Add project presets as `presets/<kind>/<name>.json`; `td2d schema camera-preset` shows the format.

## Palettes

Built-in palettes are `endesga-32`, `pico-8`, `db32`, `resurrect-64` and `aap-64`, taken from Lospec. A material can pick a colour by index:

```json
{ "color": { "palette": "pico-8", "index": 8 } }
```

Add project palettes as `palettes/<name>.json`.

## Machine-readable output

Add `--json` to any command for one JSON envelope on stdout. [AGENTS.md](../../AGENTS.md) describes the envelope, and the [error reference](../reference/errors.md) lists every error code and exit code.
