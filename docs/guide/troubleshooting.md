# Troubleshooting

Every failure reports a code, a message, a hint and a docs link; with `--json` they are in the envelope's `error`. Start with the hint. `td2d explain <code>` prints the full entry for any error or warning, and the [error reference](../reference/errors.md) lists them all. This page groups the codes by what went wrong and covers the problems that come up most.

```sh
td2d doctor                      # what this machine is missing
td2d explain E_ASSET_INVALID     # what an error means and how to fix it
td2d generate <id> --log-level debug   # stage inputs, cache keys and browser console output
```

## Environment and installation

`td2d doctor` checks everything in this section and its `--fix` installs the browser. Run it first on a new machine or after upgrading Node.js or td2d.

- **The browser is missing** (`E_BROWSER_MISSING`): run `td2d doctor --fix`. On Linux also run `npx playwright install-deps chromium` for the system libraries.
- **The browser will not start, or has no WebGL2** (`E_BACKEND_UNAVAILABLE`): the doctor's browser line says which. In containers, use the Playwright image or install its dependencies; td2d needs no GPU.
- **A native module will not load** (`E_NATIVE_MODULE`): sharp and manifold are built per platform. Reinstall dependencies on the machine that runs td2d, not on another architecture.
- **Wrong Node.js** (`E_NODE_VERSION`): td2d needs Node.js 24 or newer.

Codes: E_ENVIRONMENT, E_NODE_VERSION, E_BROWSER_MISSING, E_BACKEND_UNAVAILABLE, E_NATIVE_MODULE, W_VALIDATOR_UNAVAILABLE.

## Commands, projects and ids

- **No project** (`E_PROJECT_NOT_FOUND`): run the command inside a project, or pass `--project <dir>`. `td2d init <dir>` makes one.
- **Unknown asset** (`E_ASSET_NOT_FOUND`): ids are paths under `assets/` without `asset.json`, such as `props/crate`. `td2d asset list --ids` lists them.
- **Nothing generated yet** (`E_NOT_GENERATED`): `inspect`, `preview`, `compare`, `sheet`, `export` and the viewer read `build/`; run `td2d generate <id>` first.
- **A busy port** for `td2d viewer` is `E_USAGE`: pass `--port 0`.

Codes: E_USAGE, E_PROJECT_NOT_FOUND, E_PROJECT_EXISTS, E_INIT_CONFLICT, E_ASSET_NOT_FOUND, E_ASSET_EXISTS, E_NOT_GENERATED, E_SCHEMA_NOT_FOUND, E_TEMPLATE_NOT_FOUND, E_OUTPUT_DIR_NOT_EMPTY, W_NO_ASSETS.

## Asset definitions, presets and palettes

Definition errors list every problem with its file and its path inside the file. Fix them all, then run `td2d validate` again.

- **JSON syntax** (`E_JSON_PARSE`): files are plain JSON: no comments, no trailing commas. Put notes in `description` fields.
- **Unknown keys** are errors (`E_ASSET_INVALID`), so a misspelt setting is reported instead of ignored. `td2d schema asset` shows every key, and editors complete them through `$schema`.
- **Unknown preset or palette** (`E_PRESET_NOT_FOUND`, `E_PALETTE_NOT_FOUND`): `td2d describe` lists what exists. Palettes are written `fixed:<name>` or `auto:<n>` in `pixel.palette`.
- **A setting has no effect**: `td2d asset show <id>` prints the resolved asset. A later layer, such as the asset itself, may override a project default.
- **An asset script is refused** (`E_SCRIPT_PERMISSION`): `td2d asset emit` lets scripts read the project and the packages they import, and nothing else. Return the definition instead of writing files; copy data the script needs into the project.
- **An asset script fails** (`E_SCRIPT_FAILED`): the message says whether it threw, timed out (30 s by default, `--timeout` to change), ran out of its 512 MB, or printed something that is not a definition.

Codes: E_JSON_PARSE, E_PROJECT_INVALID, E_ASSET_INVALID, E_PRESET_NOT_FOUND, E_PRESET_INVALID, E_PALETTE_NOT_FOUND, E_PALETTE_INVALID, E_PATH_OUTSIDE_PROJECT, E_SCRIPT_FAILED, E_SCRIPT_PERMISSION, W_UNUSED_MATERIAL, W_PRESET_SHADOWS_BUILTIN.

## Models, components and imports

`td2d validate <id> --stage model` builds the geometry without rendering and reports these quickly.

- **CSG fails** (`E_PART_NOT_MANIFOLD`): every operand of `union`, `subtract` and `intersect` must be a closed solid. Use boxes, spheres, cylinders, capsules or closed lathes, or put the parts in a `group`.
- **The model is too big for the frame** (`W_MODEL_OUT_OF_FRAME`): set `pixelsPerUnit` to `"auto"`, or lower it, or enlarge `frame`.
- **Parts float or sink** (`W_MODEL_BELOW_GROUND`): parts are centred on their `position`, so a 1 m box sits on the ground at `y = 0.5`.
- **Imports** (`E_IMPORT_FAILED`): `src` is relative to the asset's directory and must be a GLB under 50 MB.

Codes: E_MODEL_INVALID, E_PART_NOT_MANIFOLD, E_COMPONENT_NOT_FOUND, E_COMPONENT_INVALID, E_COMPONENT_CYCLE, E_IMPORT_FAILED, E_MODEL_TOO_COMPLEX, W_MODEL_OUT_OF_FRAME, W_MODEL_BELOW_GROUND, W_TRIANGLE_BUDGET, W_DEGENERATE_TRIANGLES, W_OPEN_MESH.

## Rigs and animation

- **Feet slide or float in a walk** (`W_CLIP_FOOT_CONTACT`): set the walk-cycle `bob` the warning suggests.
- **A clip plays at a slightly odd rate** (`W_CLIP_FRAME_PERIOD`): make `duration` times `fps` a whole number.
- **A pose bends too far** (`W_CLIP_BONE_LIMIT`): reduce the rotation in the named key, or widen the bone's limits in the rig.
- **Iterating on one clip rerenders everything**: a fitted `pixelsPerUnit: "auto"` or `groundMargin: "auto"` depends on every pose. Fix both while you work on a clip; `td2d inspect <id>` shows the fitted values.

Codes: W_CLIP_FRAME_PERIOD, W_CLIP_BONE_LIMIT, W_CLIP_FOOT_CONTACT.

## Rendering

- **Blank or cut-off frames** (`W_BLANK_FRAME`, `W_FRAME_CLIPPED`): the model is outside the camera or larger than the frame. Check positions with `td2d model inspect <id>` and try `pixelsPerUnit: "auto"`.
- **The browser crashed** (`W_BACKEND_RESTARTED`, then `E_BACKEND_CRASHED` if it crashes again): usually memory. Lower `td2d batch --concurrency`.
- **Output differs between machines** (`W_HARDWARE_RENDERER`): td2d renders with SwiftShader so every machine matches. The warning means something made the browser use a GPU.
- **A stage failed** (`E_GENERATION_FAILED`): the message says which. A sheet that needs more room than `sheet.maxSize` is the most common; raise it or split the sheet by clip.

Codes: E_GENERATION_FAILED, E_BACKEND_CRASHED, E_RENDER_FAILED, W_HARDWARE_RENDERER, W_BLANK_FRAME, W_FRAME_CLIPPED, W_BACKEND_RESTARTED.

## Pixel output and validation

Exit 5 (`E_VALIDATION_FAILED`) means the sprites were written but a check failed. Read `build/<id>/validation.json`: each check names the frames it is about, and the viewer's validation tab highlights them on the sheet.

![A sprite cut off by its frame](images/validation/clipped.png)

- **Colours outside the palette**: set `pixel.outline.snapToPalette` so outlines use palette colours.
- **Jitter in a clip that moves on purpose**: set `"motion": true` on the clip.
- **Stray single pixels**: set `pixel.cleanup.orphans` to `"remove"`.
- **Warnings fail CI**: that is `--strict`; drop it, or fix the warnings.

Codes: E_VALIDATION_FAILED, W_OPACITY_THRESHOLDED, W_OUTPUT_CHECK, W_COMPOSITION_GROUND, W_COMPOSITION_EDGE, W_INDEXED_UNAVAILABLE, W_PALETTE_PER_CLIP.

## Sheets and exports

- **A sheet is too large**: it is reported as `E_GENERATION_FAILED` with the size needed. Raise `sheet.maxSize`, use `"split": "clip"`, or let the packed layout spread across pages.
- **An engine shows frames in the wrong place**: on trimmed sheets, use each cell's offset (every format records it) and the pivot from the manifest.
- **A format is missing**: `td2d export <id> --format <list>` writes formats from the cached sheets without rerendering.

## Caching, batches and cancellation

- **A frame filter cannot complete the sheet** (`E_PARTIAL_PLAN`): `--frames`, `--clips` and `--directions` render only matching samples and take the rest from the cache. Run once without a filter first.
- **A batch stopped** (`E_BATCH_FAILED`): read `build/batch-report.json`, fix the asset, and run `td2d batch --resume build/batch-report.json`. With `--continue-on-error` the batch finishes the rest and exits 6 (`E_BATCH_PARTIAL`).
- **Cancelled** (`E_CANCELLED`, exit 130): nothing is left half-written. Run the command again; finished work comes from the cache.
- **The cache is large**: `td2d cache stats`, then `td2d cache clean --older-than 7d` or a lower `cache.maxSize`.
- **An asset ran over its time limit** (`E_ASSET_TIMEOUT`): with `--timeout <ms>`, each asset is stopped when it runs longer. Raise the limit, or filter frames while iterating.
- **Memory is high** (`W_MEMORY_HIGH`): td2d passed the warning level (half the machine's memory, at most 4 GB, or `TD2D_MEMORY_WARN_MB`). Lower `td2d batch --concurrency`. A browser that runs out of memory is restarted once (`W_BACKEND_RESTARTED`).

Codes: E_PARTIAL_PLAN, E_BATCH_FAILED, E_BATCH_PARTIAL, E_CANCELLED, E_ASSET_TIMEOUT, W_CACHE_PRUNED, W_MEMORY_HIGH.

## Internal errors

`E_INTERNAL` (exit 1) is a bug in td2d, not in your files. Re-run with `--log-level debug` and report the command, the output and `build/<id>/generation.json`.

Codes: E_INTERNAL.
