# Phase 10 notes: operator experience, documentation and workflow tests

Status: complete locally on 2026-10-02.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Agent workflow test passes on CI | `packages/cli/e2e/agent-workflow.test.ts` runs in the e2e project, which CI runs on Linux and macOS. It checks every command AGENTS.md names exists, follows AGENTS.md's iterate block, writes an asset from `td2d schema asset`'s own example, generates and checks the outputs, breaks the schema and asserts the error path, hint and `td2d explain`, fixes it and regenerates one frame entirely from the cache, recolours and compares, and checks every named command's `--help` shows an example |
| Every command has at least one example in `--help`; every error code has a catalogue entry and a hint | Unit tests "gives every command at least one example in its --help" (31 commands) and "has a summary, detail, hint and troubleshooting topic for every error and warning" (40 errors, 23 warnings at the end of the phase; first recorded here as 44 and 25, a miscount corrected in Phase 11) |
| No broken internal links (link checker in CI) and no stale generated pages | `pnpm docs:check` in CI and the docs test check every relative link, image and anchor in 50 Markdown files; staleness tests cover `docs/reference/cli.md`, `errors.md`, `schemas.md`, `docs/guide/examples.md`, `schemas/` and every image in `docs/guide/images` (regenerated and compared byte for byte by a render test) |
| A fresh operator following AGENTS.md produces a validated sprite sheet in under ten commands (documented transcript) | Two review sessions, below: 11 commands the first time (7 of them optional discovery), then, after the fixes, 8 commands for a different asset |

## Review pass

Two fresh agent sessions were given only AGENTS.md, the tool's own output and the files it writes, and asked to make a new prop from an empty directory, improve it, and recover from a deliberate mistake. Neither read source code or opened a docs page.

| Session | Asset | Commands to the first validated sheet | Notes |
|---|---|---|---|
| 1 | Barrel with two iron hoops, 4 directions | 11 | Valid on the first `generate`; 7 commands were discovery (describe, schema, asset show, validate twice). The shortest path is `init`, `asset create`, edit, `generate` |
| 2 (after the fixes below) | Signpost with an arrow board, 8 directions | 8 | Valid on the first `generate`; recovered from a renamed key and a renamed material in two rounds, as AGENTS.md says to expect |

Friction points they recorded, and what was done:

| Point | Resolution |
|---|---|
| `describe` listed asset templates as `[object Object]` | Fixed; the completeness test now checks template names and examples |
| AGENTS.md assumed the CLI is run inside the repository | It says how to run td2d from any directory |
| `td2d schema asset` without `--json` contradicted "always pass --json" | AGENTS.md says the schema prints raw and is `data.schema` under `--json` |
| Failure envelopes have no `data`, but AGENTS.md showed it | The envelope is written `data?`, present on every success |
| No sizing guidance; `"auto"` found only in the schema | AGENTS.md explains `pixelsPerUnit` and `"auto"`, and that it refits |
| The scale `"auto"` chose changed silently between generations | Generate results report `scale` (pixels per metre and ground margin); `compare` reports `pixelsPerUnit` of both builds and says when it changed |
| `inspect --frame` hinted at a command that does not list cells | The hint names `--cells` |
| Preset name examples in the schema were palette names | Each preset kind has its own examples |
| Templates hid frame, directions and acceptance | The box, cylinder and sphere templates write them out |
| Schema errors hid reference errors | Documented in AGENTS.md and in the hint; each round lists every problem it finds |
| No "did you mean" for keys and ids | Unknown keys get the nearest key (edit distance with transpositions), or the allowed keys when none is close; unknown ids get the nearest id |
| A missing key read "expected number, received undefined" | It reads `Missing required property "depth" (expected number)` |
| The same code had two messages | Every definition error reads `<file> has N problems.` |
| `directions` errors listed only the set names | They list every accepted form and echo the value received |
| Reference errors had a generic hint | They say each issue lists what is defined |
| A mistyped `--json` lost the envelope, and the hint said `<command>` | Usage errors that suggest `--json` print an envelope, `TD2D_JSON=1` makes JSON the default, and the hint names the command |
| `validate --stage model` lacked files and issues | Each asset has `file` and `issues` |
| `compare` did not mention `--out`, and the image and preview were unlabelled | Human output suggests `--out`; `diffRows` names the image's rows and `--help` describes its columns; `preview` returns every cell's key and rectangle |
| `compare --help` used `..` while AGENTS.md says `..` is refused | AGENTS.md says the rule is for paths inside definitions |
| A cached regeneration returned `history: null` unexplained | Documented in the metadata guide |
| `inspect` used `colours` while definitions use `color` | JSON keys are `colors` and `colorCount` |
| Extrude placement along Z was undocumented | The extrude schema says it is centred, from -depth/2 to depth/2 |
| The coverage check hid the measured value | Coverage and colour checks report the measured range |
| `describe --json` is 100 KB | `td2d describe <section>` returns one section, with suggestions for typos |
| The exit table's "6 / 4" row was hard to read | Rows split; 4 also covers a stopped batch |
| Direction sets and the sample crate were not mentioned | AGENTS.md mentions both |
| Near-identical colours were not flagged | Not done: whether two shades are intended is the author's call, and the palette tools already merge colours when asked |
| The shell function must be defined in each shell | Not done: it is how shells work; AGENTS.md shows the function |

## Decisions

- **One catalogue drives errors, docs and `explain`.** Each error has a summary, a detail, a hint and a troubleshooting topic; each warning a summary, hint and topic. `docs/reference/errors.md` is generated from it, `td2d explain <code>` prints it, and a test checks every code is listed under its topic in `docs/guide/troubleshooting.md`, which stays hand-written.
- **Generated references.** `pnpm generate` writes `docs/reference/cli.md` from the commander definitions (usage, arguments, options with choices and defaults, the help examples and notes), `docs/reference/schemas.md` from the document registry, and the example gallery from `examples/`. Every top-level schema field has a description, enforced by a test.
- **`describe` entries are uniform.** Part types, presets, palettes, rigs, generators, pixel passes, exporters and backends each carry a version, a description, an option schema (with `--schemas`), an example and a docs anchor. Part types and generators gained versions, now part of the model and rig cache keys. A test validates and builds every example: each part type is built into geometry, each preset, palette, rig, backend, pass and exporter example resolves on a real asset, each generator bakes keys on the humanoid rig, each pass runs on real frames and each exporter writes files from a laid-out sheet. A test also fails if a part type has no builder.
- **Images belong to the test suite.** `scripts/docs-images.ts` writes every guide image; a render test reruns it into a temporary directory and requires the committed images to match byte for byte, and that no image is left over. Every guide shows at least one image and a runnable shell example, also tested.
- **The link checker** (`scripts/lib/markdown.ts`) checks relative links, images, `<a id>` anchors and GitHub heading anchors, ignoring code; JSON code blocks must parse.
- **New commands from section 9.2:** `history show` (by id, prefix, hash, `latest` or `previous`) and `history prune` (`--keep`, `--older-than`, `--dry-run`, never the newest entry, across deleted assets too), `td2d completion bash|zsh|fish` (commands, options, option values and asset ids from `td2d asset list --ids`), `td2d explain` and `td2d describe <section>`.
- **Palette files** report `E_PALETTE_INVALID` rather than `E_PRESET_INVALID`, and `E_NOT_IMPLEMENTED`, which only guarded an impossible case, is gone.

## Deviations

- **Global options.** Section 9.1 lists `--no-cache`, `--force`, `--dry-run`, `--concurrency` and `--timeout` as global. They are options of the commands that run the pipeline (generate, render, process, sheet, export, batch), where they mean something; `--concurrency` is on `td2d batch`, which runs assets in parallel, and `--timeout` arrived with Phase 11's resource limits.
- **The manual review** was run as two fresh Claude sessions in this environment, not by a person; the transcripts' commands and findings are above. The issues were fixed here rather than filed, since the repository has no issue tracker.
- **zsh completion** uses zsh's bash completion support rather than a native `_arguments` script; zsh does its own matching, as the test shows. Fish was checked in a Linux container (fish 3.7), and CI installs zsh and fish so their tests always run there.

## Measurements

| Measurement | Value |
|---|---|
| Guides | 21 under `docs/guide`, plus 6 references (3 generated) |
| Error catalogue | 40 errors and 23 warnings, each with a troubleshooting section (corrected in Phase 11 from a miscount of 44 and 25) |
| CLI reference | 31 commands |
| Commands to a validated sheet | 11, then 8 after the fixes (two fresh sessions) |
| Tests | 601 across unit, render, harness, viewer and e2e projects, plus 7 experiments |

## Linux

The same 81 render, harness and viewer tests and 10 viewer end-to-end tests pass on Linux arm64 and x86_64. The docs-image test is among them, so every image in `docs/guide/images` regenerates byte for byte on Linux as on macOS, and all 9 harness goldens match exactly.
