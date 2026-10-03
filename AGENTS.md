# Operating td2d (guide for Claude Code and other agents)

td2d turns JSON asset definitions into validated pixel-art sprite sheets. Drive it only through the CLI and the files it
reads and writes; no MCP server is needed. Full docs: `docs/guide/` (start with `cli.md`) and `docs/reference/`.

## Set up

- Build once in this repository (`pnpm install && pnpm build`). `td2d` is not on PATH: from any directory run
  `node <repo>/packages/cli/dist/main.js <command>`, or define `td2d() { node <repo>/packages/cli/dist/main.js "$@"; }`.
- First run on a machine: `td2d doctor --fix --json`. Exit 7 means the environment needs attention: follow `error.hint`.

## Always pass --json

- stdout is exactly one envelope `{ ok, command, version, durationMs, data?, warnings, error? }`; `data` is always
  there on success. stderr is NDJSON logs and progress: read the two separately. `TD2D_JSON=1` makes --json the default.
- `error` has `code`, `message`, `issues[]` (each with `file` and `path`, such as `model.parts[1].size`), `hint`, `docs`.
  `td2d explain <code> --json` gives the full entry; `docs/reference/errors.md` lists every code.

| Exit | Meaning | Do |
|---|---|---|
| 0 | Success, maybe with warnings | Read `warnings` |
| 2 | Usage: unknown command, option, id or name | Fix the command; `td2d <command> --help` |
| 3 | An input document is invalid | Fix each issue at its `file` and `path` |
| 4 | Generation failed, or a batch stopped at a failure | Read the error and its hint |
| 5 | Output failed validation; files were written | Read `build/<id>/validation.json` |
| 6 | A batch finished with some assets failed | Read `build/batch-report.json`, then `--resume` it |
| 7 | Environment | `td2d doctor --fix` |
| 1 | Internal error (a bug) | Re-run with `--log-level debug` and report |

## Discover before writing

1. `td2d describe --json`: commands, part types with examples, presets, palettes, passes, exporters, error codes.
   It is large: `td2d describe partTypes --json` (or presets, exporters, errors, ...) returns one section.
2. `td2d schema asset` prints the raw JSON Schema (with --json, it is `data.schema`); names from `td2d schema --list`.
3. `td2d asset show <id> --json`: the asset after defaults and presets, exactly what generation uses.

## Make an asset and iterate

```sh
td2d init my-sprites --json && cd my-sprites   # includes a sample asset, props/crate
td2d asset create props/barrel --template cylinder --json
# edit assets/props/barrel/asset.json
td2d validate props/barrel --json      # schemas and references, no rendering
td2d generate props/barrel --json      # data.results[0].outputs lists every file
td2d preview props/barrel --json       # then open data.file with your image reader
td2d compare props/barrel --json       # after a change: what moved, cell by cell; --out diff.png draws it
```

- Only stages an edit affects rerun; `--dry-run` shows the plan and `items` in the result shows what rendered.
- Add an `acceptance` block (`maxColors`, `minAlphaCoverage`, `maxJitter`, `requiredClips`, ...) and loop until
  validation passes. `td2d inspect <id> --frame idle/s/000 --json` reports one sprite.
- Many assets: `td2d batch --filter "props/*" --continue-on-error --json`, then `--resume build/batch-report.json`.

## Rules for definitions

- Plain JSON: no comments or trailing commas; notes go in `description`. Unknown keys are errors.
- Metres, Y up, degrees. Parts are centred on `position`, so a 1 m box stands at y = 0.5. Every shape names a material.
- 1 m is `pixelsPerUnit` pixels (16 by default); `"pixelsPerUnit": "auto"` picks the largest scale that fits the frame,
  and refits when parts, clips or outlines change, rerendering everything (`scale` in the result shows the value).
- `directions`: `d1`, `d4` (the default), `d8`, `d16`, or compass names such as `["s", "e"]`.
- Schema errors (unknown keys, wrong types) come first; references to materials, bones and clips are checked once the
  file matches the schema, so fix and validate again.
- Prefer groups, `repeat`, `mirror` and components to copied parts (`docs/guide/models.md`); check geometry with
  `td2d validate <id> --stage model --json` (bounds: `td2d model inspect <id> --json`); fix `W_MODEL_OUT_OF_FRAME` first.
- Settings take a preset name or `{ "preset": ..., overrides }`. Layers: built-in, type, project `defaults`,
  project `typeDefaults.<type>`, asset. Objects merge, arrays replace.
- Guides: camera and lighting `camera-and-lighting.md`, colours `materials-and-palettes.md` and `pixel-art.md`,
  characters `rigging-and-animation.md` (rig `humanoid-basic`, a `bone` per part, generators), sheets and engines
  `sprite-sheets.md` and `export-formats.md`, metadata `metadata.md`, checks `validation.md`, fixes `troubleshooting.md`.
- Read sprite positions from `sheets/manifest.json` (`td2d inspect <id> --cells --json`), never by guessing.
- For maths-heavy assets, write a script with `@td2d/core/sdk`, run `td2d asset emit <script>`, commit the JSON.

## Do not

- Do not hand-edit `schemas/`, `docs/reference/` or `.td2d/schemas/`: run `pnpm generate` or `td2d schema --write`.
- Paths inside definitions are relative to the project; `..` and symlinks that leave it are refused.
- Do not parse human output; do not read stdout and stderr together.
- `td2d viewer` is for the people you work with; read files and use `inspect`, `preview` and `compare` yourself.
