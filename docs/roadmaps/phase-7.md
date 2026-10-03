# Phase 7 notes: sprite sheets, export formats and metadata

Status: complete locally on 2026-10-02.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| The knight's Aseprite JSON loads in the Phaser example page and plays `walk_s`, with the frame changing | browser test `packages/cli/e2e/engines.test.ts`: Phaser 4.2.1 loads the sheet with `load.aseprite`, creates the animations with `createFromAseprite` and plays `walk_s`; the test sees at least three different frames, all walk_s frames, from the grid sheet and from the trimmed, packed one |
| The PixiJS spritesheet loads in the Pixi example page | the same test: PixiJS 8.22.0 loads `<sheet>.pixi.json` with `Assets.load` and plays `walk_s` with `AnimatedSprite`, from both sheets |
| A packed layout with trim keeps pivots correct: trimmed cells put back at their offsets reproduce the untrimmed cells exactly | unit test "trims to the opaque pixels and records offsets that rebuild every frame exactly"; the Phaser multi-atlas test also checks that Phaser reads the pivot from every frame |
| Sheets over `maxSize` split into numbered sheets with consistent manifest references | unit tests for grid and packed splitting (`hero-0`, `hero-1`, sequences never split); exporters list every sheet; the e2e test checks a split by clip end to end |
| The Godot `.tres` output matches the committed golden, and the manual import check is documented | unit test against `packages/core/test/fixtures/golden/godot/hero.tres`; `scripts/godot/check.sh` loads the export in Godot 4.7.2 (see Q14) and `docs/reference/export-formats.md` documents the import steps |

## Q14: the Godot SpriteFrames text format

Godot 4 writes text resources with `format=3`. From 4.6 it no longer writes `load_steps`, and files with and without it load in both directions (Godot's upgrade notes for 4.6). td2d writes the 4.6 form: a header without `load_steps`, one `ext_resource` per sheet, one `AtlasTexture` `sub_resource` per cell (with `margin` for trimmed cells), and a `[resource]` whose `animations` array holds a dictionary per clip and direction with `frames`, `loop`, `name` (a StringName) and `speed`.

Verified with Godot itself: `scripts/godot/check.sh` downloads Godot 4.7.2 for Linux, imports the packed knight's sheet into a throwaway project and loads `knight-packed.tres` with Godot's loader. Run in the Playwright Linux image on arm64, it reports 24 animations; for example `walk_s` has 8 frames at speed 10 with loop on, and `attack_n` has 6 frames with loop off. Every first frame's AtlasTexture reports a size of 32 x 48 from its trimmed region and margin. The check needs a download, so it is a script rather than a CI test; the text golden guards the format in CI.

## Decisions

- **Index frame names in Aseprite JSON by default.** Phaser's `createFromAseprite` looks frames up by their index as a string (it requires Aseprite's `{frame}` item filename), so descriptive names broke it. `export.aseprite.frameNames: "descriptive"` keeps the old names for other tools.
- **Sequences never split across sheets.** maxrects-packer's tag grouping still split a sequence over two bins in testing, so td2d adds whole sequences to a sheet while they still pack into one bin and starts a new sheet otherwise. Grids break between sequences.
- **Multi-sheet support in every format**: one Aseprite and one PixiJS file per sheet (PixiJS with `related_multi_packs`), one Phaser multi-atlas and one Godot resource for all sheets. The manifest's `files` lists everything written.
- **Pivots travel with the frames**: the PixiJS and Phaser `anchor` and the Aseprite pivot slice carry it. The Phaser test reads it back from a running Phaser.
- **An in-house GIF encoder** (GIF89a, LZW with table reset, looping, transparent index, disposal 2) for `gif-preview`, so the optional format adds no dependency. A test decodes its output with libvips and checks the table-reset path.
- **Manifest 1.0.0** adds `key`, `offset` and `trimmed` to cells, `motion` to clips, `files`, and several sheets with a layout name, and documents the compatibility policy in `docs/reference/manifest.md`.
- **Every exported JSON is checked against its schema as it is written**, and the tests check the files again with ajv against the committed JSON Schemas (`aseprite-sheet`, `aseprite-sheet-array`, `pixi-sheet`, `phaser-atlas`, `manifest`).
- **Validation gained `cells-in-bounds` and `frame-count`**, and `sheet-size` covers every sheet.
- **The knight moved into a component** so `knight-packed` (packed layout, every export format) shares its model. Example tests now compare every exported file, not only the first sheet.
- **Scripts are type-checked.** A new `tsconfig.scripts.json` covers `scripts/`, the example SDK scripts and `examples/engines`.
- **Stage versions**: sheet 2, validate 4, export 3; exporter versions are part of the export stage key.

## Deviations

- The roadmap sketched `sheet/grid.ts`, `sheet/pack.ts` and `sheet/extrude.ts`; one module, `sheet/layout.ts`, holds the layouts, trimming and extrusion, which share placement code.
- `meta.app` in Aseprite, PixiJS and Phaser data is `td2d`. The roadmap asked for the tool name and URL; there is no public URL yet, and Phase 11's release will add it.
- `rig` stage keys include the asset id (for its warnings), so two different rigged assets do not share renders even when their geometry is identical. `knight-packed` therefore renders its own frames.

## Measurements

| Measurement | Value |
|---|---|
| Knight, 192 frames of 32 x 48: grid sheet | 320 x 1152 (368,640 px) |
| Knight packed with trim, padding 1, extrude 1, power of two | 512 x 256 (131,072 px), 67% of it cells |
| Packing those 192 frames | 8 ms |
| Tests | 459 across unit, render, harness and e2e projects, plus 7 experiments |

## Examples

`examples/characters/assets/characters/knight-packed` uses the `packed` sheet preset and the `everything` export preset; its expected outputs include every format but the individual frames, which are counted. `examples/engines/` has the Phaser and PixiJS pages, an index and `serve.ts`.

## Linux

The render, pipeline and example suites (53 tests) pass in the Playwright Linux image on arm64 and on x86_64 under emulation. Every exported file of every example, including the packed knight's Aseprite, PixiJS, Phaser and Godot data and its GIF previews, regenerates byte for byte against the outputs recorded on macOS.
