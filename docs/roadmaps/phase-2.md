# Phase 2 notes: minimum end-to-end milestone

Status: complete locally on 2026-10-02. Linux was tested in Docker containers; native GitHub Actions runs are still pending because the repository has no remote.

Environment: as in Phase 1. Linux: the `mcr.microsoft.com/playwright:v1.63.0-noble` image on arm64 natively and on amd64 under emulation.

## Milestone items (roadmap section 12)

| Item | Evidence |
|---|---|
| 1. The definition validates against the real schema | e2e "runs the full pipeline from a fresh project" starts from `td2d init` |
| 2. The model stage builds a GLB with zero validator errors | `model-report.json` validator block; unit tests in `model.test.ts` |
| 3. The plan emits four samples | pipeline test checks four sprites and four Aseprite tags |
| 4. Four 128 x 128 transparent renders | pipeline test reads every render |
| 5. Box downscale to 32 x 32 with binary alpha | pipeline test, `binary-alpha` check, pixel unit tests |
| 6. A 32 x 128 grid sheet | pipeline and e2e tests read the sheet size |
| 7. `crate.png`, `crate.json` (Aseprite) and `manifest.json` | e2e validates both JSON files with ajv against the committed schemas |
| 8. Validation writes `validation.json` | pipeline test parses it against the schema |
| 9. The viewer lists the asset and shows the sheet with cell overlays | e2e starts `td2d viewer`, loads it in Chromium, finds four cell overlays and a loaded 32 x 128 image |
| 10. Unit, determinism, CLI e2e and viewer tests pass locally and on Linux | full suite locally; render and pipeline suites in Linux containers |

## Measurements

| Measurement | Value |
|---|---|
| Cold `td2d generate` on the starter project | 0.68 s wall time |
| Warm `td2d generate` (all eight stages cached), including Node start | 0.18 s wall time |
| Render stage for four 128 x 128 frames, including browser start | about 0.45 s |
| Pixel stage for four frames | about 6 ms |
| Crate sheet pixels that differ between macOS arm64 and Linux arm64 or x86_64 | 0 (byte-identical PNG) |
| Tests | 283 across unit, render, harness and e2e projects |

## Decisions

- **Colour enters at render time.** The model stage writes geometry with named, uncoloured materials, and the render stage applies the resolved materials by name. This is what lets a colour change reuse geometry and planning, as the acceptance criteria require. Imported GLBs and `render --glb` still use the colours in the file.
- **Automatic ground margin.** `camera.groundMargin` now accepts `"auto"`, the new default in every preset. The plan stage projects every vertex in every direction and picks the smallest margin that keeps the model one pixel clear of the bottom edge. The value is recorded in the manifest.
- **Camera maths lives in `@td2d/schema/camera`.** The plan stage needs it in Node and the harness needs it in the browser. A separate export path keeps zod out of the browser bundle.
- **Validate before export.** The manifest carries the validation summary, so validation must run first. `generation.json` and the history entry are written after export.
- **`--from` and `--to` instead of `--only`.** A stage cannot run without its upstream outputs, so "only" had no clear meaning. A partial run keeps later outputs from an earlier run only when their recorded stage hash still matches, and removes them otherwise.
- **Exit code 5 for failed checks.** The roadmap said exit 5 only under `--strict`. A failed check now always exits 5, `--strict` adds warnings, and every output is still written so it can be inspected.
- **Settings accepted but not applied** (palettes, dither, outlines, cleanup, mirroring, some export formats) produce `W_SPECULATIVE_SETTING` instead of being silently ignored.
- **Stage hashes include a backend fingerprint**: the Playwright version, the harness protocol and a hash of the harness bundle. Rebuilding the harness invalidates cached renders; the expected-output test therefore ignores the manifest's `stages` hashes and compares pixels and content.
- **Viewer.** A Hono server that only reads `build/`, with traversal-safe file serving (tests cover encoded and symlinked escapes), and a React page. Live reload and the static mode are Phase 9.

## Corrections to the roadmap

- The milestone said the crate sheet is 128 x 32. The layout rule in section 8.7 (one row per clip and direction) makes it 32 x 128. The milestone text is corrected.
- The stage table in section 6.3 is updated to the implemented order and dependencies.

## Known limits

- Lighting is untuned: the crate's top and left faces fall in the same toon band. Phase 4 owns lighting and will regenerate the goldens and the example's expected outputs.
- The cache is never pruned yet; `td2d cache clean` is Phase 8.
- Clips on assets without a rig render the rest pose for every frame. Rigs arrive in Phase 6.
