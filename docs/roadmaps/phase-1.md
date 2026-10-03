# Phase 1 notes: render backend validation and harness

Status: complete locally on 2026-10-02. Linux was tested in Docker containers; native GitHub Actions runs are still pending because the repository has no remote.

Environment: macOS 26.7.1 on Apple Silicon, Node.js 24.3.0, Playwright 1.63.0 with Chromium headless shell 153.0.8010.12, three.js r186. Linux: the `mcr.microsoft.com/playwright:v1.63.0-noble` image on arm64 natively and on amd64 under emulation.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| `td2d render --glb ... --directions s,w,n,e --json` writes four transparent PNGs of the right size | e2e "writes one transparent PNG per direction" (eight directions) |
| Determinism on macOS and Linux | render test "byte-identical frames from separate browser launches" passes on all three platforms |
| Cross-OS goldens within 0.5 percent | 0 differing pixels, exactly, on Linux arm64 and x86_64 against goldens made on macOS arm64 |
| SIGINT exits 130 within 2 seconds and leaves no browser | e2e test tags the browser with `TD2D_RUN_TAG` and finds no tagged process after exit |
| `doctor` reports a SwiftShader renderer | `doctor` renders a probe cube and prints the renderer string |

## Measurements

| Measurement | macOS arm64 | Linux arm64 | Linux x86_64 (emulated) |
|---|---|---|---|
| 64 frames at 128 x 128 including browser start | about 0.5 s | 0.53 s | 1.85 s |
| Golden pixels that differ from macOS | n/a | 0 | 0 |
| Browser start (launch, harness load, WebGL2 check) | about 0.3 s | | |
| `td2d doctor` total | about 0.7 s | | |
| Harness bundle size | 755 KB (194 KB gzipped) | | |

## Questions resolved

- **Q1.** WebGL2 works in the Playwright 1.63 headless shell on Linux with `--use-angle=swiftshader --enable-unsafe-swiftshader` and the Playwright system libraries. It also works on macOS without the flags; td2d always passes them so the rasteriser is the same everywhere.
- **Q2.** SwiftShader output is byte-identical between macOS arm64, Linux arm64 and Linux x86_64 for every golden. The x86_64 figure comes from emulation, so the first native CI run should confirm it. Golden tests keep the 0.5 percent tolerance anyway, because a browser upgrade can change edge coverage.
- **Q13** stays open for Phase 11. headless-gl was not needed.

## Decisions

- **Harness as one script.** Vite builds the harness into a single IIFE script. The backend serves it, and a tiny HTML page, from a routed `https://td2d.local` origin, so the page is a secure context and nothing touches the network.
- **Readback.** Each sample renders to the canvas and is read with `gl.readPixels` in the same task. Frames cross the browser boundary as base64 RGBA, 16 per round trip, and are flipped to top-down in Node.
- **Rest pose.** Every sample restores the rest pose before applying its clip time, so a frame never depends on the previous one.
- **Lighting.** Camera-space lights turn with the camera. Directional lights cast hard shadows with a shadow camera sized from the model bounds.
- **Process tagging.** The browser command line carries `--td2d-run=<id>` (from `TD2D_RUN_TAG` when set), so a leaked browser can be found with `ps`.
- **Output safety.** `render` writes only into a new, empty or td2d-marked directory (`.td2d-output`).

## Problems found and fixed

- **The `dimetric` pitch was wrong.** The roadmap and Phase 0 used 26.565 degrees. That is the angle of the projected line, not the camera pitch. At 45 degrees of yaw a world edge projects with slope sin(pitch), so 2:1 lines need a pitch of 30 degrees. The preset, the base settings, the schema text and the roadmap are corrected, and a unit test now proves the 2:1 slope and the 30-degree isometric lines.
- **Footprints in front of the pivot are cropped by small ground margins.** The pivot line sits `groundMargin` pixels above the bottom edge, and geometry nearer the camera projects below it. A one-metre crate at 16 pixels per metre reaches 5.7 pixels below the pivot, so the default 2-pixel margin crops it. Phase 1 adds `W_FRAME_CLIPPED` and `W_BLANK_FRAME` warnings. Phase 2 gains a task to compute the ground margin automatically from the model's footprint.

## Deviations from the roadmap

- The harness package has no compiled output of its own; Vite bundles it from source and `tsc -b` type-checks it.
- `render` takes `--glb` only. Rendering an asset id needs the model stage and arrives with Phase 2's `generate` and `render <id>`.
- Lighting intensities are unchanged from Phase 0. Tuning them is Phase 4 work and will regenerate the goldens.
